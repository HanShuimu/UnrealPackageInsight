#!/usr/bin/env node

const koffi = require('koffi');

const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { WORKER_RESULT_PREFIX } = require('./pak-analysis-worker-client.js');

function decodePayload(argument) {
  if (!argument) {
    throw new Error('Missing worker payload.');
  }

  return JSON.parse(Buffer.from(argument, 'base64').toString('utf8'));
}

function writeResult(payload) {
  process.stdout.write(`${WORKER_RESULT_PREFIX}${JSON.stringify(payload)}\n`);
}

function main(argv = process.argv) {
  const payload = decodePayload(argv[2]);
  const library = loadBackendLibrary({ dllPath: payload.dllPath, koffi });
  const bytes = callBufferedExport({
    fn: library.analyzePakV1,
    koffi,
    args: [payload.pakPath || '', payload.aesKey ?? ''],
  });

  writeResult({
    ok: true,
    buffer: Buffer.from(bytes).toString('base64'),
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    writeResult({
      ok: false,
      error: error.message,
    });
    process.exitCode = 1;
  }
}

module.exports = {
  decodePayload,
  main,
};
