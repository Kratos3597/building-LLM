const statusText = document.getElementById('connection-status');
const engineStatus = document.getElementById('engine-status');
const deviceStatus = document.getElementById('device-status');
const platformLabel = document.getElementById('platform-label');
const dot = document.querySelector('.status-dot');

function selectView(view) {
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { overview: 'Your next run starts here.', training: 'Configure a focused training run.', models: 'Your local model shelf.', settings: 'Workspace settings.' };
  document.querySelector('.workspace-panel h2').textContent = titles[view] || titles.overview;
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));

async function connect() {
  try {
    const health = await window.cloudnex.getHealth();
    const system = await fetch(`${window.cloudnex.backendUrl}/api/system`).then((response) => response.json());
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

connect();
