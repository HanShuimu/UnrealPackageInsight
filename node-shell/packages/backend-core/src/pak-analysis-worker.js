#!/usr/bin/env node

const fs = require('node:fs');

const koffi = require('koffi');

const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { WORKER_RESULT_PREFIX } = require('./pak-analysis-worker-client.js');

function readPayloadFromStdin() {
  return fs.readFileSync(0, 'utf8');
}

function decodePayload(input) {
  if (!input) {
    throw new Error('Missing worker payload.');
  }

  return JSON.parse(input);
}

function writeResult(payload) {
  process.stdout.write(`${WORKER_RESULT_PREFIX}${JSON.stringify(payload)}\n`);
}

function main(input = readPayloadFromStdin()) {
  const payload = decodePayload(input);
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
  readPayloadFromStdin,
};
