import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: false,
    rollupOptions: { input: { main: resolve(process.cwd(), 'index.html'), walletBackup: resolve(process.cwd(), 'wallet-backup.html') } },
  },
});
