import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('walletBackup', {
  getMode: (): Promise<'backup' | 'recovery'> => ipcRenderer.invoke('wallet-backup:get-mode'),
  getPhrase: (): Promise<string> => ipcRenderer.invoke('wallet-backup:get-phrase'),
  restorePhrase: (phrase: string): Promise<{ address: string }> => ipcRenderer.invoke('wallet-backup:restore-phrase', phrase),
  confirmWritten: (): Promise<void> => ipcRenderer.invoke('wallet-backup:confirm-written'),
});
