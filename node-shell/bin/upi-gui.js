const path = require('node:path');
const { spawn } = require('node:child_process');

const koffi = require('koffi');

const {
  DEFAULT_ENGINE_ROOT,
  buildDllSearchPath,
  resolveDllPath,
} = require('../src/dll-paths');
const { createBackendClient } = require('../packages/backend-core/src/backend-client.js');

function main({
  argv = process.argv,
  env = process.env,
  spawnProcess = spawn,
  electronPath = require('electron'),
  backendClientFactory = createBackendClient,
  koffiModule = koffi,
} = {}) {
  const dllPath = resolveDllPath(argv[2] || env.UPI_BACKEND_DLL);
  const engineRoot = env.UPI_ENGINE_ROOT || DEFAULT_ENGINE_ROOT;

  env.PATH = buildDllSearchPath({
    dllPath,
    engineRoot,
    existingPath: env.PATH || '',
  });

  backendClientFactory({ dllPath, koffi: koffiModule }).getBackendInfo();

  const mainProcessPath = path.join(__dirname, '..', 'apps', 'desktop', 'main.js');
  const child = spawnProcess(electronPath, [mainProcessPath], {
    stdio: 'inherit',
    env: {
      ...env,
      UPI_BACKEND_DLL: dllPath,
      UPI_ENGINE_ROOT: engineRoot,
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 0;
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
