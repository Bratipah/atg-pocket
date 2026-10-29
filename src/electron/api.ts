import type { PolicyEvaluationResult, PolicyConfiguration, Money } from './treasury-domain.js';
import type { AuditEvent, AuditVerification, PersistedProposal } from './treasury-store.js';
import type { TransferQuote, WalletStatus } from './sepolia-wallet.js';
import type { TransferRecord } from './transfer-store.js';

export interface ShellStatus {
  appVersion: string;
  localAi: AiState;
  network: 'not-checked';
}

export type AiState = 'not-initialized' | 'initializing' | 'ready' | 'processing' | 'failed';
export interface AiStatus { state: AiState; message: string; }
export interface ExplanationRequest { context: string; }
export interface ExplanationResponse { answer: string; latencyMs: number; }
export interface EvaluateProposalRequest { amount: string; currency: string; }
export interface EvaluateProposalResponse {
  synthetic: true;
  transaction: Money;
  policy: PolicyConfiguration;
  priorSpending: Money;
  result: PolicyEvaluationResult;
}
export interface CreateProposalResponse { proposal: PersistedProposal; verification: AuditVerification }
export interface ProposalAuditResponse { events: AuditEvent[]; verification: AuditVerification }

export interface AtgApi {
  getShellStatus(): Promise<ShellStatus>;
  getAiStatus(): Promise<AiStatus>;
  initializeAi(): Promise<AiStatus>;
  explainTreasury(input: ExplanationRequest): Promise<ExplanationResponse>;
  evaluateProposal(input: EvaluateProposalRequest): Promise<EvaluateProposalResponse>;
  createProposal(input: EvaluateProposalRequest): Promise<CreateProposalResponse>;
  listProposals(): Promise<PersistedProposal[]>;
  getProposalAudit(input?: { proposalId?: string }): Promise<ProposalAuditResponse>;
  getSepoliaWalletStatus(): Promise<WalletStatus>;
  createSepoliaWallet(): Promise<{ address: string }>;
  reopenWalletBackup(): Promise<boolean>;
  restoreSepoliaWallet(): Promise<boolean>;
  quoteSepoliaTransfer(input: { recipient: string; amount: string }): Promise<TransferQuote>;
  approveSepoliaTransfer(input: { proposalId: string }): Promise<TransferRecord>;
  cancelSepoliaTransfer(input: { proposalId: string }): Promise<TransferRecord>;
  confirmSepoliaTransfer(input: { proposalId: string }): Promise<{ transfer: TransferRecord; error?: string }>;
  listSepoliaTransfers(): Promise<TransferRecord[]>;
  verifySepoliaReceipt(input: { proposalId: string }): Promise<TransferRecord>;
  openSepoliaExplorer(input: { proposalId: string }): Promise<boolean>;
}

export const IPC = {
  getShellStatus: 'shell:get-status',
  getAiStatus: 'ai:get-status',
  initializeAi: 'ai:initialize',
  explainTreasury: 'ai:explain-treasury',
  evaluateProposal: 'treasury:evaluate-proposal',
  createProposal: 'treasury:create-proposal',
  listProposals: 'treasury:list-proposals',
  getProposalAudit: 'treasury:get-audit',
  getSepoliaWalletStatus: 'wallet:get-sepolia-status',
  createSepoliaWallet: 'wallet:create-sepolia',
  restoreSepoliaWallet: 'wallet:restore-sepolia',
  quoteSepoliaTransfer: 'wallet:quote-sepolia-transfer',
  approveSepoliaTransfer: 'wallet:approve-sepolia-transfer',
  cancelSepoliaTransfer: 'wallet:cancel-sepolia-transfer',
  confirmSepoliaTransfer: 'wallet:confirm-sepolia-transfer',
  listSepoliaTransfers: 'wallet:list-sepolia-transfers',
  verifySepoliaReceipt: 'wallet:verify-sepolia-receipt',
  openSepoliaExplorer: 'wallet:open-sepolia-explorer',
} as const;
