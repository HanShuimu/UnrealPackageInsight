#!/usr/bin/env node

const fs = require('node:fs');

const koffi = require('koffi');

const { decodeExtractResponse } = require('../../protocol/src/extract-response-decoder.js');
const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { PAK_EXTRACT_RESULT_PREFIX } = require('./extract-worker-client.js');

function defaultWrite(chunk) {
  process.stdout.write(chunk);
}

function readPayloadFromStdin() {
  return fs.readFileSync(0, 'utf8');
}

function decodePayload(input) {
  if (!input) {
    throw new Error('Missing worker payload.');
  }

  return JSON.parse(input);
}

function writeResult(payload, write = defaultWrite) {
  write(`${PAK_EXTRACT_RESULT_PREFIX}${JSON.stringify(payload)}\n`);
}

function main(input = readPayloadFromStdin(), dependencies = {}) {
  const {
    koffi: koffiImpl = koffi,
    loadBackendLibrary: loadBackendLibraryImpl = loadBackendLibrary,
    callBufferedExport: callBufferedExportImpl = callBufferedExport,
    decodeExtractResponse: decodeExtractResponseImpl = decodeExtractResponse,
    write = defaultWrite,
  } = dependencies;
  const payload = decodePayload(input);
  const library = loadBackendLibraryImpl({ dllPath: payload.dllPath, koffi: koffiImpl });
  const bytes = callBufferedExportImpl({
    fn: library.extractPakV1,
    koffi: koffiImpl,
    args: [payload.pakPath || '', payload.outputDirectory || '', payload.aesKey ?? ''],
  });

  writeResult({
    ok: true,
    response: decodeExtractResponseImpl(bytes),
  }, write);
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
  writeResult,
};
