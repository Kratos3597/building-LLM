const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = Number(process.env.CLOUDNEX_BACKEND_PORT || 8000);
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
let backendProcess = null;
let mainWindow = null;
let shuttingDown = false;

function registerWindowControls() {
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized()) window.unmaximize();
    else window?.maximize();
    event.sender.send('window:maximized-state', window?.isMaximized() || false);
  });
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('checkpoint:save-dialog', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export CloudNex checkpoint',
      defaultPath: 'cloudnex-checkpoint.pt',
      filters: [{ name: 'PyTorch checkpoint', extensions: ['pt'] }],
    });
    return result.canceled ? null : result.filePath;
  });
}

function backendPaths() {
  const root = app.isPackaged ? process.resourcesPath : __dirname;
  const isWin = process.platform === 'win32';
  const binDir = path.join(root, 'bin');
  const backendDir = path.join(root, 'backend');
  const engineDir = app.isPackaged ? path.join(root, 'engine') : root;

  // Candidates in order of precedence:
  // 1. Packaged standalone binary in resources/bin/cloudnex-engine
  // 2. Packaged standalone binary in resources/backend/cloudnex-backend
  // 3. Development binary in backend/dist/
  const candidates = [
    path.join(binDir, isWin ? 'cloudnex-engine.exe' : 'cloudnex-engine'),
    path.join(binDir, isWin ? 'cloudnex-backend.exe' : 'cloudnex-backend'),
    path.join(backendDir, isWin ? 'cloudnex-backend.exe' : 'cloudnex-backend'),
    path.join(__dirname, 'backend', 'dist', isWin ? 'cloudnex-backend.exe' : 'cloudnex-backend'),
  ];

  let resolvedExecutable = null;
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      resolvedExecutable = cand;
      break;
    }
  }

  return {
    directory: fs.existsSync(backendDir) ? backendDir : root,
    engine: engineDir,
    executable: resolvedExecutable,
    script: path.join(__dirname, 'backend', 'app.py'),
  };
}

function startBackend() {
  const paths = backendPaths();
  const python = process.env.CLOUDNEX_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const useExecutable = Boolean(paths.executable && fs.existsSync(paths.executable));
  const command = useExecutable ? paths.executable : python;
  const args = useExecutable ? [] : [paths.script];

  backendProcess = spawn(command, args, {
    cwd: paths.directory,
    env: {
      ...process.env,
      CLOUDNEX_DESKTOP: '1',
      CLOUDNEX_BACKEND_PORT: String(BACKEND_PORT),
      CLOUDNEX_ENGINE_ROOT: paths.engine,
    },
    stdio: 'ignore',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  backendProcess.on('error', (error) => console.error('CloudNex backend failed to start:', error));
  backendProcess.on('exit', (code, signal) => {
    if (!shuttingDown) console.error(`CloudNex backend exited (${code ?? signal})`);
  });
}

function waitForBackend(timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(`${BACKEND_URL}/health`, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve();
        retry();
      });
      request.on('error', retry);
      request.setTimeout(1000, () => request.destroy());
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error('Timed out waiting for the Python backend.'));
      setTimeout(poll, 150);
    };
    poll();
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  shuttingDown = true;
  const pid = backendProcess.pid;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch (_) {
      try { backendProcess.kill('SIGTERM'); } catch (_) {}
    }
  }
  backendProcess = null;
}

async function createWindow() {
  if (process.env.CLOUDNEX_SKIP_BACKEND !== '1') {
    startBackend();
    await waitForBackend();
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0b1118',
    frame: false,
    titleBarStyle: 'hidden',
    resizable: true,
    maximizable: true,
    minimizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    stopBackend();
  });
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  registerWindowControls();
  try {
    await createWindow();
  } catch (error) {
    console.error(error);
    dialog.showErrorBox('CloudNex Local LLM Studio', error.message);
    stopBackend();
    app.quit();
  }
});

app.on('before-quit', stopBackend);
app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error);
});
