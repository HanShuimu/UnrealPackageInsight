const path = require('node:path');
const { spawn } = require('node:child_process');

function main({
  env = process.env,
  spawnProcess = spawn,
  electronPath = require('electron'),
  reportError = console.error,
  processController = process,
} = {}) {
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
  main,
};
