const flatbuffers = require('flatbuffers');

const { ExtractResponse } = require('../generated/js/upi/v1.js');
const { readIssue } = require('./issue-utils.js');

function toByteBuffer(buffer) {
  if (ArrayBuffer.isView(buffer)) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  }

  if (buffer instanceof ArrayBuffer) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer));
  }

  throw new TypeError('decodeExtractResponse expects Buffer, Uint8Array, or ArrayBuffer input');
}

function readIssues(response) {
  const issues = [];
  for (let index = 0; index < response.issuesLength(); index += 1) {
    issues.push(readIssue(response.issues(index)));
  }
  return issues;
}

function decodeExtractResponse(buffer) {
  const byteBuffer = toByteBuffer(buffer);
  if (!ExtractResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid ExtractResponse identifier: expected UPEX');
  }

  const response = ExtractResponse.getRootAsExtractResponse(byteBuffer);
  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues: readIssues(response),
    containerPath: response.containerPath(),
    outputDirectory: response.outputDirectory(),
    extractedFileCount: response.extractedFileCount(),
    errorCount: response.errorCount(),
  };
}

module.exports = {
  decodeExtractResponse,
};
