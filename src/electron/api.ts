import type { PolicyEvaluationResult, PolicyConfiguration, Money } from './treasury-domain.js';

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

export interface AtgApi {
  getShellStatus(): Promise<ShellStatus>;
  getAiStatus(): Promise<AiStatus>;
  initializeAi(): Promise<AiStatus>;
  explainTreasury(input: ExplanationRequest): Promise<ExplanationResponse>;
  evaluateProposal(input: EvaluateProposalRequest): Promise<EvaluateProposalResponse>;
}

export const IPC = {
  getShellStatus: 'shell:get-status',
  getAiStatus: 'ai:get-status',
  initializeAi: 'ai:initialize',
  explainTreasury: 'ai:explain-treasury',
  evaluateProposal: 'treasury:evaluate-proposal',
} as const;
