const flatbuffers = require('flatbuffers');

const { IoStoreAnalysisResponse } = require('../generated/js/upi/v1.js');
const { readIssue } = require('./issue-utils.js');

function toByteBuffer(buffer) {
  if (ArrayBuffer.isView(buffer)) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  }

  if (buffer instanceof ArrayBuffer) {
    return new flatbuffers.ByteBuffer(new Uint8Array(buffer));
  }

  throw new TypeError('decodeIoStoreAnalysisResponse expects Buffer, Uint8Array, or ArrayBuffer input');
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
    utocPath: overview.utocPath(),
    containerBasePath: overview.containerBasePath(),
    containerId: overview.containerId(),
    tocVersion: overview.tocVersion(),
    tocEntryCount: overview.tocEntryCount(),
    compressionBlockCount: overview.compressionBlockCount(),
    compressionBlockSize: overview.compressionBlockSize(),
    partitionCount: overview.partitionCount(),
    partitionSize: overview.partitionSize(),
    containerFlags: overview.containerFlags(),
    encryptionKeyGuid: overview.encryptionKeyGuid(),
    directoryIndexSize: overview.directoryIndexSize(),
    indexed: overview.indexed(),
    partialListing: overview.partialListing(),
  };
}

function readPartitions(response) {
  const partitions = [];
  for (let index = 0; index < response.partitionsLength(); index++) {
    const entry = response.partitions(index);
    partitions.push({
      partitionIndex: entry.partitionIndex(),
      ucasPath: entry.ucasPath(),
      size: entry.size(),
    });
  }
  return partitions;
}

function readPackages(response) {
  const packages = [];
  for (let index = 0; index < response.packagesLength(); index++) {
    const entry = response.packages(index);
    packages.push({
      packagePath: entry.packagePath(),
      packageId: entry.packageId(),
      firstChunkIndex: entry.firstChunkIndex(),
      chunkCount: entry.chunkCount(),
      firstPartitionIndex: entry.firstPartitionIndex(),
      firstOffset: entry.firstOffset(),
      size: entry.size(),
      compressedSize: entry.compressedSize(),
      diskSize: entry.diskSize(),
      order: entry.order(),
      hasPath: entry.hasPath(),
    });
  }
  return packages;
}

function readChunks(response) {
  const chunks = [];
  for (let index = 0; index < response.chunksLength(); index++) {
    const entry = response.chunks(index);
    chunks.push({
      packageIndex: entry.packageIndex(),
      packagePath: entry.packagePath(),
      tocEntryIndex: entry.tocEntryIndex(),
      chunkId: entry.chunkId(),
      chunkType: entry.chunkType(),
      packageId: entry.packageId(),
      chunkIndex: entry.chunkIndex(),
      bulkDataCookedIndex: entry.bulkDataCookedIndex(),
      logicalOffset: entry.logicalOffset(),
      offset: entry.offset(),
      ucasOffset: entry.ucasOffset(),
      size: entry.size(),
      compressedSize: entry.compressedSize(),
      diskSize: entry.diskSize(),
      compression: entry.compression(),
      firstBlockIndex: entry.firstBlockIndex(),
      blockCount: entry.blockCount(),
      partitionIndex: entry.partitionIndex(),
      order: entry.order(),
      metaFlags: entry.metaFlags(),
      containerFlags: entry.containerFlags(),
      hash: entry.hash(),
      hasPath: entry.hasPath(),
    });
  }
  return chunks;
}

function readCompressedBlocks(response) {
  const compressedBlocks = [];
  for (let index = 0; index < response.compressedBlocksLength(); index++) {
    const entry = response.compressedBlocks(index);
    compressedBlocks.push({
      blockIndex: entry.blockIndex(),
      ownerTocEntryIndex: entry.ownerTocEntryIndex(),
      partitionIndex: entry.partitionIndex(),
      offset: entry.offset(),
      ucasOffset: entry.ucasOffset(),
      compressedSize: entry.compressedSize(),
      diskSize: entry.diskSize(),
      uncompressedSize: entry.uncompressedSize(),
      compression: entry.compression(),
    });
  }
  return compressedBlocks;
}

function decodeIoStoreAnalysisResponse(buffer) {
  const byteBuffer = toByteBuffer(buffer);
  if (!IoStoreAnalysisResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid IoStoreAnalysisResponse identifier: expected UPIO');
  }

  const response = IoStoreAnalysisResponse.getRootAsIoStoreAnalysisResponse(byteBuffer);
  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues: readIssues(response),
    overview: readOverview(response.overview()),
    partitions: readPartitions(response),
    packages: readPackages(response),
    chunks: readChunks(response),
    compressedBlocks: readCompressedBlocks(response),
  };
}

module.exports = {
  decodeIoStoreAnalysisResponse,
};
