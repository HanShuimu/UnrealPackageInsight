#!/usr/bin/env node

const fs = require('node:fs');

const koffi = require('koffi');

const { decodeExtractResponse } = require('../../protocol/src/extract-response-decoder.js');
const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { PAK_EXTRACT_RESULT_PREFIX } = require('./extract-worker-client.js');

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
  process.stdout.write(`${PAK_EXTRACT_RESULT_PREFIX}${JSON.stringify(payload)}\n`);
}

function main(input = readPayloadFromStdin()) {
  const payload = decodePayload(input);
  const library = loadBackendLibrary({ dllPath: payload.dllPath, koffi });
  const bytes = callBufferedExport({
    fn: library.extractPakV1,
    koffi,
    args: [payload.pakPath || '', payload.outputDirectory || '', payload.aesKey ?? ''],
  });

  writeResult({
    ok: true,
    response: decodeExtractResponse(bytes),
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
