import { contextBridge, ipcRenderer } from 'electron';
import type { AtgApi } from './api.js';

const api: AtgApi = {
  getShellStatus: () => ipcRenderer.invoke('shell:get-status'),
};

contextBridge.exposeInMainWorld('atg', api);
