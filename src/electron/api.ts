export interface ShellStatus {
  appVersion: string;
  localAi: AiState;
  network: 'not-checked';
}

export type AiState = 'not-initialized' | 'initializing' | 'ready' | 'processing' | 'failed';
export interface AiStatus { state: AiState; message: string; }
export interface ExplanationRequest { context: string; }
export interface ExplanationResponse { answer: string; latencyMs: number; }

export interface AtgApi {
  getShellStatus(): Promise<ShellStatus>;
  getAiStatus(): Promise<AiStatus>;
  initializeAi(): Promise<AiStatus>;
  explainTreasury(input: ExplanationRequest): Promise<ExplanationResponse>;
}

export const IPC = {
  getShellStatus: 'shell:get-status',
  getAiStatus: 'ai:get-status',
  initializeAi: 'ai:initialize',
  explainTreasury: 'ai:explain-treasury',
} as const;
