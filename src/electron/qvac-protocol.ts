export type QvacCommand =
  | { type: 'initialize' }
  | { type: 'explain'; context: string };

export type QvacRequest = QvacCommand & { id: number };

export type QvacResponse =
  | { id: number; ok: true; answer?: unknown }
  | { id: number; ok: false; error: string };
