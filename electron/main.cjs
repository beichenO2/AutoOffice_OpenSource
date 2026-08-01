/**
 * AutoOffice desktop app (Electron) — main process.
 *
 * On launch it boots the existing AutoOffice HTTP server (the same `startServer`
 * that powers `autooffice serve`) on a private localhost port, waits for health,
 * then opens the /aoide/ IDE in a native window. The server child is spawned with
 * ELECTRON_RUN_AS_NODE so we reuse the bundled Node/Electron runtime — no separate
 * Node install required — and is torn down on quit.
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

let serverProc = null;
let serverPort = 0;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitHealth(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('AutoOffice server did not become healthy in time'));
      else setTimeout(attempt, 400);
    };
    attempt();
  });
}

async function startServer() {
  serverPort = await findFreePort();
  const boot = path.join(__dirname, 'server-boot.mjs');
  serverProc = spawn(process.execPath, [boot], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(serverPort),
      AUTOOFFICE_PPT_SOT: process.env.AUTOOFFICE_PPT_SOT || 'slidev',
      // estimate box map → no Chromium dependency for box-select in the desktop app
      AUTOOFFICE_BOXMAP: process.env.AUTOOFFICE_BOXMAP || 'estimate',
      // persist generated decks/projects under the OS app-data dir
      AUTOOFFICE_ENGINE_HOME: process.env.AUTOOFFICE_ENGINE_HOME || path.join(app.getPath('userData'), 'engine-home'),
      // enable GLM-backed generation/editing when a local LLM proxy is available
      AUTOOFFICE_LLM_EDIT: process.env.AUTOOFFICE_LLM_EDIT || '1',
    },
    stdio: 'inherit',
  });
  serverProc.on('exit', () => { serverProc = null; });
  await waitHealth(serverPort);
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'AutoOffice',
    backgroundColor: '#0e1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const origin = `http://127.0.0.1:${serverPort}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`${origin}/aoide/`);
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* ignore */ }
    serverProc = null;
  }
}

app.whenReady().then(async () => {
  try {
    await startServer();
    await createWindow();
  } catch (err) {
    dialog.showErrorBox('AutoOffice 启动失败', String((err && err.stack) || err));
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS keeps the app (and its server) alive until the user quits; other platforms
// quit when the last window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { stopServer(); app.quit(); }
});
app.on('before-quit', stopServer);
process.on('exit', stopServer);
