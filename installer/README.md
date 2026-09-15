# CloudNex Local LLM Studio
> **Next-Generation Post-Training & Inference Studio for Local PyTorch AI**
>
> **Creator:** Mohammed Sheik  
> **Official Website:** [https://cloudnex.co.za](https://cloudnex.co.za)  
> **Platform Support:** Windows (x64), macOS (Apple Silicon & Intel), Linux (x86_64)  

---

## ⚡ Vision & Purpose

CloudNex Local LLM Studio was designed and built by **Mohammed Sheik** with a clear mission: to bring enterprise-grade post-training (Supervised Fine-Tuning, Direct Preference Optimization, PPO, and GRPO reasoning alignment) to local developer workstations and high-performance rigs without cloud dependency, data leakage, or complex DevOps overhead.

---

## 🚀 Key Highlights

1. **Zero-Setup Self-Contained Runtime**:
   - Packaged with an embedded, pre-compiled Python execution engine and PyTorch distribution.
   - **No manual Python installation, no virtualenv juggling, and no pip errors.**
   - Runs out of the box immediately upon installation.

2. **Native Hardware Accelerator Support**:
   - **AMD ROCm**: Native support for RDNA 4 (Radeon RX 9070 / 9070 XT), RDNA 3 (RX 7900 / 7800 / 7700), and RDNA 2 with automated HIP architecture override.
   - **NVIDIA CUDA**: Full tensor core acceleration for RTX 40/30/20 series and professional Ada/Ampere cards.
   - **Apple Silicon (MPS)**: Unified high-bandwidth memory acceleration on M1/M2/M3/M4 Macs.
   - **Multi-Core CPU**: High-throughput thread pooling with OpenMP and MKL optimizations.

3. **Total Data Sovereignty & 100% On-Device Privacy**:
   - No telemetry, no remote data tracking, and no external API dependencies.
   - Datasets, checkpoint weights, and inference prompts stay strictly on your local disk.

4. **Comprehensive Post-Training Suite**:
   - Pretraining from raw tokens or custom datasets.
   - Supervised Fine-Tuning (SFT) for instruction following.
   - Pairwise Preference & Direct Preference Optimization (DPO).
   - Group Relative Policy Optimization (GRPO) for self-verifying mathematical reasoning.
   - Built-in GSM8K benchmark evaluator and local chat runner.

---

## 💻 Hardware Requirements

| Tier | CPU Cores | System RAM | GPU VRAM | Recommended Models |
| :--- | :--- | :--- | :--- | :--- |
| **Minimum** | 4 Cores | 16 GB | 6 GB (or CPU-only) | 125M – 500M Parameters |
| **Recommended** | 8+ Cores | 32 GB | 12 GB – 16 GB | 1B – 3B Parameters (Llama, Qwen, SmolLM) |
| **High Performance** | 16+ Cores | 64 GB+ | 24 GB+ (RTX 4090 / RX 7900 XTX) | 7B – 8B Parameter Models |

---

## 🛠️ Installation

### Windows (`.exe` NSIS Installer)
1. Download `CloudNex-Local-LLM-Studio-Setup.exe`.
2. Run the installer, review and agree to the Terms & Conditions by Mohammed Sheik.
3. Choose your installation path and finish setup. The studio launches automatically.

### macOS (`.dmg`)
1. Open `CloudNex-Local-LLM-Studio.dmg`.
2. Accept the software license agreement.
3. Drag `CloudNex Studio` to your `/Applications` folder.

### Linux (`.AppImage` / `.deb`)
```bash
chmod +x CloudNex-Local-LLM-Studio.AppImage
./CloudNex-Local-LLM-Studio.AppImage
```

---

## 🌐 Connect with the Creator

- **Founder & Architect:** Mohammed Sheik
- **Company:** CloudNex
- **Website:** [https://cloudnex.co.za](https://cloudnex.co.za)
- **Copyright:** © 2026 Mohammed Sheik. All Rights Reserved.
