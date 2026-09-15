const statusText = document.getElementById('connection-status');
const engineStatus = document.getElementById('engine-status');
const deviceStatus = document.getElementById('device-status');
const platformLabel = document.getElementById('platform-label');
const dot = document.querySelector('.status-dot');
const backend = window.cloudnex.backendUrl;

function selectView(view) {
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { overview: 'Your next run starts here.', training: 'Configure a focused training run.', models: 'Your local model shelf.', chat: 'Talk to a local checkpoint.', settings: 'Workspace settings.' };
  document.querySelector('.workspace-panel h2').textContent = titles[view] || titles.overview;
  document.getElementById('overview-content').classList.toggle('hidden', view !== 'overview');
  document.getElementById('training-content').classList.toggle('hidden', view !== 'training');
  document.getElementById('models-content').classList.toggle('hidden', view !== 'models');
  document.getElementById('chat-content').classList.toggle('hidden', view !== 'chat');
  if (view === 'training') loadTraining();
  if (view === 'models') loadModels();
  if (view === 'chat') loadChatModels();
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
  document.getElementById('job-list').innerHTML = jobs.length ? jobs.map((job) => `<article class="job-card ${job.status}"><strong>${job.title}</strong> · ${job.status}<code>${job.log_tail || 'Waiting for output...'}</code></article>`).join('') : '<span class="muted">No training runs yet.</span>';
}

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

document.getElementById('training-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch(`${backend}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: document.getElementById('stage-select').value, smoke: document.getElementById('smoke-check').checked }) });
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

connect();
