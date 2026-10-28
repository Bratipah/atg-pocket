import { contextBridge, ipcRenderer } from 'electron';
import type { AtgApi } from './api.js';

const api: AtgApi = {
  getShellStatus: () => ipcRenderer.invoke('shell:get-status'),
  getAiStatus: () => ipcRenderer.invoke('ai:get-status'),
  initializeAi: () => ipcRenderer.invoke('ai:initialize'),
  explainTreasury: (input) => ipcRenderer.invoke('ai:explain-treasury', input),
  evaluateProposal: (input) => ipcRenderer.invoke('treasury:evaluate-proposal', input),
  createProposal: (input) => ipcRenderer.invoke('treasury:create-proposal', input),
  listProposals: () => ipcRenderer.invoke('treasury:list-proposals'),
  getProposalAudit: (input) => ipcRenderer.invoke('treasury:get-audit', input),
};

contextBridge.exposeInMainWorld('atg', api);
