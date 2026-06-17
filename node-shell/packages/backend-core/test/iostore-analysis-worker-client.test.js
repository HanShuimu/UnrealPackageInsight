const assert = require('node:assert/strict');
const test = require('node:test');

const flatbuffers = require('flatbuffers');

const {
  DEFAULT_WORKER_MAX_BUFFER,
  DEFAULT_WORKER_TIMEOUT_MS,
} = require('../src/pak-analysis-worker-client.js');
const {
  analyzeIoStoreInWorker,
  WORKER_RESULT_PREFIX,
} = require('../src/iostore-analysis-worker-client.js');
const {
  IoStoreAnalysisResponse,
  IoStoreOverview,
  IoStorePartition,
  ResponseStatus,
} = require('../../protocol/generated/js/upi/v1.js');

function createIoStoreAnalysisBuffer({ utocPath, ucasPath }) {
  const builder = new flatbuffers.Builder(512);
  const utocPathOffset = builder.createString(utocPath);
  const basePathOffset = builder.createString('C:/Game/Content/Paks/global');
  const encryptionKeyGuidOffset = builder.createString('');
  const overview = IoStoreOverview.createIoStoreOverview(
    builder,
    utocPathOffset,
    basePathOffset,
    123n,
    5,
    1,
    0,
    0,
    1,
    456n,
    0,
    encryptionKeyGuidOffset,
    0,
    true,
    false,
  );

  const ucasPathOffset = builder.createString(ucasPath);
  const partition = IoStorePartition.createIoStorePartition(builder, 0, ucasPathOffset, 456n);
  const partitions = IoStoreAnalysisResponse.createPartitionsVector(builder, [partition]);
  const issues = IoStoreAnalysisResponse.createIssuesVector(builder, []);
  const packages = IoStoreAnalysisResponse.createPackagesVector(builder, []);
  const chunks = IoStoreAnalysisResponse.createChunksVector(builder, []);
  const compressedBlocks = IoStoreAnalysisResponse.createCompressedBlocksVector(builder, []);

  IoStoreAnalysisResponse.startIoStoreAnalysisResponse(builder);
  IoStoreAnalysisResponse.addSchemaVersion(builder, 1);
  IoStoreAnalysisResponse.addStatus(builder, ResponseStatus.Ok);
  IoStoreAnalysisResponse.addIssues(builder, issues);
  IoStoreAnalysisResponse.addOverview(builder, overview);
  IoStoreAnalysisResponse.addPartitions(builder, partitions);
  IoStoreAnalysisResponse.addPackages(builder, packages);
  IoStoreAnalysisResponse.addChunks(builder, chunks);
  IoStoreAnalysisResponse.addCompressedBlocks(builder, compressedBlocks);
  const response = IoStoreAnalysisResponse.endIoStoreAnalysisResponse(builder);
  IoStoreAnalysisResponse.finishIoStoreAnalysisResponseBuffer(builder, response);
  return Buffer.from(builder.asUint8Array());
}

test('analyzeIoStoreInWorker sends AES key through stdin and decodes a worker result', () => {
  const aesKey = 'super-secret-aes-key';
  const rawResponse = createIoStoreAnalysisBuffer({
    utocPath: 'C:/Game/Content/Paks/global.utoc',
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
  });
  const spawnCalls = [];

  const response = analyzeIoStoreInWorker({
    dllPath: 'backend.dll',
    utocPath: 'C:/Game/Content/Paks/global.utoc',
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
    aesKey,
    nodePath: 'node.exe',
    workerPath: 'worker.js',
    spawnSync(command, args, options) {
      spawnCalls.push({ command, args, options });
      return {
        status: 0,
        signal: null,
        stdout: `${WORKER_RESULT_PREFIX}${JSON.stringify({
          ok: true,
          buffer: rawResponse.toString('base64'),
        })}\n`,
        stderr: '',
      };
    },
  });

  assert.equal(response.status, ResponseStatus.Ok);
  assert.equal(response.overview.utocPath, 'C:/Game/Content/Paks/global.utoc');
  assert.equal(response.partitions[0].ucasPath, 'C:/Game/Content/Paks/global.ucas');

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, 'node.exe');
  assert.deepEqual(spawnCalls[0].args, ['worker.js']);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /super-secret-aes-key/);
  assert.equal(spawnCalls[0].options.encoding, 'utf8');
  assert.equal(spawnCalls[0].options.timeout, DEFAULT_WORKER_TIMEOUT_MS);
  assert.equal(spawnCalls[0].options.maxBuffer, DEFAULT_WORKER_MAX_BUFFER);
  assert.equal(spawnCalls[0].options.windowsHide, true);

  assert.deepEqual(JSON.parse(spawnCalls[0].options.input), {
    dllPath: 'backend.dll',
    utocPath: 'C:/Game/Content/Paks/global.utoc',
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
    aesKey,
  });
});

test('analyzeIoStoreInWorker returns a legal error response when the worker fails', () => {
  const response = analyzeIoStoreInWorker({
    dllPath: 'backend.dll',
    utocPath: 'C:/Game/Content/Paks/global.utoc',
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
    nodePath: 'node.exe',
    workerPath: 'worker.js',
    spawnSync() {
      return {
        status: 777006,
        signal: null,
        stdout: '',
        stderr: 'native assert',
      };
    },
  });

  assert.equal(response.status, ResponseStatus.Error);
  assert.equal(response.overview.utocPath, 'C:/Game/Content/Paks/global.utoc');
  assert.equal(response.overview.containerBasePath, 'C:/Game/Content/Paks/global');
  assert.deepEqual(response.partitions, [{
    partitionIndex: 0,
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
    size: 0n,
  }]);
  assert.deepEqual(response.packages, []);
  assert.deepEqual(response.chunks, []);
  assert.deepEqual(response.compressedBlocks, []);
  assert.equal(response.issues[0].severity, 2);
  assert.equal(response.issues[0].code, 'iostore.worker_failed');
  assert.match(response.issues[0].message, /777006/);
});

test('analyzeIoStoreInWorker returns a legal error response for protocol errors', () => {
  const response = analyzeIoStoreInWorker({
    dllPath: 'backend.dll',
    utocPath: 'C:/Game/Content/Paks/global.utoc',
    ucasPath: 'C:/Game/Content/Paks/global.ucas',
    nodePath: 'node.exe',
    workerPath: 'worker.js',
    spawnSync() {
      return {
        status: 0,
        signal: null,
        stdout: 'worker log without result marker\n',
        stderr: '',
      };
    },
  });

  assert.equal(response.status, ResponseStatus.Error);
  assert.equal(response.overview.utocPath, 'C:/Game/Content/Paks/global.utoc');
  assert.equal(response.partitions[0].ucasPath, 'C:/Game/Content/Paks/global.ucas');
  assert.equal(response.issues[0].code, 'iostore.worker_protocol_error');
});

test('analyzeIoStoreInWorker reports timeout distinctly', () => {
  const response = analyzeIoStoreInWorker({
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    nodePath: 'node.exe',
    workerPath: 'worker.js',
    timeoutMs: 1234,
    maxBuffer: 5678,
    spawnSync(command, args, options) {
      assert.equal(options.timeout, 1234);
      assert.equal(options.maxBuffer, 5678);
      return {
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('spawnSync node.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      };
    },
  });

  assert.equal(response.status, ResponseStatus.Error);
  assert.equal(response.issues[0].code, 'iostore.worker_timeout');
  assert.match(response.issues[0].message, /timed out/i);
});
