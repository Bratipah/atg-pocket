import electron from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, ipcMain, protocol } = electron;
const rendererDirectory = path.resolve(here, '../renderer');
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
let trustedWindow: BrowserWindowType | null = null;

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
      localAi: 'not-integrated' as const,
      network: 'not-checked' as const,
    };
  });
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
