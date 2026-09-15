"""Local FastAPI service used by the CloudNex desktop shell."""

from __future__ import annotations

import os
import platform
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="CloudNex Local LLM Studio", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null", "file://", "http://localhost"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "cloudnex-backend"}


@app.get("/api/system")
def system_info() -> dict[str, str]:
    return {
        "platform": platform.system(),
        "python": platform.python_version(),
        "working_directory": str(Path.cwd()),
        "device": os.environ.get("CLOUDNEX_DEVICE", "auto"),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("CLOUDNEX_BACKEND_PORT", "8000")),
        log_level="warning",
    )
