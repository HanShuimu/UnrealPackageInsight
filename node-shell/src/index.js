const koffi = require('koffi');

const {
  DEFAULT_ENGINE_ROOT,
  buildDllSearchPath,
  resolveDllPath,
} = require('./dll-paths');
const { runBackendSmoke } = require('./backend-runner');

function main(argv = process.argv) {
  const dllPath = resolveDllPath(argv[2]);
  const engineRoot = process.env.UPI_ENGINE_ROOT || DEFAULT_ENGINE_ROOT;

  process.env.PATH = buildDllSearchPath({
    dllPath,
    engineRoot,
    existingPath: process.env.PATH || '',
  });

  runBackendSmoke({
    dllPath,
    koffi,
    log: console.log,
  });
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
