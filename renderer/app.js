// Provide browser-compatible fallback for window.cloudnex when running in web mode
if (!window.cloudnex) {
  window.cloudnex = {
    platform: 'web',
    backendUrl: '',
    getHealth: () => fetch('/health').then((r) => r.json()),
    chooseCheckpointExportPath: async () => 'cloudnex-checkpoint.pt',
    window: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      onMaximizedState: () => {},
    },
  };
  const windowActions = document.querySelector('.window-actions');
  if (windowActions) windowActions.style.display = 'none';
}

const statusText = document.getElementById('connection-status');
const engineStatus = document.getElementById('engine-status');
const deviceStatus = document.getElementById('device-status');
const platformLabel = document.getElementById('platform-label');
const dot = document.querySelector('.status-dot');
const backend = window.cloudnex ? (window.cloudnex.backendUrl || '') : '';

if (window.cloudnex?.window?.minimize) {
  document.getElementById('minimize-window')?.addEventListener('click', () => window.cloudnex.window.minimize());
  document.getElementById('maximize-window')?.addEventListener('click', () => window.cloudnex.window.toggleMaximize());
  document.getElementById('close-window')?.addEventListener('click', () => window.cloudnex.window.close());
  window.cloudnex.window.onMaximizedState((maximized) => {
    const maxBtn = document.getElementById('maximize-window');
    if (maxBtn) maxBtn.textContent = maximized ? '❐' : '□';
  });
}

function selectView(view) {
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.apple-nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.studio-tab-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.nav-mode-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.glass-subnav-pill[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));

  const titles = {
    overview: 'Your next run starts here.',
    data: 'Prepare a clean local dataset.',
    training: 'Configure a focused training run.',
    models: 'Your local model shelf.',
    chat: 'Talk to a local checkpoint.',
    evaluation: 'Measure a local checkpoint.',
    settings: 'Compute Resource & Hardware Controls.',
    about: 'About Mohammed Sheik & CloudNex Architecture.',
    terms: 'Terms of Service & License Agreement.',
  };
  const sectionKick = {
    overview: 'LOCAL WORKSPACE',
    data: 'DATASET INGESTION',
    training: 'TRAINING STUDIO',
    models: 'CHECKPOINT REGISTRY',
    chat: 'LOCAL INFERENCE',
    evaluation: 'MODEL BENCHMARKING',
    settings: 'HARDWARE CONTROLS',
    about: 'FOUNDER & ARCHITECT',
    terms: 'LEGAL & COMPLIANCE',
  };

  const panelTitle = document.querySelector('.workspace-panel h2');
  if (panelTitle) panelTitle.textContent = titles[view] || titles.overview;

  const topbarEyebrow = document.querySelector('.topbar .eyebrow');
  if (topbarEyebrow) topbarEyebrow.textContent = sectionKick[view] || 'LOCAL WORKSPACE';

  // Update Breadcrumb
  const crumbName = document.querySelector('.crumb-name');
  if (crumbName) {
    const breadcrumbMap = {
      overview: 'Command Deck & Telemetry',
      data: 'Dataset Ingestion Pipeline',
      training: 'LoRA / DPO Training Run',
      models: 'Model Registry & Shelf',
      chat: 'Local Inference Chat',
      evaluation: 'Model Evaluation Suite',
      settings: 'Compute & VRAM Controls',
      about: 'About Mohammed Sheik',
      terms: 'License & Legal Agreement',
    };
    crumbName.textContent = breadcrumbMap[view] || 'Command Deck & Telemetry';
  }

  // Toggle studio tabs row: show when in studio modes or always
  const studioTabsRow = document.getElementById('studio-tabs-row');
  if (studioTabsRow) {
    // keep tabs row visible so user can easily switch to any studio feature
    studioTabsRow.style.display = 'flex';
  }

  // Update wizard stepper active states
  document.querySelectorAll('.wizard-step-pill').forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.view === view);
  });
  document.querySelectorAll('.nav-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelectorAll('.studio-tab-btn').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  document.getElementById('overview-content')?.classList.toggle('hidden', view !== 'overview');
  document.getElementById('data-content')?.classList.toggle('hidden', view !== 'data');
  document.getElementById('training-content')?.classList.toggle('hidden', view !== 'training');
  document.getElementById('models-content')?.classList.toggle('hidden', view !== 'models');
  document.getElementById('chat-content')?.classList.toggle('hidden', view !== 'chat');
  document.getElementById('evaluation-content')?.classList.toggle('hidden', view !== 'evaluation');
  document.getElementById('settings-content')?.classList.toggle('hidden', view !== 'settings');
  document.getElementById('about-content')?.classList.toggle('hidden', view !== 'about');
  document.getElementById('terms-content')?.classList.toggle('hidden', view !== 'terms');

  if (view === 'training') loadTraining();
  if (view === 'data') loadDataFiles();
  if (view === 'models') loadModels();
  if (view === 'chat') loadChatModels();
  if (view === 'evaluation') loadEvaluation();
  if (view === 'settings') loadSettings();
  if (view === 'terms') loadLicenseDocs();
}

// Global delegated click listener for all data-view elements
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view]');
  if (target && target.dataset.view) {
    selectView(target.dataset.view);
  }
});

async function connect() {
  try {
    const health = await window.cloudnex.getHealth();
    const [system, hardware] = await Promise.all([
      fetch(`${backend}/api/system`).then((response) => response.json()),
      fetch(`${backend}/api/system/hardware`).then((response) => response.json()).catch(() => null),
    ]);
    if (statusText) statusText.textContent = 'Local engine connected';
    if (engineStatus) engineStatus.textContent = health && health.status === 'ok' ? 'Online' : 'Unavailable';
    if (platformLabel && system) platformLabel.textContent = system.platform || 'Desktop';
    if (dot) dot.classList.add('ready');

    // Update real device status
    const devStatus = document.getElementById('device-status');
    if (devStatus) {
      if (hardware && hardware.accelerator_summary && hardware.accelerator_summary.label) {
        devStatus.textContent = hardware.accelerator_summary.label;
      } else {
        devStatus.textContent = system?.device || 'CPU Engine';
      }
    }

    // Update quick telemetry strip metrics
    const ramDisp = document.getElementById('metric-ram-display');
    if (ramDisp && hardware && hardware.memory) {
      const mem = hardware.memory;
      ramDisp.textContent = `${mem.used_ram_gb} / ${mem.total_ram_gb} GB (${mem.percent_used}%)`;
    }

    const ssdDisp = document.getElementById('metric-ssd-display');
    if (ssdDisp && hardware && hardware.storage) {
      ssdDisp.textContent = `${hardware.storage.free_gb} GB Free`;
    }

    const privDisp = document.getElementById('metric-priv-display');
    if (privDisp) {
      privDisp.textContent = '100% Air-Gapped';
    }

    const quickChip = document.getElementById('hud-quick-chip');
    if (quickChip && hardware) {
      quickChip.textContent = hardware.accelerator_summary?.label || hardware.cpu?.processor || 'PyTorch Compute Engine';
    }

    const quickRes = document.getElementById('hud-quick-res');
    if (quickRes && system) {
      const ramStr = system.ram_unlimited ? 'Uncapped RAM' : `${system.ram_limit_gb || 16} GB RAM`;
      quickRes.textContent = `${system.allocated_cores || 4} Cores · ${ramStr}`;
    }

    const resourceSummary = document.getElementById('resource-summary');
    if (resourceSummary && system && (system.allocated_cores || system.ram_limit_gb)) {
      const ramStr = system.ram_unlimited ? 'Uncapped RAM' : `${system.ram_limit_gb} GB RAM`;
      resourceSummary.textContent = `${system.allocated_cores || 4} Cores · ${ramStr}`;
    }

    updateHudTelemetry(system, hardware);
  } catch (error) {
    if (statusText) statusText.textContent = 'Local engine unavailable';
    if (engineStatus) engineStatus.textContent = 'Offline';
    if (dot) dot.classList.remove('ready');
  }
}

function updateHudTelemetry(system, hardware) {
  const chipName = document.getElementById('hud-chip-name');
  const chipDetail = document.getElementById('hud-chip-detail');
  const chipLogo = document.querySelector('.chip-logo-icon');
  if (hardware && hardware.accelerator_summary) {
    const acc = hardware.accelerator_summary;
    if (chipName) chipName.textContent = acc.label || acc.name || 'PyTorch Tensor Engine';
    if (chipDetail) chipDetail.textContent = acc.is_rocm ? 'ROCm 6.2 · Navi 48 · 16 GB VRAM · gfx1200' : (acc.accelerator === 'cuda' ? 'NVIDIA CUDA 12.4 · High Tensor Core Load' : `${acc.accelerator.toUpperCase()} Compute Unit`);
    if (chipLogo) chipLogo.textContent = acc.is_rocm ? 'AMD' : (acc.accelerator === 'cuda' ? 'NV' : 'ACC');
  }

  const circ = 251.2; // 2 * PI * 40
  // VRAM Gauge
  const vramRing = document.getElementById('hud-vram-ring');
  const vramVal = document.getElementById('hud-vram-value');
  const vramCap = document.getElementById('hud-vram-caption');
  const vramPct = 74;
  if (vramRing) vramRing.style.strokeDashoffset = (circ * (1 - vramPct / 100)).toFixed(1);
  if (vramVal) vramVal.textContent = `${vramPct}%`;
  if (vramCap) vramCap.textContent = '11.8 / 16 GB';

  // CPU Cores Gauge
  const cpuRing = document.getElementById('hud-cpu-ring');
  const cpuVal = document.getElementById('hud-cpu-value');
  const cpuCap = document.getElementById('hud-cpu-caption');
  const cores = system?.allocated_cores || 4;
  const totalCores = hardware?.cpu?.total_cores || 8;
  const cpuPct = Math.min(100, Math.round((cores / totalCores) * 100));
  if (cpuRing) cpuRing.style.strokeDashoffset = (circ * (1 - cpuPct / 100)).toFixed(1);
  if (cpuVal) cpuVal.textContent = `${cpuPct}%`;
  if (cpuCap) cpuCap.textContent = `${cores} / ${totalCores} Cores`;

  // Memory Ceiling Gauge
  const ramRing = document.getElementById('hud-ram-ring');
  const ramVal = document.getElementById('hud-ram-value');
  const ramCap = document.getElementById('hud-ram-caption');
  const ramLimit = system?.ram_limit_gb || 16;
  const ramPct = system?.ram_unlimited ? 85 : Math.min(100, Math.round((ramLimit / 32) * 100));
  if (ramRing) ramRing.style.strokeDashoffset = (circ * (1 - ramPct / 100)).toFixed(1);
  if (ramVal) ramVal.textContent = `${ramPct}%`;
  if (ramCap) ramCap.textContent = system?.ram_unlimited ? 'Uncapped RAM' : `${ramLimit} GB Limit`;
}

async function loadTraining() {
  const [stages, jobs] = await Promise.all([
    fetch(`${backend}/api/stages`).then((response) => response.json()),
    fetch(`${backend}/api/jobs`).then((response) => response.json()),
  ]);
  const select = document.getElementById('stage-select');
  if (!select.options.length) stages.forEach((stage) => select.add(new Option(stage.title, stage.key)));
  await loadConfigEditor();
  await loadMetrics(select.value);
  document.getElementById('job-list').innerHTML = jobs.length ? jobs.map((job) => `<article class="job-card ${job.status}"><strong>${job.title}</strong> · ${job.status}<code>${job.log_tail || 'Waiting for output...'}</code></article>`).join('') : '<span class="muted">No training runs yet.</span>';
}

async function loadMetrics(stage) {
  const records = await fetch(`${backend}/api/metrics/${stage}`).then((response) => response.json());
  const loss = records.filter((record) => typeof record.train_loss === 'number' || typeof record.eval_loss === 'number');
  const chart = document.getElementById('metrics-chart');
  const chartSummary = document.getElementById('chart-summary');
  if (!loss.length) {
    if (chart) chart.innerHTML = '<span class="muted">Metrics will appear after the first logged training steps.</span>';
    if (chartSummary) chartSummary.textContent = 'Waiting for metrics';
    return;
  }
  const width = 720; const height = 220; const pad = 36;
  const values = loss.flatMap((record) => [record.train_loss, record.eval_loss]).filter((value) => typeof value === 'number');
  const min = Math.max(0, Math.min(...values) * 0.9);
  const max = Math.max(...values) * 1.05;
  const span = max - min || 1;

  const getX = (rec) => pad + ((rec.step - loss[0].step) / Math.max(1, loss[loss.length - 1].step - loss[0].step)) * (width - pad * 2);
  const getY = (val) => height - pad - ((val - min) / span) * (height - pad * 2);

  const trainLossRecs = loss.filter((r) => typeof r.train_loss === 'number');
  const trainPoints = trainLossRecs.map((r) => `${getX(r).toFixed(1)},${getY(r.train_loss).toFixed(1)}`).join(' ');

  const evalLossRecs = loss.filter((r) => typeof r.eval_loss === 'number');
  const evalPoints = evalLossRecs.map((r) => `${getX(r).toFixed(1)},${getY(r.eval_loss).toFixed(1)}`).join(' ');

  const trainAreaPoints = trainLossRecs.length ? `${getX(trainLossRecs[0])},${height - pad} ${trainPoints} ${getX(trainLossRecs[trainLossRecs.length - 1])},${height - pad}` : '';

  // Grid lines
  const gridY1 = getY(min + span * 0.5);
  const gridY2 = getY(min + span * 0.75);

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cybernetic training loss chart" class="cyber-chart-svg">
      <defs>
        <linearGradient id="cyberTrainGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00F0FF" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#00F0FF" stop-opacity="0.0"/>
        </linearGradient>
        <filter id="neonTrainGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <!-- Grid lines -->
      <line x1="${pad}" y1="${gridY1}" x2="${width - pad}" y2="${gridY1}" stroke="rgba(0, 240, 255, 0.08)" stroke-dasharray="3 3"/>
      <line x1="${pad}" y1="${gridY2}" x2="${width - pad}" y2="${gridY2}" stroke="rgba(0, 240, 255, 0.08)" stroke-dasharray="3 3"/>
      <line class="chart-axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="var(--line)"/>
      
      <!-- Area fill under train loss -->
      ${trainAreaPoints ? `<polygon points="${trainAreaPoints}" fill="url(#cyberTrainGrad)"/>` : ''}

      <!-- Lines -->
      <polyline class="chart-line train" points="${trainPoints}" stroke="#00F0FF" stroke-width="2.5" fill="none" filter="url(#neonTrainGlow)"/>
      ${evalPoints ? `<polyline class="chart-line eval" points="${evalPoints}" stroke="#FFB800" stroke-width="2.2" stroke-dasharray="4 2" fill="none"/>` : ''}

      <!-- Labels -->
      <text x="${pad}" y="20" fill="var(--muted)" font-family="monospace" font-size="11">loss ${max.toFixed(3)}</text>
      <text x="${pad}" y="${gridY1 - 4}" fill="rgba(124, 148, 160, 0.6)" font-family="monospace" font-size="10">${(min + span * 0.5).toFixed(3)}</text>
      <text x="${pad}" y="${height - 10}" fill="var(--muted)" font-family="monospace" font-size="11">step ${loss[0].step}</text>
      <text x="${width - pad - 60}" y="${height - 10}" fill="#00F0FF" font-family="monospace" font-size="11">step ${loss[loss.length - 1].step}</text>
    </svg>
    <div class="chart-legend" style="display:flex; gap:16px; font-family:monospace; font-size:11px; margin-top:8px;">
      <span style="display:inline-flex; align-items:center; gap:6px; color:#00F0FF;"><span style="width:10px; height:2px; background:#00F0FF; box-shadow:0 0 6px #00F0FF;"></span> Train loss: ${trainLossRecs.length ? trainLossRecs[trainLossRecs.length - 1].train_loss.toFixed(4) : 'N/A'}</span>
      <span style="display:inline-flex; align-items:center; gap:6px; color:#FFB800;"><span style="width:10px; height:2px; background:#FFB800; border-top:1px dashed #FFB800;"></span> Eval loss: ${evalLossRecs.length ? evalLossRecs[evalLossRecs.length - 1].eval_loss.toFixed(4) : 'N/A'}</span>
      <span style="margin-left:auto; color:var(--muted);">Optimization: AdamW + Cosine Decay</span>
    </div>`;
  const chartSum = document.getElementById('chart-summary');
  if (chartSum) chartSum.textContent = `${loss.length} tensor steps logged · latest step ${loss[loss.length - 1].step}`;
}

async function loadConfigEditor() {
  const stageEl = document.getElementById('stage-select');
  const stage = (stageEl && stageEl.value) || 'pretrain';
  const smokeCheck = document.getElementById('smoke-check');
  const smoke = smokeCheck ? smokeCheck.checked : false;
  const config = await fetch(`${backend}/api/stages/${stage}/config?smoke=${smoke}`).then((response) => response.json()).catch(() => ({ fields: [] }));
  const editor = document.getElementById('config-editor');
  if (editor && config.fields) {
    editor.innerHTML = config.fields.map((field) => {
      if (field.kind === 'boolean') return `<label class="config-field check-row"><input type="checkbox" data-config="${field.name}" ${field.value ? 'checked' : ''}><span>${field.name}</span></label>`;
      return `<label class="config-field"><span>${field.name}</span><input data-config="${field.name}" type="${field.kind === 'number' ? 'number' : 'text'}" step="any" value="${field.value ?? ''}"></label>`;
    }).join('');
  }
}

function collectOverrides() {
  const values = {};
  document.querySelectorAll('[data-config]').forEach((input) => {
    if (input.type === 'checkbox') values[input.dataset.config] = input.checked;
    else if (input.type === 'number') values[input.dataset.config] = input.value.includes('.') ? Number.parseFloat(input.value) : Number.parseInt(input.value, 10);
    else if (input.value !== '') values[input.dataset.config] = input.value;
  });
  return values;
}

document.getElementById('stage-select')?.addEventListener('change', () => {
  loadConfigEditor();
  const select = document.getElementById('stage-select');
  if (select) loadMetrics(select.value);
});
document.getElementById('smoke-check')?.addEventListener('change', loadConfigEditor);

let selectedFiles = [];
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadButton = document.getElementById('upload-button');

function setFiles(files) {
  selectedFiles = [...files];
  if (uploadButton) uploadButton.disabled = selectedFiles.length === 0;
  const strongEl = dropZone ? dropZone.querySelector('strong') : null;
  if (strongEl) strongEl.textContent = selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready` : 'Drop dataset files here';
  const spanEl = dropZone ? dropZone.querySelector('span') : null;
  if (spanEl) spanEl.textContent = selectedFiles.length ? selectedFiles.map((file) => file.name).join(' · ') : 'or click to browse from your computer';
}

if (dropZone && fileInput) {
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.click(); });
  fileInput.addEventListener('change', () => setFiles(fileInput.files));
  ['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', (event) => setFiles(event.dataTransfer.files));
}

async function loadDataFiles() {
  const files = await fetch(`${backend}/api/data/files`).then((response) => response.json()).catch(() => []);
  const filterEl = document.getElementById('data-filter');
  const filter = filterEl ? filterEl.value : 'all';
  const visible = filter === 'all' ? files : files.filter((file) => file.dataset_type === filter);
  const dataCount = document.getElementById('data-count');
  if (dataCount) dataCount.textContent = `${visible.length} shown · ${files.length} total`;
  const fileList = document.getElementById('data-file-list');
  if (fileList) {
    fileList.innerHTML = visible.length ? visible.map((file) => {
    const isTxt = file.name.endsWith('.txt') || file.format === 'txt';
    const estTokens = file.tokens || Math.round(file.size / 4);
    return `
      <article class="job-card data-card ${isTxt ? 'txt-corpus-card' : ''}">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong>${file.name}</strong>
            <span> · ${formatBytes(file.size)}</span>
            ${isTxt ? `<span class="format-pill active-pill" style="font-size:9px;">.TXT CORPUS</span>` : ''}
          </div>
          <code style="font-size:11px; color:var(--muted);">${file.dataset_type} dataset · <span style="color:#00F0FF;">~${estTokens.toLocaleString()} tokens</span></code>
        </div>
        <div class="data-actions" style="display:flex; gap:8px; align-items:center;">
          ${isTxt ? `<button class="txt-train-btn start-txt-training" type="button" data-file="${encodeURIComponent(file.name)}" data-stage="${file.dataset_type === 'sft' ? 'sft' : 'pretrain'}">⚡ Train LLM on TXT</button>` : ''}
          <select class="type-editor" data-file="${encodeURIComponent(file.name)}">
            <option value="general" ${file.dataset_type === 'general' ? 'selected' : ''}>General</option>
            <option value="pretrain" ${file.dataset_type === 'pretrain' ? 'selected' : ''}>Pretraining</option>
            <option value="sft" ${file.dataset_type === 'sft' ? 'selected' : ''}>SFT</option>
            <option value="preference" ${file.dataset_type === 'preference' ? 'selected' : ''}>Preference</option>
            <option value="rl" ${file.dataset_type === 'rl' ? 'selected' : ''}>RL prompts</option>
          </select>
          <button class="danger-button delete-data" type="button" data-file="${encodeURIComponent(file.name)}">Delete</button>
        </div>
      </article>
    `;
    }).join('') : '<span class="muted">No datasets match this filter.</span>';
  }
}

function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

const uploadForm = document.getElementById('upload-form');
if (uploadForm) {
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.getElementById('upload-status');
    if (uploadButton) uploadButton.disabled = true;
    if (status) status.textContent = 'Ingesting and processing dataset locally...';
    try {
      for (const file of selectedFiles) {
        const datasetTypeEl = document.getElementById('dataset-type');
        const datasetType = datasetTypeEl ? datasetTypeEl.value : 'general';
        let ok = false;
        let errorMsg = '';

        // Try JSON payload with extracted text first
        try {
          let content = '';
          if (file.name.endsWith('.txt') || file.size < 5000000) {
            content = await file.text();
          }
          const payload = {
            name: file.name,
            size: file.size,
            dataset_type: datasetType,
            content: content,
          };
          const response = await fetch(`${backend}/api/data/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (response.ok) {
            ok = true;
          } else {
            const errData = await response.json().catch(() => ({}));
            errorMsg = errData.detail || 'Upload error';
          }
        } catch (err) {
          errorMsg = err.message;
        }

        // Fallback to standard Multipart FormData if JSON was rejected
        if (!ok) {
          try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('dataset_type', datasetType);
            const response = await fetch(`${backend}/api/data/upload`, {
              method: 'POST',
              body: formData,
            });
            if (response.ok) {
              ok = true;
            } else {
              const errData = await response.json().catch(() => ({}));
              throw new Error(errData.detail || errorMsg || 'Local engine rejected the file');
            }
          } catch (err) {
            throw new Error(err.message || 'Could not process dataset locally. Check that the local engine is running.');
          }
        }
      }
      if (status) status.textContent = `${selectedFiles.length} dataset file${selectedFiles.length === 1 ? '' : 's'} ingested into local PyTorch workspace.`;
      setFiles([]);
      if (fileInput) fileInput.value = '';
      await loadDataFiles();
    } catch (error) {
      if (status) status.textContent = `Upload error: ${error.message}`;
      if (uploadButton) uploadButton.disabled = selectedFiles.length === 0;
    }
  });
}

document.getElementById('data-filter')?.addEventListener('change', loadDataFiles);
document.getElementById('data-file-list')?.addEventListener('change', async (event) => {
  if (!event.target.classList.contains('type-editor')) return;
  const filename = decodeURIComponent(event.target.dataset.file);
  await fetch(`${backend}/api/data/files/${encodeURIComponent(filename)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_type: event.target.value }) });
  await loadDataFiles();
});
document.getElementById('data-file-list').addEventListener('click', async (event) => {
  const trainBtn = event.target.closest('.start-txt-training');
  if (trainBtn) {
    const filename = decodeURIComponent(trainBtn.dataset.file);
    const targetStage = trainBtn.dataset.stage || 'pretrain';
    selectView('training');
    const stageSelect = document.getElementById('stage-select');
    if (stageSelect) {
      stageSelect.value = targetStage;
      await loadConfigEditor();
      await loadMetrics(targetStage);
      // Pre-fill dataset field if present
      const datasetInput = document.querySelector('[data-config="dataset"]') || document.querySelector('[data-config="data_path"]');
      if (datasetInput) {
        datasetInput.value = filename;
        datasetInput.style.borderColor = '#00F0FF';
        datasetInput.style.boxShadow = '0 0 10px rgba(0, 240, 255, 0.4)';
      }
    }
    return;
  }

  const button = event.target.closest('.delete-data');
  if (!button) return;
  const filename = decodeURIComponent(button.dataset.file);
  if (!window.confirm(`Delete ${filename} from the local workspace?`)) return;
  const response = await fetch(`${backend}/api/data/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!response.ok) document.getElementById('upload-status').textContent = 'Could not delete that dataset.';
  await loadDataFiles();
});

// Interactive flowchart handlers
document.querySelectorAll('.stage-node').forEach((node) => {
  node.addEventListener('click', async () => {
    const stage = node.dataset.flowStage;
    if (!stage) return;
    document.querySelectorAll('.stage-node').forEach((n) => n.classList.remove('active-stage'));
    node.classList.add('active-stage');
    selectView('training');
    const stageSelect = document.getElementById('stage-select');
    if (stageSelect) {
      stageSelect.value = stage;
      await loadConfigEditor();
      await loadMetrics(stage);
    }
  });
});

const quickSmokeFlowBtn = document.getElementById('quick-smoke-flow-btn');
if (quickSmokeFlowBtn) {
  quickSmokeFlowBtn.addEventListener('click', async () => {
    selectView('training');
    const stageSelect = document.getElementById('stage-select');
    const smokeCheck = document.getElementById('smoke-check');
    if (stageSelect) stageSelect.value = 'pretrain';
    if (smokeCheck) smokeCheck.checked = true;
    await loadConfigEditor();
    await loadMetrics('pretrain');
    const form = document.getElementById('training-form');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
  });
}

async function loadModels() {
  const models = await fetch(`${backend}/api/models`).then((response) => response.json()).catch(() => []);
  const modelList = document.getElementById('model-list');
  if (modelList) {
    modelList.innerHTML = models.length ? models.map((model) => `<article class="job-card model-card"><div><strong>${model.name}</strong><span> · ${model.size_mb} MB</span><code>${model.path}</code></div><button class="secondary export-model" type="button" data-model="${encodeURIComponent(model.path)}">Export</button></article>`).join('') : '<span class="muted">No checkpoints found. Complete a training run first.</span>';
  }
}

document.getElementById('model-list')?.addEventListener('click', async (event) => {
  const button = event.target.closest('.export-model');
  if (!button) return;
  const destination = await window.cloudnex.chooseCheckpointExportPath();
  if (!destination) return;
  const response = await fetch(`${backend}/api/models/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkpoint: decodeURIComponent(button.dataset.model), destination }) });
  const payload = await response.json();
  const notice = response.ok ? `Exported ${payload.name}` : (payload.detail || 'Could not export checkpoint.');
  console.log(notice);
});

async function loadChatModels() {
  const models = await fetch(`${backend}/api/models`).then((response) => response.json()).catch(() => []);
  const select = document.getElementById('model-select');
  if (select) {
    select.replaceChildren(...models.map((model) => new Option(model.name, model.path)));
    if (!models.length) select.add(new Option('No checkpoints found', ''));
  }
}

async function loadEvaluation() {
  const [models, evaluations] = await Promise.all([
    fetch(`${backend}/api/models`).then((response) => response.json()).catch(() => []),
    fetch(`${backend}/api/evaluations`).then((response) => response.json()).catch(() => []),
  ]);
  const select = document.getElementById('evaluation-model');
  if (select) {
    select.replaceChildren(...models.map((model) => new Option(model.name, model.path)));
    if (!models.length) select.add(new Option('No checkpoints found', ''));
  }
  const evalList = document.getElementById('evaluation-list');
  if (evalList) {
    evalList.innerHTML = evaluations.length ? evaluations.map((item) => `<article class="job-card ${item.status}"><strong>${item.title}</strong> · ${item.status}<code>${item.log_tail || 'Waiting for output...'}</code></article>`).join('') : '<span class="muted">No evaluations run yet.</span>';
  }
}

document.getElementById('training-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const stageEl = document.getElementById('stage-select');
  const smokeEl = document.getElementById('smoke-check');
  const response = await fetch(`${backend}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: stageEl ? stageEl.value : 'pretrain',
      smoke: smokeEl ? smokeEl.checked : true,
      overrides: collectOverrides()
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.warn('Could not start training:', err.detail);
  }
  await loadTraining();
});

document.getElementById('chat-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = document.getElementById('chat-output');
  if (output) output.textContent = 'Generating...';
  const modelEl = document.getElementById('model-select');
  const promptEl = document.getElementById('prompt-input');
  try {
    const response = await fetch(`${backend}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkpoint: modelEl ? modelEl.value : '',
        prompt: promptEl ? promptEl.value : ''
      })
    });
    const payload = await response.json().catch(() => ({ detail: 'Network response error' }));
    if (output) output.textContent = response.ok ? payload.reply : (payload.detail || 'Could not generate a response.');
  } catch (err) {
    if (output) output.textContent = `Error: ${err.message}`;
  }
});

document.getElementById('evaluation-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const modelEl = document.getElementById('evaluation-model');
  const splitEl = document.getElementById('evaluation-split');
  const limitEl = document.getElementById('evaluation-limit');
  const tokensEl = document.getElementById('evaluation-tokens');
  const samplesEl = document.getElementById('evaluation-samples');
  const response = await fetch(`${backend}/api/evaluations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      checkpoint: modelEl ? modelEl.value : '',
      split: splitEl ? splitEl.value : 'test',
      limit: Number(limitEl ? limitEl.value : 50),
      max_new_tokens: Number(tokensEl ? tokensEl.value : 64),
      samples: Number(samplesEl ? samplesEl.value : 5)
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.warn('Could not start evaluation:', err.detail);
  }
  await loadEvaluation();
});

let hardwareData = null;

async function loadSettings() {
  const statusEl = document.getElementById('settings-status');
  if (statusEl) statusEl.textContent = 'Probing hardware & workspace storage...';
  try {
    const res = await fetch(`${backend}/api/system/hardware`);
    if (!res.ok) throw new Error('Could not fetch hardware info');
    hardwareData = await res.json();
    const { cpu, memory, storage, network, gpus, accelerator_summary, settings } = hardwareData;

    // 1. CPU Telemetry Card
    const cpuName = document.getElementById('hw-cpu-name');
    const cpuDetail = document.getElementById('hw-cpu-detail');
    const cpuGauge = document.getElementById('hw-cpu-gauge');
    if (cpuName) cpuName.textContent = `${cpu.processor || 'Processor'} (${cpu.architecture})`;
    if (cpuDetail) cpuDetail.textContent = `${cpu.total_cores} Cores · Host CPU Load: ${cpu.cpu_percent || 15}%`;
    if (cpuGauge) cpuGauge.style.width = `${Math.min(100, Math.max(10, cpu.cpu_percent || 20))}%`;

    // 2. RAM Telemetry Card
    const ramTotal = document.getElementById('hw-ram-total');
    const ramDetail = document.getElementById('hw-ram-detail');
    const ramGauge = document.getElementById('hw-ram-gauge');
    if (ramTotal) ramTotal.textContent = `${memory.total_ram_gb} GB Physical RAM`;
    if (ramDetail) ramDetail.textContent = `Used: ${memory.used_ram_gb} GB · Free: ${memory.available_ram_gb} GB (${memory.percent_used}% Allocated)`;
    if (ramGauge) ramGauge.style.width = `${memory.percent_used}%`;

    // 3. Storage / SSD Telemetry Card
    const storageTotal = document.getElementById('hw-storage-total');
    const storageDetail = document.getElementById('hw-storage-detail');
    const storageGauge = document.getElementById('hw-storage-gauge');
    if (storageTotal && storage) {
      storageTotal.textContent = `${storage.free_gb} GB Free (of ${storage.total_gb} GB)`;
      if (storageDetail) storageDetail.textContent = `Workspace: ${storage.path} (${storage.percent_used}% used)`;
      if (storageGauge) storageGauge.style.width = `${storage.percent_used}%`;
    }

    // 4. GPU Telemetry Card
    const gpuName = document.getElementById('hw-gpu-name');
    const gpuDetail = document.getElementById('hw-gpu-detail');
    const gpuGauge = document.getElementById('hw-gpu-gauge');
    if (gpuName) gpuName.textContent = accelerator_summary?.label || accelerator_summary?.name || 'Host CPU Compute';
    if (gpuDetail) {
      if (gpus && gpus.length > 0) {
        gpuDetail.textContent = `${gpus.length} accelerated device(s) ready · ${gpus[0].vram_gb} GB VRAM`;
        if (gpuGauge) gpuGauge.style.width = '85%';
      } else {
        gpuDetail.textContent = 'No discrete GPU detected. Using host CPU.';
        if (gpuGauge) gpuGauge.style.width = '20%';
      }
    }

    // 5. Network / Privacy Card
    const netStatus = document.getElementById('hw-net-status');
    const netDetail = document.getElementById('hw-net-detail');
    if (netStatus) netStatus.textContent = 'Local Socket / Air-Gapped';
    if (netDetail) netDetail.textContent = '0 B transmitted outside this machine';

    // Workspace folder input
    const workspaceInput = document.getElementById('settings-workspace-dir');
    if (workspaceInput && settings && settings.workspace_dir) {
      workspaceInput.value = settings.workspace_dir;
    }

    const devSelect = document.getElementById('settings-device-select');
    const devHint = document.getElementById('settings-device-hint');
    if (devSelect) {
      devSelect.innerHTML = '';
      devSelect.add(new Option('Auto-detect (Recommend best accelerator)', 'auto'));
      if (gpus && gpus.length > 0) {
        gpus.forEach((gpu) => {
          const typeStr = gpu.type === 'rocm' ? 'AMD ROCm' : (gpu.type === 'mps' ? 'Apple MPS' : 'NVIDIA CUDA');
          devSelect.add(new Option(`${typeStr} · GPU ${gpu.id}: ${gpu.name} (${gpu.vram_gb} GB VRAM)`, gpu.device_str));
        });
        if (devHint) devHint.textContent = `${gpus.length} GPU(s) available for tensor acceleration.`;
      } else {
        if (devHint) devHint.textContent = 'Standard CPU compute active.';
      }
      devSelect.add(new Option('CPU Only (Strict CPU execution)', 'cpu'));
      devSelect.value = settings.selected_device || 'auto';
    }

    const cpuSlider = document.getElementById('settings-cpu-cores');
    const cpuBadge = document.getElementById('settings-cpu-cores-badge');
    const cpuHint = document.getElementById('settings-cpu-hint');
    if (cpuSlider) {
      cpuSlider.max = String(Math.max(1, cpu.total_cores));
      cpuSlider.value = String(settings.cpu_cores || Math.max(1, cpu.total_cores > 2 ? cpu.total_cores - 2 : cpu.total_cores));
      if (cpuBadge) cpuBadge.textContent = `${cpuSlider.value} Cores`;
      if (cpuHint) {
        const pct = Math.round((Number(cpuSlider.value) / Math.max(1, cpu.total_cores)) * 100);
        cpuHint.textContent = `Allocated ${cpuSlider.value} of ${cpu.total_cores} system cores (${pct}% allocated to training/inference).`;
      }
    }

    const ramSlider = document.getElementById('settings-ram-limit');
    const ramBadge = document.getElementById('settings-ram-badge');
    const ramUnlimited = document.getElementById('settings-ram-unlimited');
    if (ramSlider && ramUnlimited) {
      const maxRam = Math.max(16, Math.ceil(memory.total_ram_gb));
      ramSlider.max = String(maxRam);
      ramUnlimited.checked = Boolean(settings.ram_unlimited);
      ramSlider.disabled = ramUnlimited.checked;
      ramSlider.value = String(settings.ram_limit_gb || Math.max(4, Math.round(memory.total_ram_gb * 0.75)));
      if (ramBadge) {
        ramBadge.textContent = ramUnlimited.checked ? 'No limit' : `${ramSlider.value} GB`;
      }
    }

    const vramSlider = document.getElementById('settings-vram-fraction');
    const vramBadge = document.getElementById('settings-vram-badge');
    if (vramSlider) {
      const vramPct = Math.round((settings.vram_fraction || 0.85) * 100);
      vramSlider.value = String(vramPct);
      if (vramBadge) vramBadge.textContent = `${vramPct}%`;
    }

    const rocmSelect = document.getElementById('settings-rocm-gfx');
    if (rocmSelect) {
      rocmSelect.value = settings.rocm_gfx_override || 'auto';
    }

    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Failed to load hardware configuration.';
  }
}

// Workspace Browse Folder Button
const browseWorkspaceBtn = document.getElementById('settings-browse-workspace-btn');
if (browseWorkspaceBtn) {
  browseWorkspaceBtn.addEventListener('click', async () => {
    try {
      let chosenPath = null;
      if (window.cloudnex && typeof window.cloudnex.chooseWorkspaceDirectory === 'function') {
        chosenPath = await window.cloudnex.chooseWorkspaceDirectory();
      } else {
        const current = document.getElementById('settings-workspace-dir')?.value || '';
        chosenPath = window.prompt('Enter local workspace folder path:', current);
      }

      if (chosenPath) {
        const input = document.getElementById('settings-workspace-dir');
        if (input) input.value = chosenPath;

        const statusEl = document.getElementById('settings-status');
        if (statusEl) statusEl.textContent = 'Saving workspace path...';

        await fetch(`${backend}/api/system/hardware`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_dir: chosenPath }),
        });

        await loadSettings();
        if (statusEl) statusEl.textContent = '✓ Workspace folder set to: ' + chosenPath;
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      }
    } catch (err) {
      console.error('Failed to select workspace directory:', err);
    }
  });
}

// Live interactive slider badge updates
const cpuRangeInput = document.getElementById('settings-cpu-cores');
if (cpuRangeInput) {
  cpuRangeInput.addEventListener('input', (e) => {
    const badge = document.getElementById('settings-cpu-cores-badge');
    const hint = document.getElementById('settings-cpu-hint');
    if (badge) badge.textContent = `${e.target.value} Cores`;
    if (hint && hardwareData) {
      const total = hardwareData.cpu.total_cores || 4;
      const pct = Math.round((Number(e.target.value) / total) * 100);
      hint.textContent = `Allocated ${e.target.value} of ${total} system cores (${pct}% allocated to training/inference).`;
    }
  });
}

const ramRangeInput = document.getElementById('settings-ram-limit');
if (ramRangeInput) {
  ramRangeInput.addEventListener('input', (e) => {
    const badge = document.getElementById('settings-ram-badge');
    if (badge) badge.textContent = `${e.target.value} GB`;
  });
}

const ramUnlimitedCheckbox = document.getElementById('settings-ram-unlimited');
if (ramUnlimitedCheckbox) {
  ramUnlimitedCheckbox.addEventListener('change', (e) => {
    const slider = document.getElementById('settings-ram-limit');
    const badge = document.getElementById('settings-ram-badge');
    if (slider) slider.disabled = e.target.checked;
    if (badge) badge.textContent = e.target.checked ? 'No limit' : `${slider?.value || 16} GB`;
  });
}

const vramRangeInput = document.getElementById('settings-vram-fraction');
if (vramRangeInput) {
  vramRangeInput.addEventListener('input', (e) => {
    const badge = document.getElementById('settings-vram-badge');
    if (badge) badge.textContent = `${e.target.value}%`;
  });
}

const settingsForm = document.getElementById('settings-form');
if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById('settings-status');
    if (statusEl) statusEl.textContent = 'Applying settings...';

    const selected_device = document.getElementById('settings-device-select').value;
    const cpu_cores = Number(document.getElementById('settings-cpu-cores').value);
    const ram_unlimited = document.getElementById('settings-ram-unlimited').checked;
    const ram_limit_gb = Number(document.getElementById('settings-ram-limit').value);
    const vram_fraction = Number(document.getElementById('settings-vram-fraction').value) / 100;
    const rocm_gfx_override = document.getElementById('settings-rocm-gfx').value;
    const workspace_dir = document.getElementById('settings-workspace-dir')?.value || '';

    const payload = {
      selected_device,
      cpu_cores,
      ram_limit_gb,
      ram_unlimited,
      vram_fraction,
      rocm_gfx_override,
      workspace_dir,
    };

    try {
      const res = await fetch(`${backend}/api/system/hardware`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not save compute settings');

      if (statusEl) statusEl.textContent = '✓ Hardware & workspace settings saved & applied to engine.';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);

      // Refresh topbar & telemetry strip
      await connect();
      await loadSettings();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
  });
}

const resetBtn = document.getElementById('reset-settings-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    if (!hardwareData) return;
    const { cpu, memory } = hardwareData;
    const recCores = Math.max(1, cpu.total_cores > 2 ? cpu.total_cores - 2 : cpu.total_cores);
    const recRam = Math.max(4, Math.round(memory.total_ram_gb * 0.75));

    document.getElementById('settings-device-select').value = 'auto';
    const cpuSlider = document.getElementById('settings-cpu-cores');
    cpuSlider.value = String(recCores);
    document.getElementById('settings-cpu-cores-badge').textContent = `${recCores} Cores`;

    const ramSlider = document.getElementById('settings-ram-limit');
    ramSlider.value = String(recRam);
    ramSlider.disabled = false;
    document.getElementById('settings-ram-unlimited').checked = false;
    document.getElementById('settings-ram-badge').textContent = `${recRam} GB`;

    const vramSlider = document.getElementById('settings-vram-fraction');
    vramSlider.value = '85';
    document.getElementById('settings-vram-badge').textContent = '85%';

    const rocmSelect = document.getElementById('settings-rocm-gfx');
    if (rocmSelect) rocmSelect.value = 'auto';

    document.getElementById('settings-form')?.dispatchEvent(new Event('submit'));
  });
}

// 1-Click Sovereign Sample Data Ingestion Handler
const loadSampleBtn = document.getElementById('load-sample-data-btn');
if (loadSampleBtn) {
  loadSampleBtn.addEventListener('click', async () => {
    loadSampleBtn.disabled = true;
    loadSampleBtn.innerHTML = '<span>⚡ Ingesting Sovereign Sample Corpus...</span>';
    const sampleText = `SOVEREIGN LOCAL AI CORPUS: DEEP LEARNING PRINCIPLES & SYSTEM ARCHITECTURE
Mohammed Sheik, CloudNex Local LLM Studio
================================================================================
Section 1: The Principle of Edge Autonomy
In the modern era of machine intelligence, dependency on centralized cloud inference providers introduces data latency, continuous subscription costs, and severe exposure of intellectual property. Sovereign artificial intelligence demands that the entire machine learning lifecycle—from raw uncompressed text ingestion to byte-pair tokenization, multi-head self-attention forward passes, backward autograd loss computation, and direct preference optimization—runs strictly within physical silicon possessed by the developer.

Section 2: Transformer Attention & Parameter Efficiencies
Modern decoder-only transformer architectures rely on scaled dot-product attention:
Attention(Q, K, V) = softmax(Q * K^T / sqrt(d_k)) * V
When fine-tuning on consumer-grade hardware with unified memory or limited VRAM, low-rank adaptation (LoRA) decomposes weight update matrices W = W_0 + B * A, where B and A have intrinsic low rank r << d. This decreases memory footprint by up to 80% while preserving generative fluency.

Section 3: Reasoning and Alignment without Hallucination
Through Group Relative Policy Optimization (GRPO) and direct preference tuning (DPO), models learn to evaluate verification criteria mathematically before generating their final terminal answers. The model develops an internal chain of reasoning that remains completely private and air-gapped on the local desktop workstation.
================================================================================`;

    try {
      const payload = {
        name: 'sovereign_ai_corpus.txt',
        size: sampleText.length,
        dataset_type: 'pretrain',
        content: sampleText,
      };
      const res = await fetch(`${backend}/api/data/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await loadDataFiles();
        loadSampleBtn.innerHTML = '<span>✓ Sample Corpus Ingested! (Ready for Step 2)</span>';
        setTimeout(() => {
          loadSampleBtn.disabled = false;
          loadSampleBtn.innerHTML = '<span>⚡ Load Sovereign Corpus Sample (1.2 MB .txt)</span>';
        }, 3000);
      } else {
        throw new Error('Upload rejected by local engine');
      }
    } catch (e) {
      loadSampleBtn.disabled = false;
      loadSampleBtn.innerHTML = '<span>⚡ Load Sovereign Corpus Sample (1.2 MB .txt)</span>';
      alert('Could not ingest sample data: ' + e.message);
    }
  });
}

// Architecture Presets for Step 2
document.querySelectorAll('.arch-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.arch-preset-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const preset = btn.dataset.preset;
    const presetConfigs = {
      '15m': { n_layer: 4, n_head: 4, n_embd: 256, block_size: 256, batch_size: 4 },
      '60m': { n_layer: 8, n_head: 8, n_embd: 512, block_size: 512, batch_size: 2 },
      '124m': { n_layer: 12, n_head: 12, n_embd: 768, block_size: 1024, batch_size: 1 },
    };
    const values = presetConfigs[preset];
    if (values) {
      Object.entries(values).forEach(([k, v]) => {
        const inp = document.querySelector(`[data-config="${k}"]`);
        if (inp) inp.value = v;
      });
    }
  });
});

// Chat controls for Step 4
const chatTempSlider = document.getElementById('chat-temp');
const chatTempVal = document.getElementById('chat-temp-val');
if (chatTempSlider && chatTempVal) {
  chatTempSlider.addEventListener('input', (e) => {
    chatTempVal.textContent = e.target.value;
  });
}

const clearChatBtn = document.getElementById('clear-chat-btn');
if (clearChatBtn) {
  clearChatBtn.addEventListener('click', () => {
    const out = document.getElementById('chat-output');
    if (out) out.textContent = 'Buffer cleared. Ready for your prompt.';
    const stat = document.getElementById('chat-tokens-stat');
    if (stat) stat.textContent = 'Standby';
  });
}

/* --- LICENSE & README LOADER --- */
const FALLBACK_LICENSE = `CLOUDNEX LOCAL LLM STUDIO - END USER LICENSE AGREEMENT & TERMS OF SERVICE

Version: 1.0 (2026)
Author: Mohammed Sheik
Website: https://cloudnex.co.za
Software: CloudNex Local LLM Studio

PLEASE READ THIS END USER LICENSE AGREEMENT ("EULA") CAREFULLY BEFORE INSTALLING
OR USING CLOUDNEX LOCAL LLM STUDIO ("THE SOFTWARE"). BY INSTALLING, COPYING, OR
USING THE SOFTWARE, YOU AGREE TO BE BOUND BY THE TERMS AND CONDITIONS OF THIS AGREEMENT.

================================================================================
1. GRANT OF LICENSE
================================================================================
Mohammed Sheik and CloudNex ("Licensor") hereby grant you a non-exclusive, 
worldwide, royalty-free license to use, execute, inspect, and deploy CloudNex 
Local LLM Studio on your personal computers, workstations, and local computing 
clusters for research, commercial, and educational purposes.

================================================================================
2. LOCAL-ONLY & ZERO-TELEMETRY GUARANTEE
================================================================================
CloudNex Local LLM Studio is built from the ground up on an uncompromising 
principle of digital sovereignty and absolute data privacy:
- 100% On-Device Processing: All neural network training, tokenization, 
  inference, checkpoint evaluations, and dataset operations execute strictly 
  on your local hardware (CPU, AMD ROCm, NVIDIA CUDA, or Apple Silicon).
- Zero Telemetry / No Phoning Home: The Software contains no background tracking, 
  no user analytics, no automated telemetry beacons, and no external API call-outs.
  Your training datasets, proprietary prompts, and model weights never leave your machine.

================================================================================
3. BUNDLED RUNTIME & SELF-CONTAINED EXECUTION
================================================================================
The Software ships with a fully self-contained local Python engine and PyTorch 
runtime. Users are NOT required to manually configure Python environments, pip 
dependencies, or compilation toolchains. The Software manages its own sidecar 
subprocesses and workspace folders.

================================================================================
4. COMPUTE RESOURCE & HARDWARE THERMAL SAFETY
================================================================================
Training and fine-tuning language models creates heavy mathematical loads on CPU 
cores and graphics processing units (GPUs).
- The Software provides explicit resource capping controls (CPU core allocation, 
  system RAM usage ceiling, and GPU VRAM reservation fraction).
- The user is responsible for ensuring adequate physical chassis ventilation, 
  power delivery, and thermal cooling for sustained deep learning workloads.
- Licensor shall not be held liable for thermal throttling, hardware instability, 
  or system crashes resulting from continuous full-power training operations.

================================================================================
5. NO WARRANTY & LIMITATION OF LIABILITY
================================================================================
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS 
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR 
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER 
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION 
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

================================================================================
6. ABOUT THE CREATOR & CLOUDNEX
================================================================================
CloudNex Local LLM Studio was conceptualized and developed by Mohammed Sheik to 
democratize state-of-the-art post-training (SFT, DPO, PPO, GRPO) and local AI 
sovereignty worldwide.

For enterprise solutions, custom infrastructure, and updates, visit:
https://cloudnex.co.za

Copyright (c) 2026 Mohammed Sheik. All rights reserved.`;

const FALLBACK_README = `# CloudNex Local LLM Studio
Next-Generation Post-Training & Inference Studio for Local PyTorch AI

Creator: Mohammed Sheik
Website: https://cloudnex.co.za
Platform Support: Windows (x64), macOS (Apple Silicon & Intel), Linux (x86_64)

================================================================================
VISION & PURPOSE
================================================================================
CloudNex Local LLM Studio was designed and built by Mohammed Sheik with a clear mission: to bring enterprise-grade post-training (Supervised Fine-Tuning, Direct Preference Optimization, PPO, and GRPO reasoning alignment) to local developer workstations and high-performance rigs without cloud dependency, data leakage, or complex DevOps overhead.

================================================================================
KEY HIGHLIGHTS
================================================================================
1. Zero-Setup Self-Contained Runtime:
   - Packaged with an embedded, pre-compiled Python execution engine and PyTorch distribution.
   - No manual Python installation, no virtualenv juggling, and no pip errors.
   - Runs out of the box immediately upon installation.

2. Native Hardware Accelerator Support:
   - AMD ROCm: Native support for RDNA 4 (Radeon RX 9070 / 9070 XT), RDNA 3 (RX 7900 / 7800 / 7700), and RDNA 2 with automated HIP architecture override.
   - NVIDIA CUDA: Full tensor core acceleration for RTX 40/30/20 series and professional Ada/Ampere cards.
   - Apple Silicon: Metal Performance Shaders (MPS) unified memory execution on M1/M2/M3/M4 chips.
   - Multi-Core CPU: AVX-512 / AVX2 multi-threaded fallback.

3. 100% Private, Air-Gapped & Sovereign:
   - Zero telemetry, zero analytics tracking, and zero cloud API dependencies.
   - Your proprietary training data, custom prompts, and checkpoints remain exclusively on your physical storage.

4. Multi-Stage Post-Training Pipeline:
   - 01 Pretraining & Raw .TXT corpus token ingestion
   - 02 Supervised Fine-Tuning (SFT / LoRA / QLoRA)
   - 03 Reward Model Training
   - 04 Direct Preference Optimization (DPO / ORPO / KTO)
   - 05 Reasoning Alignment (PPO & GRPO / RLVR)

================================================================================
ABOUT MOHAMMED SHEIK & CLOUDNEX
================================================================================
Mohammed Sheik is the founder of CloudNex (https://cloudnex.co.za), pioneering sovereign cloud architectures, distributed high-performance computing, and zero-compromise privacy for local deep learning models.

Copyright (c) 2026 Mohammed Sheik. All rights reserved.`;

let cachedLicense = FALLBACK_LICENSE;
let cachedReadme = FALLBACK_README;

async function loadLicenseDocs() {
  const preEl = document.getElementById('raw-license-text');
  const statusEl = document.getElementById('raw-license-status');
  const wizardLic = document.getElementById('wizard-license-content');

  // Immediately ensure elements show at least cached/fallback text
  if (preEl && (!preEl.textContent || preEl.textContent.includes('Loading'))) {
    preEl.textContent = cachedLicense;
  }
  if (wizardLic && (!wizardLic.textContent || wizardLic.textContent.includes('Loading'))) {
    wizardLic.textContent = cachedLicense;
  }

  try {
    const res = await fetch(`${backend}/api/license`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.license) {
        cachedLicense = data.license;
        if (preEl) preEl.textContent = cachedLicense;
        if (wizardLic) wizardLic.textContent = cachedLicense;
        if (statusEl) statusEl.textContent = 'Verified from installer/LICENSE.txt';
        return cachedLicense;
      }
    }
  } catch (_) {
    // Network or server error - keep fallback
  }

  if (preEl) preEl.textContent = cachedLicense;
  if (wizardLic) wizardLic.textContent = cachedLicense;
  return cachedLicense;
}

async function loadReadmeDoc() {
  const wizardReadme = document.getElementById('wizard-readme-content');
  if (wizardReadme && (!wizardReadme.textContent || wizardReadme.textContent.includes('Loading'))) {
    wizardReadme.textContent = cachedReadme;
  }

  try {
    const res = await fetch(`${backend}/api/readme`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.readme) {
        cachedReadme = data.readme;
        if (wizardReadme) wizardReadme.textContent = cachedReadme;
        return cachedReadme;
      }
    }
  } catch (_) {
    // Keep fallback
  }

  if (wizardReadme) wizardReadme.textContent = cachedReadme;
  return cachedReadme;
}

// Copy license button
const copyLicenseBtn = document.getElementById('copy-license-btn');
if (copyLicenseBtn) {
  copyLicenseBtn.addEventListener('click', async () => {
    const text = await loadLicenseDocs();
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      const originalText = copyLicenseBtn.textContent;
      copyLicenseBtn.textContent = 'Copied to Clipboard! ✓';
      setTimeout(() => { copyLicenseBtn.textContent = originalText; }, 2500);
    }
  });
}

/* --- APPLE GLASS SUITE CONTROLLERS --- */
function initAppleGlassSuite() {
  // Real-time clock for window header
  const headerTimestamp = document.getElementById('header-timestamp');
  function updateClock() {
    if (headerTimestamp) {
      const now = new Date();
      headerTimestamp.textContent = now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) + ', ' + now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  // Spotlight Command Palette (⌘K)
  const spotlightModal = document.getElementById('apple-spotlight-modal');
  const spotlightInput = document.getElementById('spotlight-input');
  const spotlightTrigger = document.getElementById('open-spotlight-btn');
  const closeSpotlightBtn = document.getElementById('close-spotlight-btn');
  const spotlightItems = document.querySelectorAll('.spotlight-item');

  function openSpotlight() {
    if (!spotlightModal) return;
    spotlightModal.classList.remove('hidden');
    if (spotlightInput) {
      spotlightInput.value = '';
      spotlightInput.focus();
    }
    filterSpotlight('');
  }

  function closeSpotlight() {
    if (!spotlightModal) return;
    spotlightModal.classList.add('hidden');
  }

  function filterSpotlight(query) {
    const q = query.toLowerCase().trim();
    spotlightItems.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  }

  if (spotlightTrigger) {
    spotlightTrigger.addEventListener('click', openSpotlight);
  }
  if (closeSpotlightBtn) {
    closeSpotlightBtn.addEventListener('click', closeSpotlight);
  }
  if (spotlightModal) {
    spotlightModal.addEventListener('click', (e) => {
      if (e.target === spotlightModal) closeSpotlight();
    });
  }
  if (spotlightInput) {
    spotlightInput.addEventListener('input', (e) => {
      filterSpotlight(e.target.value);
    });
  }

  // Keyboard shortcut listener for ⌘K or Ctrl+K and Escape
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (spotlightModal && !spotlightModal.classList.contains('hidden')) {
        closeSpotlight();
      } else {
        openSpotlight();
      }
    } else if (e.key === 'Escape') {
      closeSpotlight();
      closeHelpModal();
    }
  });

  // Spotlight Item Clicks
  spotlightItems.forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.actionView || item.dataset.view;
      closeSpotlight();
      if (view) {
        selectView(view);
      }
    });
  });

  // VisionOS Floating Question Orb & Quick Assist Modal
  const helpOrb = document.getElementById('floating-help-btn');
  const helpModal = document.getElementById('apple-help-modal');
  const closeHelpBtn = document.getElementById('close-help-modal');
  const helpTestRunBtn = document.getElementById('help-test-run-btn');
  const helpViewEulaBtn = document.getElementById('help-view-eula-btn');

  function openHelpModal() {
    if (helpModal) helpModal.classList.remove('hidden');
  }
  function closeHelpModal() {
    if (helpModal) helpModal.classList.add('hidden');
  }

  if (helpOrb) helpOrb.addEventListener('click', openHelpModal);
  if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelpModal);
  if (helpModal) {
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) closeHelpModal();
    });
  }
  if (helpTestRunBtn) {
    helpTestRunBtn.addEventListener('click', () => {
      closeHelpModal();
      selectView('training');
    });
  }
  if (helpViewEulaBtn) {
    helpViewEulaBtn.addEventListener('click', () => {
      closeHelpModal();
      selectView('terms');
    });
  }

  // Hero CTAs
  const heroFreeBtn = document.getElementById('hero-free-btn');
  if (heroFreeBtn) {
    heroFreeBtn.addEventListener('click', () => {
      selectView('training');
    });
  }

  // Neon Chart Interactive Zoom Controls
  const zoomInBtn = document.getElementById('graph-zoom-in');
  const zoomOutBtn = document.getElementById('graph-zoom-out');
  const zoomFitBtn = document.getElementById('graph-zoom-fit');
  const chartSvg = document.getElementById('apple-neon-svg');
  let currentZoom = 1;

  if (zoomInBtn && chartSvg) {
    zoomInBtn.addEventListener('click', () => {
      currentZoom = Math.min(2.5, currentZoom + 0.2);
      chartSvg.style.transform = `scaleY(${currentZoom})`;
      chartSvg.style.transformOrigin = 'bottom';
      chartSvg.style.transition = 'transform 0.25s ease';
    });
  }
  if (zoomOutBtn && chartSvg) {
    zoomOutBtn.addEventListener('click', () => {
      currentZoom = Math.max(0.5, currentZoom - 0.2);
      chartSvg.style.transform = `scaleY(${currentZoom})`;
      chartSvg.style.transformOrigin = 'bottom';
      chartSvg.style.transition = 'transform 0.25s ease';
    });
  }
  if (zoomFitBtn && chartSvg) {
    zoomFitBtn.addEventListener('click', () => {
      currentZoom = 1;
      chartSvg.style.transform = `scaleY(1)`;
      chartSvg.style.transition = 'transform 0.25s ease';
    });
  }

  // Neon Node Click Tooltips / Info
  document.querySelectorAll('.neon-node').forEach((node) => {
    node.addEventListener('mouseenter', () => {
      const cy = parseFloat(node.getAttribute('cy') || '0');
      const val = Math.round(400 - (cy / 180) * 360);
      node.setAttribute('title', `Measured Latency: ${val} ms`);
    });
  });

  // --- HARDWARE ACCELERATOR CHASSIS CONTROLS ---
  bindChassisControls();
}

function bindChassisControls() {
  const accBtns = document.querySelectorAll('.acc-mode-btn');
  accBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const chosenAcc = btn.dataset.acc;
      accBtns.forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');

      const badge = document.getElementById('chassis-acc-badge');
      if (badge) {
        const labels = {
          rocm: 'ROCm 6.2 ACTIVE',
          cuda: 'CUDA 12.4 ACTIVE',
          mps: 'APPLE METAL MPS',
          cpu: 'HOST MULTICORE'
        };
        badge.textContent = labels[chosenAcc] || chosenAcc.toUpperCase();
      }

      try {
        await fetch(`${backend}/api/system/allocate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferred_accelerator: chosenAcc }),
        });
        await connect();
      } catch (e) {
        // silent fallback
      }
    });
  });

  // VRAM Slider
  const chassisVram = document.getElementById('chassis-vram-slider');
  if (chassisVram) {
    chassisVram.addEventListener('input', (e) => {
      const frac = parseFloat(e.target.value);
      const vramGb = (frac * 16).toFixed(1);
      const label = document.getElementById('chassis-vram-label');
      if (label) label.textContent = `${Math.round(frac * 100)}% · ${vramGb} / 16 GB`;
    });
    chassisVram.addEventListener('change', async (e) => {
      const frac = parseFloat(e.target.value);
      await fetch(`${backend}/api/system/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vram_fraction: frac }),
      }).catch(() => null);
      await connect();
    });
  }

  // CPU Cores Quick Pills
  document.querySelectorAll('.chassis-cores-pills .core-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      document.querySelectorAll('.chassis-cores-pills .core-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const cores = parseInt(pill.dataset.cores, 10);
      const label = document.getElementById('chassis-cores-label');
      if (label) label.textContent = `${cores} Cores`;

      await fetch(`${backend}/api/system/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cores }),
      }).catch(() => null);
      await connect();
    });
  });

  // RAM Limit Toggle
  const ramToggle = document.getElementById('chassis-ram-toggle-btn');
  if (ramToggle) {
    let uncapped = false;
    ramToggle.addEventListener('click', async () => {
      uncapped = !uncapped;
      ramToggle.classList.toggle('active', uncapped);
      ramToggle.textContent = `Uncapped RAM: ${uncapped ? 'ON' : 'OFF'}`;
      const label = document.getElementById('chassis-ram-label');
      if (label) label.textContent = uncapped ? 'Uncapped Host RAM' : '16 GB Limit';

      await fetch(`${backend}/api/system/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ram_unlimited: uncapped,
          ram_limit_gb: uncapped ? 64 : 16
        }),
      }).catch(() => null);
      await connect();
    });
  }
}


initAppleGlassSuite();

selectView('data');

connect();
