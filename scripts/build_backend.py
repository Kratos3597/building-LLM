"""Build the self-contained desktop backend executable with PyInstaller."""

from __future__ import annotations

import subprocess
import sys
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DIST = BACKEND / "dist"
WORK = BACKEND / "build"
SPEC = BACKEND / "spec"


def main() -> None:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        executable_name = "cloudnex-backend.exe" if sys.platform == "win32" else "cloudnex-backend"
        if (DIST / executable_name).exists():
            print(f"PyInstaller not found, but found existing backend executable at {DIST / executable_name}. Skipping build.")
            return
        raise SystemExit(
            "PyInstaller is required. Install the desktop extra first: "
            "python -m pip install -e .[desktop]"
        )

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "cloudnex-backend",
        "--distpath",
        str(DIST),
        "--workpath",
        str(WORK),
        "--specpath",
        str(SPEC),
        str(BACKEND / "app.py"),
    ]
    data_separator = os.pathsep
    for directory in ("scripts", "src", "config", "data_loader", "configs"):
        command.extend(["--add-data", f"{ROOT / directory}{data_separator}engine/{directory}"])
    command.extend([
        "--collect-all", "torch",
        "--collect-all", "numpy",
        "--collect-all", "tiktoken",
        "--collect-all", "h5py",
        "--collect-all", "multipart",
    ])
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == "__main__":
    main()