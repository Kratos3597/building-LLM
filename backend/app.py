"""Local FastAPI service and embedded job runner for CloudNex Local LLM Studio."""

from __future__ import annotations

import json
import os
import platform
import runpy
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

STAGES = {
    "pretrain": {"title": "Pretraining", "script": "scripts/pretrain_base.py"},
    "sft": {"title": "Supervised Fine-Tuning", "script": "scripts/train_sft.py"},
    "reward": {"title": "Reward Model", "script": "scripts/train_reward.py"},
    "dpo": {"title": "DPO / ORPO / KTO", "script": "scripts/train_dpo.py"},
    "ppo": {"title": "PPO (RLHF)", "script": "scripts/train_ppo.py"},
    "grpo": {"title": "GRPO / RLVR", "script": "scripts/train_grpo.py"},
}

app = FastAPI(title="CloudNex Local LLM Studio", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "file://", "http://localhost"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_engine_env = os.environ.get("CLOUDNEX_ENGINE_ROOT")
if _engine_env:
    _engine_root = Path(_engine_env).resolve()
elif getattr(sys, "frozen", False):
    _engine_root = Path(sys._MEIPASS) / "engine"
else:
    _engine_root = Path(__file__).resolve().parents[1]
_job_dir = Path(os.environ.get("CLOUDNEX_JOB_DIR", Path.home() / "CloudNex Local LLM Studio" / "jobs"))
_job_dir.mkdir(parents=True, exist_ok=True)
_processes: dict[str, subprocess.Popen] = {}


class JobRequest(BaseModel):
    stage: str
    smoke: bool = True
    nproc: int = Field(default=1, ge=1, le=8)


def _registry_path(job_id: str) -> Path:
    return _job_dir / f"{job_id}.json"


def _log_path(job_id: str) -> Path:
    return _job_dir / f"{job_id}.log"


def _write_job(record: dict) -> None:
    _registry_path(record["job_id"]).write_text(json.dumps(record), encoding="utf-8")


def _read_job(job_id: str) -> dict | None:
    path = _registry_path(job_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _refresh_job(record: dict) -> dict:
    process = _processes.get(record["job_id"])
    if process is not None:
        returncode = process.poll()
        if returncode is None:
            record["status"] = "running"
        else:
            record["status"] = "finished" if returncode == 0 else "failed"
            record["returncode"] = returncode
            _processes.pop(record["job_id"], None)
            _write_job(record)
    return record


def _run_embedded_script() -> None:
    """Run a bundled training script when a frozen backend is used as its child."""
    script = Path(sys.argv[2]).resolve()
    sys.path.insert(0, str(_engine_root))
    runpy.run_path(str(script), run_name="__main__")


def _start_job(job_id: str, request: JobRequest) -> dict:
    stage = STAGES[request.stage]
    script = _engine_root / stage["script"]
    config = _engine_root / "configs" / ("smoke" if request.smoke else "") / f"{request.stage}.json"
    if not request.smoke:
        config = _engine_root / "configs" / f"{request.stage}.json"
    if not script.exists() or not config.exists():
        raise HTTPException(status_code=503, detail="Training engine resources are not bundled in this build.")

    if getattr(sys, "frozen", False):
        command = [sys.executable, "--run-script", str(script), "--config", str(config)]
    else:
        command = [sys.executable, str(script), "--config", str(config)]
    log_file = _log_path(job_id).open("ab")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=_engine_root,
        env={**os.environ, "PYTHONPATH": str(_engine_root)},
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=os.name != "nt",
        creationflags=creationflags,
    )
    record = {
        "job_id": job_id,
        "stage": request.stage,
        "title": stage["title"],
        "smoke": request.smoke,
        "pid": process.pid,
        "command": command,
        "log": str(_log_path(job_id)),
        "started": time.time(),
        "status": "running",
    }
    _processes[job_id] = process
    _write_job(record)
    return record


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "cloudnex-backend"}


@app.get("/api/system")
def system_info() -> dict[str, str]:
    return {"platform": platform.system(), "python": platform.python_version(), "device": os.environ.get("CLOUDNEX_DEVICE", "auto")}


@app.get("/api/stages")
def stages() -> list[dict[str, str]]:
    return [{"key": key, **stage} for key, stage in STAGES.items()]


@app.get("/api/jobs")
def jobs() -> list[dict]:
    records = []
    for path in sorted(_job_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        record = _read_job(path.stem)
        if record:
            records.append(_refresh_job(record))
    return records[:50]


@app.post("/api/jobs")
def create_job(request: JobRequest) -> dict:
    if request.stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"Unknown training stage: {request.stage}")
    if any(record.get("status") == "running" for record in jobs()):
        raise HTTPException(status_code=409, detail="A training job is already running.")
    return _start_job(uuid.uuid4().hex[:12], request)


@app.get("/api/jobs/{job_id}")
def job(job_id: str) -> dict:
    record = _read_job(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    record = _refresh_job(record)
    log_path = _log_path(job_id)
    record["log_tail"] = log_path.read_text(encoding="utf-8", errors="replace")[-12000:] if log_path.exists() else ""
    return record


@app.post("/api/jobs/{job_id}/stop")
def stop_job(job_id: str) -> dict[str, str]:
    record = _read_job(job_id)
    process = _processes.get(job_id)
    if not record or process is None or process.poll() is not None:
        raise HTTPException(status_code=404, detail="Running job not found")
    if os.name == "nt":
        process.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    record["status"] = "stopped"
    _write_job(record)
    return {"status": "stopped"}


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--run-script":
        _run_embedded_script()
    else:
        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("CLOUDNEX_BACKEND_PORT", "8000")), log_level="warning")
