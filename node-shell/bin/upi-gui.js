const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');

function getNpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function ensureRendererDist({
  env = process.env,
  fsModule = fs,
  reportError = console.error,
  spawnSyncProcess = spawnSync,
  processController = process,
} = {}) {
  const rendererIndexPath = path.join(__dirname, '..', 'apps', 'desktop', 'renderer-dist', 'index.html');
  if (fsModule.existsSync(rendererIndexPath)) {
    return true;
  }

  const result = spawnSyncProcess(
    getNpmCommand(processController.platform || process.platform),
    ['run', 'build:renderer'],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...env },
      stdio: 'inherit',
    },
  );

  if (result.error) {
    reportError(`Failed to build renderer: ${result.error.message}`);
    processController.exitCode = 1;
    return false;
  }

  if (result.status !== 0) {
    const status = result.status ?? 1;
    reportError(`Renderer build failed with exit code ${status}.`);
    processController.exitCode = status;
    return false;
  }

  if (!fsModule.existsSync(rendererIndexPath)) {
    reportError('Renderer build completed, but renderer-dist/index.html was not created.');
    processController.exitCode = 1;
    return false;
  }

  return true;
}

function main({
  env = process.env,
  fsModule = fs,
  spawnProcess = spawn,
  spawnSyncProcess = spawnSync,
  electronPath = require('electron'),
  reportError = console.error,
  processController = process,
} = {}) {
  if (!ensureRendererDist({
    env,
    fsModule,
    reportError,
    spawnSyncProcess,
    processController,
  })) {
    return null;
  }

  const mainProcessPath = path.join(__dirname, '..', 'apps', 'desktop', 'main.js');
  const child = spawnProcess(electronPath, [mainProcessPath], {
    stdio: 'inherit',
    env: { ...env },
  });

  let spawnFailed = false;

  child.on('exit', (code, signal) => {
    if (spawnFailed) {
      return;
    }

    if (signal) {
      processController.kill(processController.pid, signal);
      return;
    }

    processController.exitCode = code ?? 0;
  });

  child.on('error', (error) => {
    spawnFailed = true;
    reportError(`Failed to start Electron: ${error.message}`);
    processController.exitCode = 1;
  });

  return child;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  ensureRendererDist,
  getNpmCommand,
  main,
};
