const flatbuffers = require('flatbuffers');

const { PakAnalysisResponse } = require('../generated/js/upi/v1.js');
const { readIssue } = require('./issue-utils.js');

function toByteBuffer(buffer) {
  if (ArrayBuffer.isView(buffer)) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  }

  if (buffer instanceof ArrayBuffer) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer));
  }

  throw new TypeError('decodePakAnalysisResponse expects Buffer, Uint8Array, or ArrayBuffer input');
}

function readIssues(response) {
  const issues = [];
  for (let index = 0; index < response.issuesLength(); index++) {
    issues.push(readIssue(response.issues(index)));
  }
  return issues;
}

function readOverview(overview) {
  if (!overview) {
    return null;
  }

  return {
    pakPath: overview.pakPath(),
    mountPoint: overview.mountPoint(),
    pakVersion: overview.pakVersion(),
    pakSize: overview.pakSize(),
    indexEncrypted: overview.indexEncrypted(),
    encryptionKeyGuid: overview.encryptionKeyGuid(),
    hasFullDirectoryIndex: overview.hasFullDirectoryIndex(),
    partialListing: overview.partialListing(),
    packageCount: overview.packageCount(),
    compressedBlockCount: overview.compressedBlockCount(),
  };
}

function readPackages(response) {
  const packages = [];
  for (let index = 0; index < response.packagesLength(); index++) {
    const entry = response.packages(index);
    packages.push({
      packagePath: entry.packagePath(),
      mountPoint: entry.mountPoint(),
      offset: entry.offset(),
      payloadOffset: entry.payloadOffset(),
      size: entry.size(),
      compressedSize: entry.compressedSize(),
      recordSize: entry.recordSize(),
      compression: entry.compression(),
      compressionMethodIndex: entry.compressionMethodIndex(),
      compressionBlockSize: entry.compressionBlockSize(),
      compressionBlockCount: entry.compressionBlockCount(),
      firstCompressedBlockIndex: entry.firstCompressedBlockIndex(),
      relativeBlockOffsets: entry.relativeBlockOffsets(),
      order: entry.order(),
      flags: entry.flags(),
      hash: entry.hash(),
      hasPath: entry.hasPath(),
    });
  }
  return packages;
}

function readCompressedBlocks(response) {
  const compressedBlocks = [];
  for (let index = 0; index < response.compressedBlocksLength(); index++) {
    const entry = response.compressedBlocks(index);
    compressedBlocks.push({
      packageIndex: entry.packageIndex(),
      blockIndex: entry.blockIndex(),
      compressedStart: entry.compressedStart(),
      compressedEnd: entry.compressedEnd(),
      compressedSize: entry.compressedSize(),
      diskSize: entry.diskSize(),
      physicalStart: entry.physicalStart(),
      physicalEnd: entry.physicalEnd(),
    });
  }
  return compressedBlocks;
}

function decodePakAnalysisResponse(buffer) {
  const byteBuffer = toByteBuffer(buffer);
  if (!PakAnalysisResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid PakAnalysisResponse identifier: expected UPPA');
  }

  const response = PakAnalysisResponse.getRootAsPakAnalysisResponse(byteBuffer);
  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues: readIssues(response),
    overview: readOverview(response.overview()),
    packages: readPackages(response),
    compressedBlocks: readCompressedBlocks(response),
  };
}

module.exports = {
  decodePakAnalysisResponse,
};
