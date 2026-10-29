import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SepoliaWalletService } from '../dist/electron/sepolia-wallet.js';

test('wallet creation fails closed when OS encryption is unavailable or backend is not approved', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-wallet-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const pathName = path.join(dir, 'wallet.enc');
  const unavailable = { getSelectedStorageBackend: () => 'gnome_libsecret', isAsyncEncryptionAvailable: async () => false, encryptStringAsync: async () => { throw new Error('must not encrypt'); }, decryptStringAsync: async () => { throw new Error('unused'); } };
  await assert.rejects(new SepoliaWalletService(pathName, unavailable).createWallet(), /unavailable/);
  assert.deepEqual(await readdir(dir), []);
  const wrongBackend = { ...unavailable, isAsyncEncryptionAvailable: async () => true, getSelectedStorageBackend: () => 'basic_text' };
  await assert.rejects(new SepoliaWalletService(pathName, wrongBackend).createWallet(), /GNOME Keyring/);
  assert.deepEqual(await readdir(dir), []);
});

test('recovery accepts input only in recovery mode and rejects malformed phrases without persistence', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-wallet-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const storage = { getSelectedStorageBackend: () => 'gnome_libsecret', isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async () => Buffer.from('encrypted'), decryptStringAsync: async () => ({ result: 'invalid' }) };
  const service = new SepoliaWalletService(path.join(dir, 'wallet.enc'), storage);
  await assert.rejects(service.restoreFromPhrase('not a recovery phrase'), /dedicated recovery window/);
  service.beginRecoveryWindow();
  await assert.rejects(service.restoreFromPhrase('not a recovery phrase'), /valid recovery phrase/);
  assert.deepEqual(await readdir(dir), []);
});
