const statusText = document.getElementById('connection-status');
const engineStatus = document.getElementById('engine-status');
const deviceStatus = document.getElementById('device-status');
const platformLabel = document.getElementById('platform-label');
const dot = document.querySelector('.status-dot');
const backend = window.cloudnex.backendUrl;

function selectView(view) {
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { overview: 'Your next run starts here.', training: 'Configure a focused training run.', models: 'Your local model shelf.', settings: 'Workspace settings.' };
  document.querySelector('.workspace-panel h2').textContent = titles[view] || titles.overview;
  document.getElementById('overview-content').classList.toggle('hidden', view === 'training');
  document.getElementById('training-content').classList.toggle('hidden', view !== 'training');
  if (view === 'training') loadTraining();
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

document.getElementById('training-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch(`${backend}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: document.getElementById('stage-select').value, smoke: document.getElementById('smoke-check').checked }) });
  if (!response.ok) window.alert((await response.json()).detail || 'Could not start training.');
  await loadTraining();
});

connect();
