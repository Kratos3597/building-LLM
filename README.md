# CloudNex Local LLM Studio

CloudNex Local LLM Studio is a cross-platform desktop application for running the local PyTorch language-model workflow from one focused workspace. It combines an Electron desktop shell, a secure renderer, and a Python sidecar that keeps model execution local to the user's machine.

## Product Architecture

```text
Electron main process
    |-- secure preload bridge
    |-- renderer/ (HTML, CSS, JavaScript)
    |-- backend/ (FastAPI sidecar on localhost:8000)
    `-- src/, data_loader/, scripts/ (PyTorch training engine)
```

The desktop shell owns the application window and sidecar lifecycle. The Python service owns model operations, training jobs, checkpoints, and hardware access. The renderer communicates with the service through the preload bridge and a local HTTP API; it never receives unrestricted Node.js or filesystem access.

## Development Setup

Install Python dependencies and the Electron development dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[ui]"
pip install -e ".[desktop]"
npm install
```

Start the desktop application:

```bash
npm start
```

The Electron main process starts the FastAPI sidecar, waits for `http://127.0.0.1:8000/health`, and then loads the renderer. Closing the window terminates the sidecar and its process tree.

For direct backend development:

```bash
python backend/app.py
```

## Packaging

Build native installers for the current host with:

```bash
npm run build
```

Electron Builder is configured for macOS (`.dmg` and `.app`), Windows (`nsis`), and Linux (`AppImage`). `npm run build` first compiles `backend/app.py` into a one-file PyInstaller executable, then embeds that executable inside the installer. The end user does not need Python, FastAPI, uvicorn, Node.js, or npm installed.

Build on the target operating system and architecture. The repository includes a GitHub Actions workflow that builds Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon artifacts. Download the completed artifact from the workflow run and install it on the matching operating system. GPU acceleration still depends on the user's installed graphics drivers and compatible PyTorch build.

## Python Engine

The PyTorch model and training stages remain available under `src/`, `data_loader/`, `scripts/`, and `configs/`. Smoke configurations in `configs/smoke/` provide small CPU-friendly runs.

The Data workspace accepts local TXT, JSONL, CSV, HDF5, and Zstandard files by click or drag and drop. Each upload is stored under the user's CloudNex data folder with a type label such as pretraining, SFT, preference, or RL prompts. The selected files remain local and can be used by the preparation and training workflow.

Focused checks:

```bash
PYTHONPATH=. python tests/test_rl_math.py
PYTHONPATH=. python tests/test_post_training_smoke.py
```

## License and Attribution

CloudNex Local LLM Studio is distributed under the MIT License. See [LICENSE](LICENSE) for the complete terms and required transformer logic attribution.

Copyright (c) 2026 Mohammed Altaaf Sheik
