import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

async function isConfiguredSetuidHelper(path) {
  try {
    const details = await stat(path);
    return details.isFile() && details.uid === 0 && (details.mode & 0o4000) !== 0 && (details.mode & 0o022) === 0 && (details.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export async function getElectronLaunchConfig() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  if (process.platform !== 'linux') return { electronPath, env, sandboxHelper: null };

  const bundledHelper = `${electronPath.slice(0, electronPath.lastIndexOf('/'))}/chrome-sandbox`;
  if (await isConfiguredSetuidHelper(bundledHelper)) {
    return { electronPath, env, sandboxHelper: bundledHelper };
  }

  throw new Error(
    `Electron's bundled Linux sandbox helper is not root-owned with mode 4755: ${bundledHelper}\n` +
    `Repair it with these commands, then rerun npm run dev:electron:\n` +
    `  sudo chown root:root '${bundledHelper}'\n` +
    `  sudo chmod 4755 '${bundledHelper}'\n` +
    `ATG Pocket will not disable Chromium sandboxing. Reinstalling dependencies may reset these permissions.`,
  );
}
