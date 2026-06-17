const flatbuffers = require('flatbuffers');

const { BackendInfoResponse } = require('../generated/js/upi/v1.js');
const { readIssue } = require('./issue-utils.js');

function toByteBuffer(buffer) {
  if (ArrayBuffer.isView(buffer)) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  }

  if (buffer instanceof ArrayBuffer) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer));
  }

  throw new TypeError('decodeBackendInfoResponse expects Buffer, Uint8Array, or ArrayBuffer input');
}

function readIssues(response) {
  const issues = [];
  for (let index = 0; index < response.issuesLength(); index++) {
    issues.push(readIssue(response.issues(index)));
  }
  return issues;
}

function decodeBackendInfoResponse(buffer) {
  const byteBuffer = toByteBuffer(buffer);
  if (!BackendInfoResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid BackendInfoResponse identifier: expected UPBI');
  }

  const response = BackendInfoResponse.getRootAsBackendInfoResponse(byteBuffer);
  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues: readIssues(response),
    backendName: response.backendName(),
    backendVersion: response.backendVersion(),
    unrealVersion: response.unrealVersion(),
    protocolVersion: response.protocolVersion(),
  };
}

module.exports = {
  decodeBackendInfoResponse,
};
