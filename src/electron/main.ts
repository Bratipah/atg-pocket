import electron from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './api.js';
import type { AiStatus, ExplanationResponse } from './api.js';
import { validateExplanationInput, validateModelAnswer } from './validation.js';
import type { QvacCommand, QvacResponse } from './qvac-protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, ipcMain, protocol, utilityProcess } = electron;
const rendererDirectory = path.resolve(here, '../renderer');
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
let trustedWindow: BrowserWindowType | null = null;
let worker: ReturnType<typeof utilityProcess.fork> | null = null;
let workerReady = false;
let requestId = 0;
let activeRequest = false;
let initializationPromise: Promise<AiStatus> | null = null;
let workerStatus: AiStatus = { state: 'not-initialized', message: 'Model not initialized' };
type QvacSuccess = Extract<QvacResponse, { ok: true }>;
const pending = new Map<number, { resolve: (value: QvacSuccess) => void; reject: (error: Error) => void }>();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function isTrustedMainFrame(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return Boolean(
    trustedWindow &&
      !trustedWindow.isDestroyed() &&
      event.sender.id === trustedWindow.webContents.id &&
      frame &&
      event.sender.mainFrame === frame &&
      frame.url.startsWith('app://atg/'),
  );
}

function registerIpc(): void {
  ipcMain.handle(IPC.getShellStatus, (event) => {
    if (!isTrustedMainFrame(event)) throw new Error('Untrusted IPC sender');
    return {
      appVersion: app.getVersion(),
      localAi: workerStatus.state,
      network: 'not-checked' as const,
    };
  });
  ipcMain.handle(IPC.getAiStatus, (event) => {
    assertTrusted(event);
    return workerStatus;
  });
  ipcMain.handle(IPC.initializeAi, async (event) => {
    assertTrusted(event);
    if (workerStatus.state === 'ready') return workerStatus;
    if (!initializationPromise) {
      workerStatus = { state: 'initializing', message: 'Loading local model…' };
      initializationPromise = (async () => {
        try {
          await sendToWorker({ type: 'initialize' });
          workerReady = true;
          workerStatus = { state: 'ready', message: 'Local model ready' };
        } catch {
          stopWorker();
          workerStatus = { state: 'failed', message: 'Model could not be initialized. Check connectivity or available disk space, then retry.' };
        }
        return workerStatus;
      })().finally(() => { initializationPromise = null; });
    }
    return initializationPromise;
  });
  ipcMain.handle(IPC.explainTreasury, async (event, rawInput): Promise<ExplanationResponse> => {
    assertTrusted(event);
    if (activeRequest) throw new Error('An explanation is already being generated.');
    const input = validateExplanationInput(rawInput);
    if (!workerReady) throw new Error('Initialize the local model before requesting an explanation.');
    activeRequest = true;
    workerStatus = { state: 'processing', message: 'Generating advisory explanation' };
    const started = performance.now();
    try {
      const result = await sendToWorker({ type: 'explain', context: input.context });
      return { answer: validateModelAnswer(result.answer), latencyMs: Math.round(performance.now() - started) };
    } catch {
      throw new Error('Local inference failed. The model remains available; please retry.');
    } finally {
      activeRequest = false;
      workerStatus = { state: 'ready', message: 'Local model ready' };
    }
  });
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  if (!isTrustedMainFrame(event)) throw new Error('Untrusted IPC sender');
}

async function sendToWorker(payload: QvacCommand): Promise<QvacSuccess> {
  if (!worker) await startWorker();
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Local model request timed out.'));
    }, 180_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    worker!.postMessage({ ...payload, id });
  });
}

async function startWorker(): Promise<void> {
  const dataDir = path.join(app.getPath('userData'), 'qvac');
  await mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, 'qvac.config.json');
  await writeFile(configPath, JSON.stringify({ loggerLevel: 'error', loggerConsoleOutput: false, cacheDirectory: path.join(dataDir, 'cache') }), { mode: 0o600 });
  const env = Object.fromEntries(Object.entries({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    QVAC_CONFIG_PATH: configPath,
  }).filter(([, value]) => typeof value === 'string'));
  const startedWorker = utilityProcess.fork(path.join(here, 'qvac-worker.js'), [], {
    serviceName: 'ATG local inference', stdio: 'ignore', env,
  });
  worker = startedWorker;
  startedWorker.on('message', (response: QvacResponse) => {
    const operation = pending.get(response.id);
    if (!operation) return;
    pending.delete(response.id);
    if (response.ok) operation.resolve(response);
    else operation.reject(new Error(response.error || 'Inference failed'));
  });
  startedWorker.on('exit', () => {
    if (worker !== startedWorker) return;
    worker = null;
    workerReady = false;
    for (const operation of pending.values()) operation.reject(new Error('Local model worker exited'));
    pending.clear();
    workerStatus = { state: 'failed', message: 'Local model process stopped. Retry initialization.' };
  });
}

function stopWorker(): void {
  const current = worker;
  worker = null;
  workerReady = false;
  if (current) current.kill();
}

async function registerAppProtocol(): Promise<void> {
  await protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'atg' || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return new Response('Not found', { status: 404 });
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const assetPath = path.resolve(rendererDirectory, relativePath);
    if (assetPath !== rendererDirectory && !assetPath.startsWith(`${rendererDirectory}${path.sep}`)) {
      return new Response('Not found', { status: 404 });
    }

    try {
      const body = await readFile(assetPath);
      const extension = path.extname(assetPath);
      const contentType = extension === '.html' ? 'text/html; charset=utf-8'
        : extension === '.js' ? 'text/javascript; charset=utf-8'
          : extension === '.css' ? 'text/css; charset=utf-8'
            : extension === '.svg' ? 'image/svg+xml'
              : 'application/octet-stream';
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'Content-Type': contentType, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 920,
    minHeight: 680,
    backgroundColor: '#101313',
    title: 'ATG Pocket',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  trustedWindow = window;

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('app://atg/')) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => {
    if (trustedWindow === window) trustedWindow = null;
  });
  await window.loadURL('app://atg/index.html');
}

app.whenReady().then(async () => {
  await registerAppProtocol();
  registerIpc();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
