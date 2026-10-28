import { contextBridge, ipcRenderer } from 'electron';
import type { AtgApi } from './api.js';

const api: AtgApi = {
  getShellStatus: () => ipcRenderer.invoke('shell:get-status'),
  getAiStatus: () => ipcRenderer.invoke('ai:get-status'),
  initializeAi: () => ipcRenderer.invoke('ai:initialize'),
  explainTreasury: (input) => ipcRenderer.invoke('ai:explain-treasury', input),
  evaluateProposal: (input) => ipcRenderer.invoke('treasury:evaluate-proposal', input),
};

contextBridge.exposeInMainWorld('atg', api);
