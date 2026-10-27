export interface ShellStatus {
  appVersion: string;
  localAi: 'not-integrated';
  network: 'not-checked';
}

export interface AtgApi {
  getShellStatus(): Promise<ShellStatus>;
}

export const IPC = {
  getShellStatus: 'shell:get-status',
} as const;
