import type { AtgApi } from '../electron/api';

declare global {
  interface Window {
    atg: AtgApi;
  }
}

export {};
