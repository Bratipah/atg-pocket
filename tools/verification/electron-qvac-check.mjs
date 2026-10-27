import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] ?? 'offline-success';
if (!['offline-success', 'offline-missing'].includes(mode)) {
  throw new Error('Usage: node tools/verification/electron-qvac-check.mjs [offline-success|offline-missing]');
}

const child = spawn(path.join(root, 'node_modules/electron/dist/electron'), ['.', '--remote-debugging-pipe'], {
  cwd: root,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
  stdio: ['ignore', 'inherit', 'inherit', 'pipe', 'pipe'],
});
const read = child.stdio[4];
const write = child.stdio[3];
const decoder = new StringDecoder('utf8');
let buffer = '';
let sequence = 0;
const pending = new Map();

read.on('data', (chunk) => {
  buffer += decoder.write(chunk);
  for (;;) {
    const end = buffer.indexOf('\0');
    if (end < 0) break;
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const message = JSON.parse(raw);
      if (pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    } catch { /* ignore non-JSON pipe fragments */ }
  }
});

function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, resolve);
    write.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`DevTools command timed out: ${method}`));
    }, 10_000);
    timer.unref();
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(expression, sessionId) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.error) throw new Error(result.error.message);
  return result.result?.result?.value;
}

try {
  const targetDeadline = Date.now() + 30_000;
  let target;
  while (Date.now() < targetDeadline) {
    try {
      const targets = (await cdp('Target.getTargets')).result.targetInfos;
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch { /* Electron is still starting */ }
    await pause(300);
  }
  if (!target) throw new Error('Electron renderer did not open');
  const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached.result.sessionId;
  const pageDeadline = Date.now() + 10_000;
  while (Date.now() < pageDeadline && await evaluate('location.href', sessionId) !== 'app://atg/index.html') await pause(100);
  if (await evaluate('location.href', sessionId) !== 'app://atg/index.html') throw new Error('ATG renderer did not finish loading');

  const starting = Date.now();
  await evaluate("Array.from(document.querySelectorAll('button')).find((button) => /Initialize local model|Retry model setup/.test(button.textContent))?.click()", sessionId);
  let state = '';
  const initializationLimitMs = mode === 'offline-missing' ? 210_000 : 60_000;
  const stateDeadline = Date.now() + initializationLimitMs;
  while (Date.now() < stateDeadline) {
    await pause(500);
    state = await evaluate("document.querySelector('.status-strip .strip-item strong')?.textContent || ''", sessionId);
    if (state === 'Local model ready' || state.includes('could not be initialized') || state.includes('process stopped')) break;
  }
  console.log('INITIALIZATION_STATE', state, 'ELAPSED_MS', Date.now() - starting);

  if (mode === 'offline-missing') {
    if (!state.includes('could not be initialized')) process.exitCode = 2;
  } else if (state === 'Local model ready') {
    await evaluate("Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Generate explanation'))?.click()", sessionId);
    const inferenceStarted = Date.now();
    let response = '';
    const inferenceDeadline = Date.now() + 180_000;
    while (Date.now() < inferenceDeadline) {
      await pause(500);
      response = await evaluate("document.querySelector('.ai-response')?.innerText || document.querySelector('.ai-error')?.innerText || ''", sessionId);
      if (response) break;
    }
    console.log('OFFLINE_GENERATED_RESPONSE', JSON.stringify(response));
    console.log('OFFLINE_UI_LATENCY', await evaluate("document.querySelector('.ai-latency')?.textContent", sessionId), 'ELAPSED_MS', Date.now() - inferenceStarted);
    if (!response.includes('AI-generated advisory explanation')) process.exitCode = 2;
  } else {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Electron QVAC verification failed');
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
