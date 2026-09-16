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

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
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
_log_dirs = [Path(os.environ.get("CLOUDNEX_LOG_DIR", Path.home() / "CloudNex Local LLM Studio" / "logs")), Path("/ephemeral/logs")]
_processes: dict[str, subprocess.Popen] = {}
_checkpoint_dirs = [
    Path(os.environ.get("CLOUDNEX_CHECKPOINT_DIR", Path.home() / "CloudNex Local LLM Studio" / "checkpoints")),
    Path("/ephemeral/ckpts"),
]
_loaded_models: dict[tuple[str, str], object] = {}
_settings_file = _job_dir.parent / "compute_settings.json"


def _get_system_memory_gb() -> float:
    try:
        import psutil
        return round(psutil.virtual_memory().total / (1024 ** 3), 1)
    except Exception:
        pass
    try:
        if Path("/proc/meminfo").exists():
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    kb = int(line.split()[1])
                    return round(kb / (1024 ** 2), 1)
    except Exception:
        pass
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return round(stat.ullTotalPhys / (1024 ** 3), 1)
    except Exception:
        pass
    try:
        import subprocess
        out = subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip()
        return round(int(out) / (1024 ** 3), 1)
    except Exception:
        pass
    return 16.0


def _get_gpus() -> list[dict[str, object]]:
    gpus: list[dict[str, object]] = []
    try:
        import torch
        if torch.cuda.is_available():
            hip_ver = getattr(torch.version, "hip", None)
            is_rocm = hip_ver is not None
            count = torch.cuda.device_count()
            for i in range(count):
                name = torch.cuda.get_device_name(i)
                props = torch.cuda.get_device_properties(i)
                vram = round(props.total_memory / (1024 ** 3), 1)
                gpus.append({
                    "id": i,
                    "device_str": f"cuda:{i}",
                    "name": name,
                    "vram_gb": vram,
                    "type": "rocm" if is_rocm else "cuda",
                    "driver_version": hip_ver if is_rocm else getattr(torch.version, "cuda", None),
                })
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            gpus.append({
                "id": 0,
                "device_str": "mps",
                "name": "Apple Silicon Unified GPU (MPS)",
                "vram_gb": _get_system_memory_gb(),
                "type": "mps",
                "driver_version": "Apple Metal",
            })
    except Exception:
        pass
    return gpus


def _default_compute_settings() -> dict[str, object]:
    total_cores = os.cpu_count() or 4
    rec_cores = max(1, min(total_cores - 2, total_cores) if total_cores > 2 else total_cores)
    total_ram = _get_system_memory_gb()
    rec_ram = max(4.0, round(total_ram * 0.75, 1)) if total_ram > 4.0 else total_ram
    return {
        "selected_device": "auto",
        "cpu_cores": rec_cores,
        "ram_limit_gb": rec_ram,
        "ram_unlimited": False,
        "vram_fraction": 0.85,
        "rocm_gfx_override": "auto",
        "workspace_dir": str(_data_dir.parent),
    }


def _load_compute_settings() -> dict[str, object]:
    defaults = _default_compute_settings()
    if _settings_file.exists():
        try:
            saved = json.loads(_settings_file.read_text(encoding="utf-8"))
            defaults.update(saved)
        except Exception:
            pass
    return defaults


def _save_compute_settings(settings: dict[str, object]) -> None:
    _settings_file.write_text(json.dumps(settings, indent=2), encoding="utf-8")


def _apply_compute_settings(settings: dict[str, object]) -> None:
    try:
        import torch
        cores = int(settings.get("cpu_cores", 4))
        if cores > 0:
            torch.set_num_threads(cores)
            if hasattr(torch, "set_num_interop_threads"):
                try:
                    torch.set_num_interop_threads(max(1, min(4, cores // 2)))
                except Exception:
                    pass
        vram_frac = float(settings.get("vram_fraction", 0.85))
        if torch.cuda.is_available() and 0.1 <= vram_frac <= 1.0:
            dev_str = str(settings.get("selected_device", "auto"))
            dev_idx = 0
            if dev_str.startswith("cuda:") or dev_str.isdigit():
                try:
                    dev_idx = int(dev_str.replace("cuda:", ""))
                except Exception:
                    pass
            torch.cuda.set_per_process_memory_fraction(vram_frac, dev_idx)
    except Exception:
        pass


def _device_info() -> dict[str, object]:
    try:
        import torch

        if torch.cuda.is_available():
            hip_ver = getattr(torch.version, "hip", None)
            cuda_ver = getattr(torch.version, "cuda", None)
            is_rocm = hip_ver is not None
            name = torch.cuda.get_device_name(0) if torch.cuda.device_count() > 0 else ("AMD ROCm GPU" if is_rocm else "CUDA GPU")
            arch = "rocm" if is_rocm else "cuda"
            label = f"ROCm · {name}" if is_rocm else f"CUDA · {name}"
            return {
                "available": True,
                "accelerator": arch,
                "name": name,
                "label": label,
                "version": hip_ver if is_rocm else cuda_ver,
                "is_rocm": is_rocm,
            }
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            mem_gb = _get_system_memory_gb()
            return {
                "available": True,
                "accelerator": "mps",
                "name": "Apple Silicon (Metal MPS)",
                "label": f"Apple Silicon MPS · {mem_gb} GB Unified Memory",
                "version": "Metal Performance Shaders",
                "is_rocm": False,
            }
    except Exception:
        pass
    return {
        "available": False,
        "accelerator": "cpu",
        "name": "CPU",
        "label": "CPU Engine (Host Multicore)",
        "version": None,
        "is_rocm": False,
    }


def _cuda_available() -> bool:
    return bool(_device_info()["available"])


def _resolve_device(requested: str = "auto") -> str:
    settings = _load_compute_settings()
    configured_device = str(settings.get("selected_device", "auto"))

    if requested == "cpu" or configured_device == "cpu":
        return "cpu"
    if requested in ("cuda", "rocm"):
        return "cuda"
    if requested == "mps" or configured_device == "mps":
        return "mps"
    if configured_device.startswith("cuda:") or configured_device.isdigit():
        return "cuda"
    if configured_device == "cuda":
        return "cuda"
    if configured_device == "auto":
        info = _device_info()
        if info.get("accelerator") in ("cuda", "rocm"):
            return "cuda"
        if info.get("accelerator") == "mps":
            return "mps"

    explicit = os.environ.get("CLOUDNEX_DEVICE")
    if explicit:
        return "cuda" if explicit.lower() in ("cuda", "rocm") else explicit
    return "cuda" if _cuda_available() else "cpu"


class ComputeSettingsModel(BaseModel):
    selected_device: str = "auto"
    cpu_cores: int = Field(default=4, ge=1, le=128)
    ram_limit_gb: float = Field(default=16.0, ge=1.0, le=512.0)
    ram_unlimited: bool = False
    vram_fraction: float = Field(default=0.85, ge=0.1, le=1.0)
    rocm_gfx_override: str = "auto"
    workspace_dir: str = ""


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


class ExportRequest(BaseModel):
    checkpoint: str
    destination: str


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

    settings = _load_compute_settings()
    _apply_compute_settings(settings)

    command = [sys.executable, "--run-script", str(script), "--config", str(config)] if getattr(sys, "frozen", False) else [sys.executable, str(script), "--config", str(config)]
    for key, value in request.overrides.items():
        command.extend([f"--{key}", str(value).lower() if isinstance(value, bool) else str(value)])

    sub_env = {**os.environ, "PYTHONPATH": str(_engine_root)}
    cores_str = str(settings.get("cpu_cores", 4))
    sub_env["OMP_NUM_THREADS"] = cores_str
    sub_env["MKL_NUM_THREADS"] = cores_str
    sub_env["TORCH_NUM_THREADS"] = cores_str

    sel_device = str(settings.get("selected_device", "auto"))
    if sel_device == "cpu":
        sub_env["CUDA_VISIBLE_DEVICES"] = ""
        sub_env["CLOUDNEX_DEVICE"] = "cpu"
    elif sel_device.startswith("cuda:") or sel_device.isdigit():
        dev_id = sel_device.replace("cuda:", "")
        sub_env["CUDA_VISIBLE_DEVICES"] = dev_id
        sub_env["CLOUDNEX_DEVICE"] = "cuda"
    elif sel_device == "auto":
        sub_env["CLOUDNEX_DEVICE"] = "cuda" if _cuda_available() else "cpu"

    rocm_override = str(settings.get("rocm_gfx_override", "auto"))
    if rocm_override and rocm_override != "auto":
        sub_env["HSA_OVERRIDE_GFX_VERSION"] = rocm_override

    log_file = _log_path(job_id).open("ab")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=_engine_root,
        env=sub_env,
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
    settings = _load_compute_settings()
    _apply_compute_settings(settings)

    device = _resolve_device(request.device)
    args = ["--ckpt", str(checkpoint), "--label", checkpoint.stem, "--limit", str(request.limit), "--split", request.split, "--max_new_tokens", str(request.max_new_tokens), "--samples", str(request.samples), "--device", device]
    command = [sys.executable, "--run-script", str(script), *args] if getattr(sys, "frozen", False) else [sys.executable, str(script), *args]

    sub_env = {**os.environ, "PYTHONPATH": str(_engine_root)}
    cores_str = str(settings.get("cpu_cores", 4))
    sub_env["OMP_NUM_THREADS"] = cores_str
    sub_env["MKL_NUM_THREADS"] = cores_str
    sub_env["TORCH_NUM_THREADS"] = cores_str

    sel_device = str(settings.get("selected_device", "auto"))
    if sel_device == "cpu":
        sub_env["CUDA_VISIBLE_DEVICES"] = ""
        sub_env["CLOUDNEX_DEVICE"] = "cpu"
    elif sel_device.startswith("cuda:") or sel_device.isdigit():
        dev_id = sel_device.replace("cuda:", "")
        sub_env["CUDA_VISIBLE_DEVICES"] = dev_id
        sub_env["CLOUDNEX_DEVICE"] = "cuda"

    rocm_override = str(settings.get("rocm_gfx_override", "auto"))
    if rocm_override and rocm_override != "auto":
        sub_env["HSA_OVERRIDE_GFX_VERSION"] = rocm_override

    log_file = _log_path(job_id).open("ab")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    process = subprocess.Popen(command, cwd=_engine_root, env=sub_env, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=os.name != "nt", creationflags=creationflags)
    record = {"job_id": job_id, "kind": "evaluation", "stage": "evaluation", "title": f"GSM8K · {checkpoint.name}", "checkpoint": checkpoint.name, "pid": process.pid, "command": command, "log": str(_log_path(job_id)), "started": time.time(), "status": "running"}
    _processes[job_id] = process
    _write_job(record)
    return record


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "cloudnex-backend"}


@app.get("/api/system")
def system_info() -> dict[str, object]:
    info = _device_info()
    settings = _load_compute_settings()
    configured_device = str(settings.get("selected_device", "auto"))
    explicit = os.environ.get("CLOUDNEX_DEVICE")

    if configured_device == "cpu":
        device_label = "CPU Only"
    elif configured_device.startswith("cuda:") or configured_device.isdigit():
        device_label = f"GPU {configured_device}"
    elif explicit:
        device_label = explicit
    else:
        device_label = str(info["label"])

    return {
        "platform": platform.system(),
        "python": platform.python_version(),
        "device": device_label,
        "accelerator": info["accelerator"],
        "device_name": info["name"],
        "is_rocm": info["is_rocm"],
        "rocm_version": info["version"] if info["is_rocm"] else None,
        "allocated_cores": settings.get("cpu_cores"),
        "ram_limit_gb": settings.get("ram_limit_gb"),
        "ram_unlimited": settings.get("ram_unlimited"),
        "vram_fraction": settings.get("vram_fraction"),
    }


@app.get("/api/system/hardware")
def system_hardware() -> dict[str, object]:
    info = _device_info()
    gpus = _get_gpus()
    total_ram = _get_system_memory_gb()
    total_cores = os.cpu_count() or 4
    settings = _load_compute_settings()

    # Real RAM telemetry
    used_ram = 0.0
    free_ram = total_ram
    ram_pct = 0
    try:
        import psutil
        vm = psutil.virtual_memory()
        total_ram = round(vm.total / (1024 ** 3), 1)
        used_ram = round(vm.used / (1024 ** 3), 1)
        free_ram = round(vm.available / (1024 ** 3), 1)
        ram_pct = int(vm.percent)
    except Exception:
        pass

    # Real SSD / Disk telemetry for chosen workspace directory
    workspace_path = Path(settings.get("workspace_dir") or (_data_dir.parent)).expanduser().resolve()
    workspace_path.mkdir(parents=True, exist_ok=True)
    total_disk_gb = 500.0
    used_disk_gb = 100.0
    free_disk_gb = 400.0
    disk_pct = 20
    try:
        disk_usage = shutil.disk_usage(workspace_path)
        total_disk_gb = round(disk_usage.total / (1024 ** 3), 1)
        used_disk_gb = round(disk_usage.used / (1024 ** 3), 1)
        free_disk_gb = round(disk_usage.free / (1024 ** 3), 1)
        disk_pct = int(round((disk_usage.used / disk_usage.total) * 100))
    except Exception:
        pass

    # Real CPU usage load
    cpu_load_pct = 0
    try:
        import psutil
        cpu_load_pct = int(psutil.cpu_percent(interval=None))
    except Exception:
        pass

    # Real Network I/O
    net_rx_mb = 0.0
    net_tx_mb = 0.0
    try:
        import psutil
        net = psutil.net_io_counters()
        if net:
            net_rx_mb = round(net.bytes_recv / (1024 ** 2), 1)
            net_tx_mb = round(net.bytes_sent / (1024 ** 2), 1)
    except Exception:
        pass

    return {
        "cpu": {
            "total_cores": total_cores,
            "architecture": platform.machine(),
            "processor": platform.processor() or f"{platform.machine()} Processor",
            "load_percent": cpu_load_pct,
        },
        "memory": {
            "total_ram_gb": total_ram,
            "used_ram_gb": used_ram,
            "free_ram_gb": free_ram,
            "percent": ram_pct,
        },
        "storage": {
            "workspace_dir": str(workspace_path),
            "total_gb": total_disk_gb,
            "used_gb": used_disk_gb,
            "free_gb": free_disk_gb,
            "percent": disk_pct,
        },
        "network": {
            "bytes_recv_mb": net_rx_mb,
            "bytes_sent_mb": net_tx_mb,
            "status": "Local Air-Gapped (Zero Telemetry)",
        },
        "gpus": gpus,
        "accelerator_summary": info,
        "settings": settings,
    }


@app.post("/api/system/hardware")
def update_hardware_settings(settings: ComputeSettingsModel) -> dict[str, object]:
    data = settings.dict()
    _save_compute_settings(data)
    _apply_compute_settings(data)
    if data.get("workspace_dir"):
        try:
            custom_dir = Path(data["workspace_dir"]).expanduser().resolve()
            custom_dir.mkdir(parents=True, exist_ok=True)
            global _data_dir, _job_dir
            _data_dir = custom_dir / "data"
            _data_dir.mkdir(parents=True, exist_ok=True)
            _job_dir = custom_dir / "jobs"
            _job_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
    return {
        "status": "ok",
        "message": "Compute and hardware settings applied.",
        "settings": data,
    }


@app.get("/api/metrics/{stage}")
def metrics(stage: str, limit: int = 200) -> list[dict]:
    if stage not in STAGES:
        raise HTTPException(status_code=404, detail="Unknown training stage")
    records = []
    for directory in _log_dirs:
        for path in directory.glob(f"{stage}_*.jsonl") if directory.is_dir() else []:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record.get("step"), (int, float)):
                    records.append(record)
    records.sort(key=lambda item: (item.get("step", 0), item.get("wall", 0)))
    return records[-max(1, min(limit, 2000)):]


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
async def upload_data(
    request: Request,
    file: UploadFile | None = File(None),
    dataset_type: str = Form("general"),
) -> dict:
    allowed_types = {"pretrain", "sft", "preference", "rl", "general"}
    content_type = request.headers.get("content-type", "")

    # Handle JSON payload (from renderer app.js fetch)
    if "application/json" in content_type:
        body = await request.json()
        target_type = body.get("dataset_type", "general")
        if target_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Unsupported dataset type")
        raw_name = body.get("name") or f"corpus_{int(time.time())}.txt"
        filename = _safe_filename(raw_name)
        destination = _data_dir / filename
        if destination.exists():
            destination = _data_dir / f"{destination.stem}_{int(time.time())}{destination.suffix}"
        
        file_content = body.get("content", "")
        if isinstance(file_content, str):
            destination.write_text(file_content, encoding="utf-8")
        else:
            destination.write_bytes(bytes(file_content))

        metadata_path = _data_dir / "uploads.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        metadata[destination.name] = {"dataset_type": target_type, "uploaded": time.time()}
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        return {"name": destination.name, "size": destination.stat().st_size, "dataset_type": target_type}

    # Handle Multipart/form-data
    if file is None:
        raise HTTPException(status_code=400, detail="No file provided")
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


@app.post("/api/models/export")
def export_model(request: ExportRequest) -> dict[str, str | int]:
    source = _checkpoint_path(request.checkpoint)
    destination = Path(request.destination).expanduser().resolve()
    if destination == source:
        raise HTTPException(status_code=400, detail="Choose a different destination from the source checkpoint.")
    if destination.suffix.lower() != ".pt":
        destination = destination.with_suffix(".pt")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return {"name": destination.name, "destination": str(destination), "size": destination.stat().st_size}


@app.post("/api/chat")
def chat(request: ChatRequest) -> dict[str, str | float]:
    checkpoint = _checkpoint_path(request.checkpoint)
    settings = _load_compute_settings()
    _apply_compute_settings(settings)
    device = _resolve_device()
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
