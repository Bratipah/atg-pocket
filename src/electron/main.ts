import electron from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from './api.js';
import type { AiStatus, ExplanationResponse } from './api.js';
import { validateAuditRequest, validateExplanationInput, validateModelAnswer, validateProposalInput } from './validation.js';
import { DEMO_POLICY, DEMO_PRIOR_SPENDING, evaluatePolicy, parseMoney } from './treasury-domain.js';
import type { EvaluateProposalResponse } from './api.js';
import { TreasuryStore } from './treasury-store.js';
import type { QvacCommand, QvacResponse } from './qvac-protocol.js';
import { SepoliaWalletService, publicQuoteDetails } from './sepolia-wallet.js';
import { TransferStore } from './transfer-store.js';
import { SEPOLIA_CHAIN_ID } from './sepolia-domain.js';
import { formatWeiAsEth } from './sepolia-domain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { app, BrowserWindow, ipcMain, protocol, utilityProcess, safeStorage, shell, dialog } = electron;
const hasSingleInstance = app.requestSingleInstanceLock();
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
let treasuryStore: TreasuryStore;
let sepoliaWallet: SepoliaWalletService;
let transferStore: TransferStore;
let backupWindow: BrowserWindowType | null = null;
let backupWindowMode: 'backup' | 'recovery' = 'backup';
const confirmingTransferIds = new Set<string>();

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
  ipcMain.handle(IPC.evaluateProposal, (event, rawInput): EvaluateProposalResponse => {
    assertTrusted(event);
    const request = validateProposalInput(rawInput);
    const transaction = parseMoney(request.amount, request.currency);
    return {
      synthetic: true,
      transaction,
      policy: DEMO_POLICY,
      priorSpending: DEMO_PRIOR_SPENDING,
      result: evaluatePolicy({ transaction: { amount: transaction }, policy: DEMO_POLICY, priorSpending: DEMO_PRIOR_SPENDING }),
    };
  });
  ipcMain.handle(IPC.createProposal, async (event, rawInput) => {
    assertTrusted(event);
    const request = validateProposalInput(rawInput);
    const transaction = parseMoney(request.amount, request.currency);
    const result = evaluatePolicy({ transaction: { amount: transaction }, policy: DEMO_POLICY, priorSpending: DEMO_PRIOR_SPENDING });
    const proposal = await treasuryStore.createProposal({ transaction, evaluation: {
      policyId: DEMO_POLICY.id, policyVersion: DEMO_POLICY.version, policyCurrency: DEMO_POLICY.currency,
      perTransactionLimit: DEMO_POLICY.perTransactionLimit, period: DEMO_POLICY.periodBudget.period,
      periodCap: DEMO_POLICY.periodBudget.cap, approvalThreshold: DEMO_POLICY.approvalThreshold,
      priorSpending: DEMO_PRIOR_SPENDING, outcome: result.outcome, reasonCodes: [...result.reasonCodes],
    } });
    return { proposal, verification: (await treasuryStore.getAudit(proposal.id)).verification };
  });
  ipcMain.handle(IPC.listProposals, (event) => { assertTrusted(event); return treasuryStore.listProposals(); });
  ipcMain.handle(IPC.getProposalAudit, (event, rawInput) => {
    assertTrusted(event); const request = validateAuditRequest(rawInput); return treasuryStore.getAudit(request.proposalId);
  });
  ipcMain.handle(IPC.getSepoliaWalletStatus, async (event) => { assertTrusted(event); return sepoliaWallet.getStatus(); });
  ipcMain.handle(IPC.createSepoliaWallet, async (event) => {
    assertTrusted(event);
    const result = await sepoliaWallet.createWallet();
    openWalletBackupWindow('backup');
    return result;
  });
  ipcMain.handle(IPC.restoreSepoliaWallet, (event) => { assertTrusted(event); sepoliaWallet.beginRecoveryWindow(); openWalletBackupWindow('recovery'); return true; });
  ipcMain.handle('wallet:reopen-backup', (event) => { assertTrusted(event); if (!sepoliaWallet.hasPendingBackup()) throw new Error('No unconfirmed backup or recovery is available in this app session.'); openWalletBackupWindow(backupWindowMode); return true; });
  ipcMain.handle('wallet-backup:get-mode', (event) => { assertBackupWindow(event); return backupWindowMode; });
  ipcMain.handle('wallet-backup:get-phrase', (event) => { assertBackupWindow(event); return sepoliaWallet.consumeBackupPhrase(); });
  ipcMain.handle('wallet-backup:restore-phrase', async (event, phrase) => { assertBackupWindow(event); if (backupWindowMode !== 'recovery' || typeof phrase !== 'string' || phrase.length > 300) throw new Error('Invalid recovery request.'); return sepoliaWallet.restoreFromPhrase(phrase); });
  ipcMain.handle('wallet-backup:confirm-written', async (event) => { assertBackupWindow(event); await sepoliaWallet.confirmBackup(); backupWindow?.close(); return true; });
  ipcMain.handle(IPC.quoteSepoliaTransfer, async (event, raw) => {
    assertTrusted(event);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || typeof raw.recipient !== 'string' || typeof raw.amount !== 'string') throw new Error('Invalid transfer proposal.');
    const quote = await sepoliaWallet.quoteTransfer({ ...raw, chainId: SEPOLIA_CHAIN_ID, asset: 'native-ETH' });
    try {
      const record = await transferStore.create({ id: quote.proposalId, chainId: quote.chainId, asset: quote.asset, recipient: quote.recipient, amountWei: quote.amountWei, feeWei: quote.feeWei, decision: quote.decision, reason: quote.reason });
      return { ...quote, publicDetails: publicQuoteDetails(quote) };
    } catch (error) { sepoliaWallet.cancelTransfer(quote.proposalId); throw error; }
  });
  ipcMain.handle(IPC.approveSepoliaTransfer, async (event, raw) => {
    assertTrusted(event); const id = validateTransferId(raw);
    if (confirmingTransferIds.has(id)) throw new Error('Final confirmation is already open for this transfer.');
    const current = (await transferStore.list()).find((item) => item.id === id);
    if (!current || current.state !== 'awaiting_approval' || current.decision !== 'require_approval') throw new Error('Transfer is not awaiting policy approval.');
    sepoliaWallet.approveTransfer(id);
    return transferStore.update(id, 'ready_to_confirm', { humanApproval: true }, { approved: true });
  });
  ipcMain.handle(IPC.cancelSepoliaTransfer, async (event, raw) => {
    assertTrusted(event); const id = validateTransferId(raw);
    if (confirmingTransferIds.has(id)) throw new Error('Final confirmation is already open for this transfer.');
    const current = (await transferStore.list()).find((item) => item.id === id);
    if (!current || !['awaiting_approval', 'ready_to_confirm'].includes(current.state)) throw new Error('Transfer can no longer be cancelled from its current lifecycle state.');
    sepoliaWallet.cancelTransfer(id); return transferStore.update(id, 'cancelled', { humanAction: 'cancelled' });
  });
  ipcMain.handle(IPC.confirmSepoliaTransfer, async (event, raw) => {
    assertTrusted(event); const id = validateTransferId(raw);
    if (confirmingTransferIds.has(id)) throw new Error('This transfer already has a confirmation dialog open.');
    const current = (await transferStore.list()).find((item) => item.id === id);
    if (!current || current.state !== 'ready_to_confirm' || current.confirmed || current.decision === 'require_approval' && !current.approved) throw new Error('Transfer is not approved and ready for explicit confirmation.');
    if (!trustedWindow || trustedWindow.isDestroyed()) throw new Error('The trusted confirmation window is unavailable.');
    confirmingTransferIds.add(id);
    try {
    const confirmation = await dialog.showMessageBox(trustedWindow, {
      type: 'warning', title: 'Confirm Sepolia test transfer',
      message: 'Review this exact transfer before signing and broadcasting.',
      detail: `Network: Ethereum Sepolia (chain ID ${current.chainId})\nAsset: native test ETH\nRecipient: ${current.recipient}\nAmount: ${formatWeiAsEth(BigInt(current.amountWei))} ETH\nMaximum fee quote: ${formatWeiAsEth(BigInt(current.feeWei))} ETH\nTotal debit ceiling: ${formatWeiAsEth(BigInt(current.amountWei) + BigInt(current.feeWei))} ETH\n\nSepolia ETH has no real-world value. This action will broadcast a public testnet transaction.`,
      buttons: ['Cancel', 'Sign and broadcast'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) {
      sepoliaWallet.cancelTransfer(id);
      return { transfer: await transferStore.update(id, 'cancelled', { humanAction: 'confirmation_cancelled' }) };
    }
    const rechecked = (await transferStore.list()).find((item) => item.id === id);
    if (!rechecked || rechecked.state !== 'ready_to_confirm' || rechecked.confirmed || rechecked.decision === 'require_approval' && !rechecked.approved) throw new Error('Transfer changed while confirmation was open; review a fresh proposal.');
    await transferStore.update(id, 'ready_to_confirm', { humanAction: 'explicit_confirmation' }, { confirmed: true });
    try {
      await sepoliaWallet.submitTransfer(id, async (state, details = {}) => {
        const txHash = typeof details.txHash === 'string' ? details.txHash : undefined;
        if (state === 'broadcast_attempt') { await transferStore.recordEvent(id, 'broadcast.attempt', {}); return; }
        await transferStore.update(id, state as any, details, txHash ? { txHash } : {});
      });
    } catch {
      let transfer = (await transferStore.list()).find((item) => item.id === id)!;
      if (transfer.state === 'ready_to_confirm') transfer = await transferStore.update(id, 'failed', { reason: 'final_revalidation_or_signing_failed' });
      return { transfer, error: 'Signing or submission failed. Check this lifecycle record before retrying.' };
    }
    return { transfer: (await transferStore.list()).find((item) => item.id === id)! };
    } finally { confirmingTransferIds.delete(id); }
  });
  ipcMain.handle(IPC.listSepoliaTransfers, (event) => { assertTrusted(event); return transferStore.list(); });
  ipcMain.handle(IPC.verifySepoliaReceipt, async (event, raw) => {
    assertTrusted(event); const id = validateTransferId(raw);
    const current = (await transferStore.list()).find((item) => item.id === id);
    if (!current?.txHash) throw new Error('No real transaction hash is available to verify.');
    const receipt = await sepoliaWallet.verifyReceipt(current.txHash);
    const wallet = await sepoliaWallet.getStatus();
    const matchesProposal = Boolean(wallet.address && receipt.from?.toLowerCase() === wallet.address.toLowerCase() && receipt.recipient?.toLowerCase() === current.recipient.toLowerCase() && receipt.valueWei === current.amountWei);
    const observed = receipt.status === 'confirmed' && !matchesProposal ? 'unknown' : receipt.status;
    return transferStore.update(id, observed === 'confirmed' ? 'confirmed' : observed === 'failed' ? 'failed' : observed === 'pending' ? 'broadcast' : 'unknown', { receiptStatus: observed, detailMatch: matchesProposal, independentRpc: 'public.1rpc.io/sepolia', ...(receipt.blockNumber ? { blockNumber: receipt.blockNumber } : {}) }, { receiptStatus: observed });
  });
  ipcMain.handle(IPC.openSepoliaExplorer, async (event, raw) => {
    assertTrusted(event); const id = validateTransferId(raw);
    const current = (await transferStore.list()).find((item) => item.id === id);
    if (!current?.txHash || !/^0x[0-9a-fA-F]{64}$/.test(current.txHash)) throw new Error('No real transaction hash is available.');
    await shell.openExternal(`https://sepolia.etherscan.io/tx/${current.txHash}`); return true;
  });
}

function validateTransferId(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || typeof (raw as any).proposalId !== 'string' || !/^[0-9a-f-]{36}$/i.test((raw as any).proposalId)) throw new Error('Invalid transfer request.');
  return (raw as any).proposalId;
}

function assertBackupWindow(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!backupWindow || backupWindow.isDestroyed() || event.sender.id !== backupWindow.webContents.id || !frame || event.sender.mainFrame !== frame || frame.url !== 'app://atg/wallet-backup.html') throw new Error('Untrusted wallet backup window.');
}

function openWalletBackupWindow(mode: 'backup' | 'recovery'): void {
  if (backupWindow && !backupWindow.isDestroyed()) { backupWindow.focus(); return; }
  backupWindowMode = mode;
  if (mode === 'backup') sepoliaWallet.beginBackupWindow();
  const window = new BrowserWindow({ width: 760, height: 760, ...(trustedWindow ? { parent: trustedWindow, modal: true } : {}), show: false, title: 'Wallet backup — ATG Pocket', autoHideMenuBar: true, webPreferences: { preload: path.join(here, 'wallet-backup-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false } });
  backupWindow = window;
  window.webContents.on('will-navigate', (event, url) => { if (url !== 'app://atg/wallet-backup.html') event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => { if (backupWindow === window) backupWindow = null; });
  void window.loadURL('app://atg/wallet-backup.html').then(() => window.show());
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
    if (targetUrl !== 'app://atg/index.html') event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => {
    if (trustedWindow === window) trustedWindow = null;
  });
  await window.loadURL('app://atg/index.html');
}

if (!hasSingleInstance) {
  app.quit();
} else app.whenReady().then(async () => {
  treasuryStore = new TreasuryStore(path.join(app.getPath('userData'), 'treasury-v1.json'));
  sepoliaWallet = new SepoliaWalletService(path.join(app.getPath('userData'), 'sepolia-wallet-v1.enc'), safeStorage);
  transferStore = new TransferStore(path.join(app.getPath('userData'), 'sepolia-transfers-v1.json'));
  try { await transferStore.recoverAfterRestart(); }
  catch { /* Keep the desktop available; TransferStore remains fail-closed on every subsequent read/write. */ }
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
