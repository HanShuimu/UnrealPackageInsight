const assert = require('node:assert/strict');
const test = require('node:test');

const flatbuffers = require('flatbuffers');

const { decodeBackendInfoResponse } = require('../src/backend-info-decoder.js');
const { decodePakAnalysisResponse } = require('../src/pak-analysis-decoder.js');
const { decodeIoStoreAnalysisResponse } = require('../src/iostore-analysis-decoder.js');
const { hasIssueCode } = require('../src/issue-utils.js');
const {
  BackendInfoResponse,
  IoStoreAnalysisResponse,
  IoStoreChunkEntry,
  IoStoreCompressedBlockEntry,
  IoStoreOverview,
  IoStorePackageEntry,
  IoStorePartition,
  Issue,
  IssueSeverity,
  PakAnalysisResponse,
  PakCompressedBlockEntry,
  PakOverview,
  PakPackageEntry,
  ResponseStatus,
} = require('../generated/js/upi/v1.js');

function finishBuilder(builder, rootOffset, finish) {
  finish(builder, rootOffset);
  return builder.asUint8Array();
}

function createIssue(builder, severity, code, message) {
  return Issue.createIssue(
    builder,
    severity,
    builder.createString(code),
    builder.createString(message),
  );
}

function corruptIdentifier(buffer) {
  const corrupted = Buffer.from(buffer);
  corrupted[4] = 0;
  return corrupted;
}

function createBackendInfoBuffer() {
  const builder = new flatbuffers.Builder(256);
  const issue = createIssue(
    builder,
    IssueSeverity.Warning,
    'UPI_BACKEND_VERSION_MISMATCH',
    'Backend protocol version is newer than expected.',
  );
  const issues = BackendInfoResponse.createIssuesVector(builder, [issue]);
  const backendName = builder.createString('UnrealPackageInsightBackend');
  const backendVersion = builder.createString('1.2.3');
  const unrealVersion = builder.createString('5.4.4');
  const root = BackendInfoResponse.createBackendInfoResponse(
    builder,
    7,
    ResponseStatus.Error,
    issues,
    backendName,
    backendVersion,
    unrealVersion,
    11,
  );
  return finishBuilder(builder, root, BackendInfoResponse.finishBackendInfoResponseBuffer);
}

function createPakAnalysisBuffer() {
  const builder = new flatbuffers.Builder(1024);
  const pakPath = builder.createString('C:/Game/Content/Paks/game.pak');
  const mountPoint = builder.createString('../../../Game/');
  const encryptionKeyGuid = builder.createString('00000000-0000-0000-0000-000000000001');
  const overview = PakOverview.createPakOverview(
    builder,
    pakPath,
    mountPoint,
    12,
    9_007_199_254_740_993n,
    true,
    encryptionKeyGuid,
    true,
    false,
    1,
    1,
  );

  const packagePath = builder.createString('../../../Game/Maps/Arena.umap');
  const packageMountPoint = builder.createString('../../../Game/');
  const compression = builder.createString('Oodle');
  const hash = builder.createString('0123456789abcdef');
  const packageEntry = PakPackageEntry.createPakPackageEntry(
    builder,
    packagePath,
    packageMountPoint,
    9_007_199_254_740_995n,
    9_007_199_254_741_111n,
    123_456_789_012_345n,
    98_765_432_101n,
    256n,
    compression,
    2,
    65_536,
    1,
    0,
    true,
    42,
    7,
    hash,
    true,
  );
  const packages = PakAnalysisResponse.createPackagesVector(builder, [packageEntry]);

  const compressedBlock = PakCompressedBlockEntry.createPakCompressedBlockEntry(
    builder,
    0,
    0,
    9_007_199_254_741_333n,
    9_007_199_254_741_999n,
    666n,
    700n,
    9_007_199_254_742_000n,
    9_007_199_254_742_700n,
  );
  const compressedBlocks = PakAnalysisResponse.createCompressedBlocksVector(builder, [compressedBlock]);

  const issue = createIssue(builder, IssueSeverity.Info, 'UPI_PAK_PARTIAL_LISTING', 'Listing is partial.');
  const issues = PakAnalysisResponse.createIssuesVector(builder, [issue]);
  PakAnalysisResponse.startPakAnalysisResponse(builder);
  PakAnalysisResponse.addSchemaVersion(builder, 8);
  PakAnalysisResponse.addStatus(builder, ResponseStatus.Ok);
  PakAnalysisResponse.addIssues(builder, issues);
  PakAnalysisResponse.addOverview(builder, overview);
  PakAnalysisResponse.addPackages(builder, packages);
  PakAnalysisResponse.addCompressedBlocks(builder, compressedBlocks);
  const root = PakAnalysisResponse.endPakAnalysisResponse(builder);
  return finishBuilder(builder, root, PakAnalysisResponse.finishPakAnalysisResponseBuffer);
}

function createIoStoreAnalysisBuffer() {
  const builder = new flatbuffers.Builder(2048);
  const utocPath = builder.createString('C:/Game/Content/Paks/global.utoc');
  const basePath = builder.createString('C:/Game/Content/Paks/global');
  const encryptionKeyGuid = builder.createString('00000000-0000-0000-0000-000000000002');
  const overview = IoStoreOverview.createIoStoreOverview(
    builder,
    utocPath,
    basePath,
    18_446_744_073_709_551_615n,
    5,
    1,
    1,
    131_072,
    1,
    9_007_199_254_740_997n,
    3,
    encryptionKeyGuid,
    4096,
    true,
    false,
  );

  const ucasPath = builder.createString('C:/Game/Content/Paks/global.ucas');
  const partition = IoStorePartition.createIoStorePartition(builder, 0, ucasPath, 9_007_199_254_741_777n);
  const partitions = IoStoreAnalysisResponse.createPartitionsVector(builder, [partition]);

  const packagePath = builder.createString('/Game/Characters/Hero');
  const packageEntry = IoStorePackageEntry.createIoStorePackageEntry(
    builder,
    packagePath,
    9_007_199_254_742_123n,
    0,
    1,
    0,
    9_007_199_254_742_222n,
    2_048n,
    1_024n,
    1_088n,
    9,
    true,
  );
  const packages = IoStoreAnalysisResponse.createPackagesVector(builder, [packageEntry]);

  const chunkPackagePath = builder.createString('/Game/Characters/Hero');
  const chunkId = builder.createString('ABCDEF0123456789');
  const chunkType = builder.createString('ExportBundleData');
  const chunkCompression = builder.createString('Oodle');
  const chunkHash = builder.createString('fedcba9876543210');
  const chunk = IoStoreChunkEntry.createIoStoreChunkEntry(
    builder,
    0,
    chunkPackagePath,
    12,
    chunkId,
    chunkType,
    9_007_199_254_742_123n,
    3,
    4,
    512n,
    9_007_199_254_742_500n,
    9_007_199_254_742_600n,
    2_048n,
    1_024n,
    1_088n,
    chunkCompression,
    0,
    1,
    0,
    21,
    5,
    6,
    chunkHash,
    true,
  );
  const chunks = IoStoreAnalysisResponse.createChunksVector(builder, [chunk]);

  const blockCompression = builder.createString('Oodle');
  const compressedBlock = IoStoreCompressedBlockEntry.createIoStoreCompressedBlockEntry(
    builder,
    0,
    12,
    0,
    9_007_199_254_742_700n,
    9_007_199_254_742_800n,
    512,
    544,
    1024,
    blockCompression,
  );
  const compressedBlocks = IoStoreAnalysisResponse.createCompressedBlocksVector(builder, [compressedBlock]);

  const issue = createIssue(builder, IssueSeverity.Error, 'UPI_IOSTORE_DIRECTORY_INDEX_MISSING', 'Directory index is unavailable.');
  const issues = IoStoreAnalysisResponse.createIssuesVector(builder, [issue]);
  IoStoreAnalysisResponse.startIoStoreAnalysisResponse(builder);
  IoStoreAnalysisResponse.addSchemaVersion(builder, 9);
  IoStoreAnalysisResponse.addStatus(builder, ResponseStatus.Error);
  IoStoreAnalysisResponse.addIssues(builder, issues);
  IoStoreAnalysisResponse.addOverview(builder, overview);
  IoStoreAnalysisResponse.addPartitions(builder, partitions);
  IoStoreAnalysisResponse.addPackages(builder, packages);
  IoStoreAnalysisResponse.addChunks(builder, chunks);
  IoStoreAnalysisResponse.addCompressedBlocks(builder, compressedBlocks);
  const root = IoStoreAnalysisResponse.endIoStoreAnalysisResponse(builder);
  return finishBuilder(builder, root, IoStoreAnalysisResponse.finishIoStoreAnalysisResponseBuffer);
}

test('decodes backend info response fields and issues', () => {
  const response = decodeBackendInfoResponse(Buffer.from(createBackendInfoBuffer()));

  assert.equal(response.schemaVersion, 7);
  assert.equal(response.status, ResponseStatus.Error);
  assert.equal(response.backendName, 'UnrealPackageInsightBackend');
  assert.equal(response.backendVersion, '1.2.3');
  assert.equal(response.unrealVersion, '5.4.4');
  assert.equal(response.protocolVersion, 11);
  assert.deepEqual(response.issues, [
    {
      severity: IssueSeverity.Warning,
      code: 'UPI_BACKEND_VERSION_MISMATCH',
      message: 'Backend protocol version is newer than expected.',
    },
  ]);
});

test('rejects invalid response identifiers', () => {
  assert.throws(() => decodeBackendInfoResponse(corruptIdentifier(createBackendInfoBuffer())), /UPBI/);
  assert.throws(() => decodePakAnalysisResponse(corruptIdentifier(createPakAnalysisBuffer())), /UPPA/);
  assert.throws(() => decodeIoStoreAnalysisResponse(corruptIdentifier(createIoStoreAnalysisBuffer())), /UPIO/);
});

test('decodes pak analysis response fields with 64-bit values as bigint', () => {
  const response = decodePakAnalysisResponse(createPakAnalysisBuffer());

  assert.equal(response.schemaVersion, 8);
  assert.equal(response.status, ResponseStatus.Ok);
  assert.deepEqual(response.issues[0], {
    severity: IssueSeverity.Info,
    code: 'UPI_PAK_PARTIAL_LISTING',
    message: 'Listing is partial.',
  });
  assert.deepEqual(response.overview, {
    pakPath: 'C:/Game/Content/Paks/game.pak',
    mountPoint: '../../../Game/',
    pakVersion: 12,
    pakSize: 9_007_199_254_740_993n,
    indexEncrypted: true,
    encryptionKeyGuid: '00000000-0000-0000-0000-000000000001',
    hasFullDirectoryIndex: true,
    partialListing: false,
    packageCount: 1,
    compressedBlockCount: 1,
  });
  assert.equal(typeof response.overview.pakSize, 'bigint');
  assert.deepEqual(response.packages[0], {
    packagePath: '../../../Game/Maps/Arena.umap',
    mountPoint: '../../../Game/',
    offset: 9_007_199_254_740_995n,
    payloadOffset: 9_007_199_254_741_111n,
    size: 123_456_789_012_345n,
    compressedSize: 98_765_432_101n,
    recordSize: 256n,
    compression: 'Oodle',
    compressionMethodIndex: 2,
    compressionBlockSize: 65_536,
    compressionBlockCount: 1,
    firstCompressedBlockIndex: 0,
    relativeBlockOffsets: true,
    order: 42,
    flags: 7,
    hash: '0123456789abcdef',
    hasPath: true,
  });
  assert.deepEqual(response.compressedBlocks[0], {
    packageIndex: 0,
    blockIndex: 0,
    compressedStart: 9_007_199_254_741_333n,
    compressedEnd: 9_007_199_254_741_999n,
    compressedSize: 666n,
    diskSize: 700n,
    physicalStart: 9_007_199_254_742_000n,
    physicalEnd: 9_007_199_254_742_700n,
  });
});

test('decodes iostore analysis response fields with 64-bit values as bigint', () => {
  const raw = createIoStoreAnalysisBuffer();
  const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const response = decodeIoStoreAnalysisResponse(arrayBuffer);

  assert.equal(response.schemaVersion, 9);
  assert.equal(response.status, ResponseStatus.Error);
  assert.deepEqual(response.issues[0], {
    severity: IssueSeverity.Error,
    code: 'UPI_IOSTORE_DIRECTORY_INDEX_MISSING',
    message: 'Directory index is unavailable.',
  });
  assert.deepEqual(response.overview, {
    utocPath: 'C:/Game/Content/Paks/global.utoc',
    containerBasePath: 'C:/Game/Content/Paks/global',
    containerId: 18_446_744_073_709_551_615n,
    tocVersion: 5,
    tocEntryCount: 1,
    compressionBlockCount: 1,
    compressionBlockSize: 131_072,
    partitionCount: 1,
    partitionSize: 9_007_199_254_740_997n,
    containerFlags: 3,
    encryptionKeyGuid: '00000000-0000-0000-0000-000000000002',
    directoryIndexSize: 4096,
    indexed: true,
    partialListing: false,
  });
  assert.equal(typeof response.overview.containerId, 'bigint');
  assert.deepEqual(response.partitions[0], {
    partitionIndex: 0,
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
    size: 9_007_199_254_741_777n,
  });
  assert.deepEqual(response.packages[0], {
    packagePath: '/Game/Characters/Hero',
    packageId: 9_007_199_254_742_123n,
    firstChunkIndex: 0,
    chunkCount: 1,
    firstPartitionIndex: 0,
    firstOffset: 9_007_199_254_742_222n,
    size: 2_048n,
    compressedSize: 1_024n,
    diskSize: 1_088n,
    order: 9,
    hasPath: true,
  });
  assert.deepEqual(response.chunks[0], {
    packageIndex: 0,
    packagePath: '/Game/Characters/Hero',
    tocEntryIndex: 12,
    chunkId: 'ABCDEF0123456789',
    chunkType: 'ExportBundleData',
    packageId: 9_007_199_254_742_123n,
    chunkIndex: 3,
    bulkDataCookedIndex: 4,
    logicalOffset: 512n,
    offset: 9_007_199_254_742_500n,
    ucasOffset: 9_007_199_254_742_600n,
    size: 2_048n,
    compressedSize: 1_024n,
    diskSize: 1_088n,
    compression: 'Oodle',
    firstBlockIndex: 0,
    blockCount: 1,
    partitionIndex: 0,
    order: 21,
    metaFlags: 5,
    containerFlags: 6,
    hash: 'fedcba9876543210',
    hasPath: true,
  });
  assert.deepEqual(response.compressedBlocks[0], {
    blockIndex: 0,
    ownerTocEntryIndex: 12,
    partitionIndex: 0,
    offset: 9_007_199_254_742_700n,
    ucasOffset: 9_007_199_254_742_800n,
    compressedSize: 512,
    diskSize: 544,
    uncompressedSize: 1024,
    compression: 'Oodle',
  });
});

test('matches issue codes exactly and by suffix', () => {
  const response = {
    issues: [
      { code: 'UPI_BACKEND_VERSION_MISMATCH' },
      { code: 'UPI_IOSTORE_DIRECTORY_INDEX_MISSING' },
    ],
  };

  assert.equal(hasIssueCode(response, 'UPI_BACKEND_VERSION_MISMATCH'), true);
  assert.equal(hasIssueCode(response, 'DIRECTORY_INDEX_MISSING'), true);
  assert.equal(hasIssueCode(response, 'UPI_PAK_PARTIAL_LISTING'), false);
});
