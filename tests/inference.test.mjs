import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateExplanationInput, validateModelAnswer } from '../dist/electron/validation.js';

test('accepts only the expected context object and trims context', () => {
  assert.deepEqual(validateExplanationInput({ context: '  Weekly budget is KES 100.  ' }), { context: 'Weekly budget is KES 100.' });
});

test('rejects malformed, empty, oversized, and extra-field requests', () => {
  for (const value of [null, [], 'budget', {}, { context: 'tiny' }, { context: 'x'.repeat(1601) }, { context: 'some context', path: '/tmp' }]) {
    assert.throws(() => validateExplanationInput(value));
  }
});

test('removes hidden reasoning markers and rejects malformed model output', () => {
  assert.equal(validateModelAnswer('<think>private</think>Visible answer.'), 'Visible answer.');
  assert.throws(() => validateModelAnswer(''));
  assert.throws(() => validateModelAnswer('x'.repeat(1801)));
  assert.throws(() => validateModelAnswer({ html: '<script/>' }));
});

test('Electron boundary retains hardened settings and exact allowlisted handlers', async () => {
  const [main, preload] = await Promise.all([
    readFile(new URL('../src/electron/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/electron/preload.cts', import.meta.url), 'utf8'),
  ]);
  for (const setting of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true', "connect-src 'none'", "frame.url.startsWith('app://atg/')"]) assert.ok(main.includes(setting), setting);
  assert.ok(main.includes('ipcMain.handle(IPC.explainTreasury'));
  assert.ok(preload.includes('explainTreasury: (input) => ipcRenderer.invoke'));
  assert.ok(!preload.includes('send:') && !preload.includes('require('));
});
