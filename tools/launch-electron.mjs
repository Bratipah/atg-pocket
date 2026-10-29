import { spawn } from 'node:child_process';
import { getElectronLaunchConfig } from './electron-runtime.mjs';

let config;
try {
  config = await getElectronLaunchConfig();
} catch (error) {
  console.error(`[ATG Pocket] ${error instanceof Error ? error.message : 'Electron sandbox configuration is invalid.'}`);
  process.exit(1);
}

if (config.sandboxHelper && config.sandboxHelper !== `${config.electronPath.slice(0, config.electronPath.lastIndexOf('/'))}/chrome-sandbox`) {
  console.log(`[ATG Pocket] Using trusted Linux sandbox helper: ${config.sandboxHelper}`);
}

const child = spawn(config.electronPath, ['.'], { env: config.env, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`[ATG Pocket] Electron could not be started: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
