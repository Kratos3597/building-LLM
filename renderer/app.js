const statusText = document.getElementById('connection-status');
const engineStatus = document.getElementById('engine-status');
const deviceStatus = document.getElementById('device-status');
const platformLabel = document.getElementById('platform-label');
const dot = document.querySelector('.status-dot');
const backend = window.cloudnex.backendUrl;

document.getElementById('minimize-window').addEventListener('click', () => window.cloudnex.window.minimize());
document.getElementById('maximize-window').addEventListener('click', () => window.cloudnex.window.toggleMaximize());
document.getElementById('close-window').addEventListener('click', () => window.cloudnex.window.close());
window.cloudnex.window.onMaximizedState((maximized) => {
  document.getElementById('maximize-window').textContent = maximized ? '❐' : '□';
});

function selectView(view) {
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { overview: 'Your next run starts here.', data: 'Prepare a clean local dataset.', training: 'Configure a focused training run.', models: 'Your local model shelf.', chat: 'Talk to a local checkpoint.', evaluation: 'Measure a local checkpoint.', settings: 'Workspace settings.' };
  document.querySelector('.workspace-panel h2').textContent = titles[view] || titles.overview;
  document.getElementById('overview-content').classList.toggle('hidden', view !== 'overview');
  document.getElementById('data-content').classList.toggle('hidden', view !== 'data');
  document.getElementById('training-content').classList.toggle('hidden', view !== 'training');
  document.getElementById('models-content').classList.toggle('hidden', view !== 'models');
  document.getElementById('chat-content').classList.toggle('hidden', view !== 'chat');
  document.getElementById('evaluation-content').classList.toggle('hidden', view !== 'evaluation');
  if (view === 'training') loadTraining();
  if (view === 'data') loadDataFiles();
  if (view === 'models') loadModels();
  if (view === 'chat') loadChatModels();
  if (view === 'evaluation') loadEvaluation();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));

async function connect() {
  try {
    const health = await window.cloudnex.getHealth();
    const system = await fetch(`${backend}/api/system`).then((response) => response.json());
    statusText.textContent = 'Local engine connected';
    engineStatus.textContent = health.status === 'ok' ? 'Online' : 'Unavailable';
    deviceStatus.textContent = system.device;
    platformLabel.textContent = system.platform;
    dot.classList.add('ready');
  } catch (error) {
    statusText.textContent = 'Local engine unavailable';
    engineStatus.textContent = 'Offline';
  }
}

async function loadTraining() {
  const [stages, jobs] = await Promise.all([
    fetch(`${backend}/api/stages`).then((response) => response.json()),
    fetch(`${backend}/api/jobs`).then((response) => response.json()),
  ]);
  const select = document.getElementById('stage-select');
  if (!select.options.length) stages.forEach((stage) => select.add(new Option(stage.title, stage.key)));
  await loadConfigEditor();
  document.getElementById('job-list').innerHTML = jobs.length ? jobs.map((job) => `<article class="job-card ${job.status}"><strong>${job.title}</strong> · ${job.status}<code>${job.log_tail || 'Waiting for output...'}</code></article>`).join('') : '<span class="muted">No training runs yet.</span>';
}

async function loadConfigEditor() {
  const stage = document.getElementById('stage-select').value || 'pretrain';
  const smoke = document.getElementById('smoke-check').checked;
  const config = await fetch(`${backend}/api/stages/${stage}/config?smoke=${smoke}`).then((response) => response.json());
  document.getElementById('config-editor').innerHTML = config.fields.map((field) => {
    if (field.kind === 'boolean') return `<label class="config-field check-row"><input type="checkbox" data-config="${field.name}" ${field.value ? 'checked' : ''}><span>${field.name}</span></label>`;
    return `<label class="config-field"><span>${field.name}</span><input data-config="${field.name}" type="${field.kind === 'number' ? 'number' : 'text'}" step="any" value="${field.value ?? ''}"></label>`;
  }).join('');
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

document.getElementById('stage-select').addEventListener('change', loadConfigEditor);
document.getElementById('smoke-check').addEventListener('change', loadConfigEditor);

let selectedFiles = [];
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadButton = document.getElementById('upload-button');

function setFiles(files) {
  selectedFiles = [...files];
  uploadButton.disabled = selectedFiles.length === 0;
  dropZone.querySelector('strong').textContent = selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready` : 'Drop dataset files here';
  dropZone.querySelector('span').textContent = selectedFiles.length ? selectedFiles.map((file) => file.name).join(' · ') : 'or click to browse from your computer';
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => setFiles(fileInput.files));
['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', (event) => setFiles(event.dataTransfer.files));

async function loadDataFiles() {
  const files = await fetch(`${backend}/api/data/files`).then((response) => response.json());
  const filter = document.getElementById('data-filter').value;
  const visible = filter === 'all' ? files : files.filter((file) => file.dataset_type === filter);
  document.getElementById('data-count').textContent = `${visible.length} shown · ${files.length} total`;
  document.getElementById('data-file-list').innerHTML = visible.length ? visible.map((file) => `<article class="job-card data-card"><div><strong>${file.name}</strong><span> · ${formatBytes(file.size)}</span><code>${file.dataset_type} dataset</code></div><div class="data-actions"><select class="type-editor" data-file="${encodeURIComponent(file.name)}"><option value="general" ${file.dataset_type === 'general' ? 'selected' : ''}>General</option><option value="pretrain" ${file.dataset_type === 'pretrain' ? 'selected' : ''}>Pretraining</option><option value="sft" ${file.dataset_type === 'sft' ? 'selected' : ''}>SFT</option><option value="preference" ${file.dataset_type === 'preference' ? 'selected' : ''}>Preference</option><option value="rl" ${file.dataset_type === 'rl' ? 'selected' : ''}>RL prompts</option></select><button class="danger-button delete-data" type="button" data-file="${encodeURIComponent(file.name)}">Delete</button></div></article>`).join('') : '<span class="muted">No datasets match this filter.</span>';
}

function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

document.getElementById('upload-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('upload-status');
  uploadButton.disabled = true;
  status.textContent = 'Uploading locally...';
  try {
    for (const file of selectedFiles) {
      const form = new FormData();
      form.append('file', file);
      form.append('dataset_type', document.getElementById('dataset-type').value);
      const response = await fetch(`${backend}/api/data/upload`, { method: 'POST', body: form });
      if (!response.ok) throw new Error((await response.json()).detail || 'Upload failed');
    }
    status.textContent = `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} uploaded to your local workspace.`;
    setFiles([]);
    fileInput.value = '';
    await loadDataFiles();
  } catch (error) {
    status.textContent = error.message;
    uploadButton.disabled = selectedFiles.length === 0;
  }
});

document.getElementById('data-filter').addEventListener('change', loadDataFiles);
document.getElementById('data-file-list').addEventListener('change', async (event) => {
  if (!event.target.classList.contains('type-editor')) return;
  const filename = decodeURIComponent(event.target.dataset.file);
  await fetch(`${backend}/api/data/files/${encodeURIComponent(filename)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_type: event.target.value }) });
  await loadDataFiles();
});
document.getElementById('data-file-list').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-data');
  if (!button) return;
  const filename = decodeURIComponent(button.dataset.file);
  if (!window.confirm(`Delete ${filename} from the local workspace?`)) return;
  const response = await fetch(`${backend}/api/data/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!response.ok) document.getElementById('upload-status').textContent = 'Could not delete that dataset.';
  await loadDataFiles();
});

async function loadModels() {
  const models = await fetch(`${backend}/api/models`).then((response) => response.json());
  document.getElementById('model-list').innerHTML = models.length ? models.map((model) => `<article class="job-card"><strong>${model.name}</strong><span> · ${model.size_mb} MB</span><code>${model.path}</code></article>`).join('') : '<span class="muted">No checkpoints found. Complete a training run first.</span>';
}

async function loadChatModels() {
  const models = await fetch(`${backend}/api/models`).then((response) => response.json());
  const select = document.getElementById('model-select');
  select.replaceChildren(...models.map((model) => new Option(model.name, model.path)));
  if (!models.length) select.add(new Option('No checkpoints found', ''));
}

async function loadEvaluation() {
  const [models, evaluations] = await Promise.all([
    fetch(`${backend}/api/models`).then((response) => response.json()),
    fetch(`${backend}/api/evaluations`).then((response) => response.json()),
  ]);
  const select = document.getElementById('evaluation-model');
  select.replaceChildren(...models.map((model) => new Option(model.name, model.path)));
  if (!models.length) select.add(new Option('No checkpoints found', ''));
  document.getElementById('evaluation-list').innerHTML = evaluations.length ? evaluations.map((item) => `<article class="job-card ${item.status}"><strong>${item.title}</strong> · ${item.status}<code>${item.log_tail || 'Waiting for output...'}</code></article>`).join('') : '<span class="muted">No evaluations run yet.</span>';
}

document.getElementById('training-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch(`${backend}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: document.getElementById('stage-select').value, smoke: document.getElementById('smoke-check').checked, overrides: collectOverrides() }) });
  if (!response.ok) window.alert((await response.json()).detail || 'Could not start training.');
  await loadTraining();
});

document.getElementById('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = document.getElementById('chat-output');
  output.textContent = 'Generating...';
  const response = await fetch(`${backend}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkpoint: document.getElementById('model-select').value, prompt: document.getElementById('prompt-input').value }) });
  const payload = await response.json();
  output.textContent = response.ok ? payload.reply : (payload.detail || 'Could not generate a response.');
});

document.getElementById('evaluation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch(`${backend}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkpoint: document.getElementById('evaluation-model').value, split: document.getElementById('evaluation-split').value, limit: Number(document.getElementById('evaluation-limit').value), max_new_tokens: Number(document.getElementById('evaluation-tokens').value), samples: Number(document.getElementById('evaluation-samples').value) }) });
  if (!response.ok) window.alert((await response.json()).detail || 'Could not start evaluation.');
  await loadEvaluation();
});

connect();
