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
  getSepoliaWalletStatus: () => ipcRenderer.invoke('wallet:get-sepolia-status'),
  createSepoliaWallet: () => ipcRenderer.invoke('wallet:create-sepolia'),
  restoreSepoliaWallet: () => ipcRenderer.invoke('wallet:restore-sepolia'),
  reopenWalletBackup: () => ipcRenderer.invoke('wallet:reopen-backup'),
  quoteSepoliaTransfer: (input) => ipcRenderer.invoke('wallet:quote-sepolia-transfer', input),
  approveSepoliaTransfer: (input) => ipcRenderer.invoke('wallet:approve-sepolia-transfer', input),
  cancelSepoliaTransfer: (input) => ipcRenderer.invoke('wallet:cancel-sepolia-transfer', input),
  confirmSepoliaTransfer: (input) => ipcRenderer.invoke('wallet:confirm-sepolia-transfer', input),
  listSepoliaTransfers: () => ipcRenderer.invoke('wallet:list-sepolia-transfers'),
  verifySepoliaReceipt: (input) => ipcRenderer.invoke('wallet:verify-sepolia-receipt', input),
  openSepoliaExplorer: (input) => ipcRenderer.invoke('wallet:open-sepolia-explorer', input),
};

contextBridge.exposeInMainWorld('atg', api);
