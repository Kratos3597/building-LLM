"""Local FastAPI service and embedded job runner for CloudNex Local LLM Studio."""

from __future__ import annotations

import json
import os
import platform
import runpy
import re
import signal
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, fields
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
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
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
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
_data_dir = Path(os.environ.get("CLOUDNEX_DATA_DIR", Path.home() / "CloudNex Local LLM Studio" / "data"))
_data_dir.mkdir(parents=True, exist_ok=True)
_processes: dict[str, subprocess.Popen] = {}
_checkpoint_dirs = [
    Path(os.environ.get("CLOUDNEX_CHECKPOINT_DIR", Path.home() / "CloudNex Local LLM Studio" / "checkpoints")),
    Path("/ephemeral/ckpts"),
]
_loaded_models: dict[tuple[str, str], object] = {}


def _cuda_available() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:
        return False


class JobRequest(BaseModel):
    stage: str
    smoke: bool = True
    nproc: int = Field(default=1, ge=1, le=8)
    overrides: dict[str, object] = Field(default_factory=dict)


class ChatRequest(BaseModel):
    checkpoint: str
    prompt: str = Field(min_length=1, max_length=12000)
    temperature: float = Field(default=0.8, ge=0.0, le=2.0)
    max_new_tokens: int = Field(default=256, ge=1, le=2048)
    greedy: bool = False


class DatasetUpdate(BaseModel):
    dataset_type: str


class EvaluationRequest(BaseModel):
    checkpoint: str
    split: str = "test"
    limit: int = Field(default=200, ge=1, le=10000)
    max_new_tokens: int = Field(default=300, ge=1, le=2048)
    samples: int = Field(default=3, ge=0, le=20)
    device: str = "auto"


def _registry_path(job_id: str) -> Path:
    return _job_dir / f"{job_id}.json"


def _log_path(job_id: str) -> Path:
    return _job_dir / f"{job_id}.log"


def _safe_filename(filename: str | None) -> str:
    name = Path(filename or "upload.bin").name
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip(".")
    return name[:180] or "upload.bin"


def _data_path(filename: str) -> Path:
    path = (_data_dir / _safe_filename(filename)).resolve()
    if _data_dir.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Dataset file not found.")
    return path


def _checkpoint_path(name: str) -> Path:
    candidate = Path(name)
    if candidate.is_absolute() and candidate.is_file():
        return candidate.resolve()
    for directory in _checkpoint_dirs:
        path = (directory / name).resolve()
        if path.is_file() and directory.resolve() in path.parents:
            return path
    raise HTTPException(status_code=404, detail="Checkpoint not found in the CloudNex checkpoint folders.")


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

    command = [sys.executable, "--run-script", str(script), "--config", str(config)] if getattr(sys, "frozen", False) else [sys.executable, str(script), "--config", str(config)]
    for key, value in request.overrides.items():
        command.extend([f"--{key}", str(value).lower() if isinstance(value, bool) else str(value)])
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


def _start_evaluation(job_id: str, request: EvaluationRequest) -> dict:
    checkpoint = _checkpoint_path(request.checkpoint)
    script = _engine_root / "scripts" / "eval_post_training.py"
    if not script.exists():
        raise HTTPException(status_code=503, detail="Evaluation engine is not bundled in this build.")
    device = request.device
    if device == "auto":
        device = "cuda" if _cuda_available() else "cpu"
    args = ["--ckpt", str(checkpoint), "--label", checkpoint.stem, "--limit", str(request.limit), "--split", request.split, "--max_new_tokens", str(request.max_new_tokens), "--samples", str(request.samples), "--device", device]
    command = [sys.executable, "--run-script", str(script), *args] if getattr(sys, "frozen", False) else [sys.executable, str(script), *args]
    log_file = _log_path(job_id).open("ab")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    process = subprocess.Popen(command, cwd=_engine_root, env={**os.environ, "PYTHONPATH": str(_engine_root)}, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=os.name != "nt", creationflags=creationflags)
    record = {"job_id": job_id, "kind": "evaluation", "stage": "evaluation", "title": f"GSM8K · {checkpoint.name}", "checkpoint": checkpoint.name, "pid": process.pid, "command": command, "log": str(_log_path(job_id)), "started": time.time(), "status": "running"}
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


@app.get("/api/stages/{stage}/config")
def stage_config(stage: str, smoke: bool = True) -> dict:
    config_classes = {
        "pretrain": "PretrainConfig", "sft": "SFTConfig", "reward": "RewardConfig",
        "dpo": "DPOConfig", "ppo": "PPOConfig", "grpo": "GRPOConfig",
    }
    if stage not in config_classes:
        raise HTTPException(status_code=404, detail="Unknown training stage")
    from config import post_training_config as config_module
    from config.loader import load_config

    cfg_cls = getattr(config_module, config_classes[stage])
    path = _engine_root / "configs" / ("smoke" if smoke else "") / f"{stage}.json"
    if not smoke:
        path = _engine_root / "configs" / f"{stage}.json"
    cfg = load_config(cfg_cls, str(path))
    values = asdict(cfg)
    fields_out = []
    for field in fields(cfg):
        value = values[field.name]
        kind = "boolean" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else "text"
        fields_out.append({"name": field.name, "value": value, "kind": kind})
    return {"stage": stage, "smoke": smoke, "fields": fields_out}


@app.get("/api/data/files")
def data_files() -> list[dict]:
    metadata_path = _data_dir / "uploads.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    files = []
    for path in sorted(_data_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_file() or path.name == "uploads.json":
            continue
        item = metadata.get(path.name, {})
        files.append({"name": path.name, "size": path.stat().st_size, "dataset_type": item.get("dataset_type", "general"), "uploaded": item.get("uploaded", path.stat().st_mtime)})
    return files


@app.post("/api/data/upload")
def upload_data(file: UploadFile = File(...), dataset_type: str = Form("general")) -> dict:
    allowed_types = {"pretrain", "sft", "preference", "rl", "general"}
    if dataset_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Unsupported dataset type")
    filename = _safe_filename(file.filename)
    destination = _data_dir / filename
    if destination.exists():
        destination = _data_dir / f"{destination.stem}_{int(time.time())}{destination.suffix}"
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    metadata_path = _data_dir / "uploads.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    metadata[destination.name] = {"dataset_type": dataset_type, "uploaded": time.time()}
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    return {"name": destination.name, "size": destination.stat().st_size, "dataset_type": dataset_type}


@app.patch("/api/data/files/{filename}")
def update_data(filename: str, update: DatasetUpdate) -> dict:
    allowed_types = {"pretrain", "sft", "preference", "rl", "general"}
    if update.dataset_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Unsupported dataset type")
    path = _data_path(filename)
    metadata_path = _data_dir / "uploads.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    metadata[path.name] = {**metadata.get(path.name, {}), "dataset_type": update.dataset_type}
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    return {"name": path.name, "dataset_type": update.dataset_type}


@app.delete("/api/data/files/{filename}")
def delete_data(filename: str) -> dict[str, str]:
    path = _data_path(filename)
    path.unlink()
    metadata_path = _data_dir / "uploads.json"
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata.pop(path.name, None)
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    return {"status": "deleted", "name": path.name}


@app.get("/api/models")
def models() -> list[dict]:
    found = {}
    for directory in _checkpoint_dirs:
        if not directory.is_dir():
            continue
        for path in directory.glob("*.pt"):
            resolved = path.resolve()
            found[str(resolved)] = {
                "name": path.name,
                "path": path.name,
                "size_mb": round(path.stat().st_size / 1024 / 1024, 1),
                "modified": path.stat().st_mtime,
            }
    return sorted(found.values(), key=lambda item: item["modified"], reverse=True)


@app.post("/api/chat")
def chat(request: ChatRequest) -> dict[str, str | float]:
    checkpoint = _checkpoint_path(request.checkpoint)
    device = os.environ.get("CLOUDNEX_DEVICE", "cuda" if _cuda_available() else "cpu")
    cache_key = (str(checkpoint), device)
    model = _loaded_models.get(cache_key)
    if model is None:
        from src.post_training.inference import load_model_from_ckpt

        model = load_model_from_ckpt(str(checkpoint), device)
        _loaded_models[cache_key] = model
    from src.post_training.inference import generate_reply

    reply = generate_reply(
        model,
        request.prompt,
        device=device,
        max_new_tokens=request.max_new_tokens,
        temperature=request.temperature,
        greedy=request.greedy,
    )
    return {"reply": reply, "model": checkpoint.name, "device": device}


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
    config_classes = {
        "pretrain": "PretrainConfig", "sft": "SFTConfig", "reward": "RewardConfig",
        "dpo": "DPOConfig", "ppo": "PPOConfig", "grpo": "GRPOConfig",
    }
    from config import post_training_config as config_module
    allowed = {field.name for field in fields(getattr(config_module, config_classes[request.stage])())}
    unknown = set(request.overrides) - allowed
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown config fields: {', '.join(sorted(unknown))}")
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


@app.get("/api/evaluations")
def evaluations() -> list[dict]:
    records = []
    for record in jobs():
        if record.get("kind") != "evaluation":
            continue
        log_path = _log_path(record["job_id"])
        record["log_tail"] = log_path.read_text(encoding="utf-8", errors="replace")[-12000:] if log_path.exists() else ""
        records.append(record)
    return records


@app.post("/api/evaluations")
def create_evaluation(request: EvaluationRequest) -> dict:
    if request.split not in {"train", "test"}:
        raise HTTPException(status_code=400, detail="Evaluation split must be train or test")
    if any(record.get("status") == "running" for record in evaluations()):
        raise HTTPException(status_code=409, detail="An evaluation is already running.")
    return _start_evaluation(uuid.uuid4().hex[:12], request)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--run-script":
        _run_embedded_script()
    else:
        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("CLOUDNEX_BACKEND_PORT", "8000")), log_level="warning")
