# Container Extract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Extract to...` for `.pak`, `.utoc`, and `.ucas` containers so the GUI extracts the currently analyzed container to a user-selected directory.

**Architecture:** Add one shared extract response schema and push extraction through the existing Electron main, analysis-domain, backend-core worker, and native DLL layers. Pak extraction must call the engine UnrealPak command path with `-ExtractToMountPoint`; IoStore extraction must call `ExtractFilesFromIoStoreContainer(...)`; UPI must not add custom mount point path rewriting.

**Tech Stack:** Unreal Engine C++ Program DLL, PakFileUtilities, IoStoreUtilities, FlatBuffers 24.3.25, Node.js worker processes, Electron IPC, React 19, TypeScript, Zustand, Ant Design 6, Vitest, node:test.

---

## Design Source

Use `docs/superpowers/specs/2026-06-23-container-extract-design.md` as the contract. The user-approved implementation constraints are:

- The Packages tab gets `Extract to...`.
- The action extracts the currently selected analyzed container, not a selected package row.
- Pak extraction directly reuses UnrealPak/PakFileUtilities command behavior with `-ExtractToMountPoint`.
- IoStore extraction directly reuses `ExtractFilesFromIoStoreContainer(...)`.
- UPI does not implement its own mount point normalization or path rewrite rules.
- AES keys flow through the existing AES session and worker stdin, not command-line arguments in JS worker processes.
- Native backend, protocol files, generated files, JS bindings, renderer tests, and a fresh Electron smoke test must all be updated.

## File Structure

- Create `node-shell/packages/protocol/upi_extract_response.fbs`: FlatBuffer root response for extraction results.
- Modify `scripts/generate-protocol.js`: include the extract schema and barrel exports.
- Modify `node-shell/packages/protocol/test/generated-protocol.test.js`: assert generated extract modules exist and are exported.
- Create `node-shell/packages/protocol/src/extract-response-decoder.js`: decode `ExtractResponse` into plain JS.
- Create `node-shell/packages/protocol/test/extract-response-decoder.test.js`: regression tests for the decoder.
- Modify generated protocol files under `node-shell/packages/protocol/generated/**` and `ue-backend/.../Generated/Protocol/**` by running the protocol generator.
- Modify `node-shell/packages/backend-core/src/backend-library.js`: load `UPI_ExtractPakV1` and `UPI_ExtractIoStoreV1`.
- Modify `node-shell/packages/backend-core/src/backend-client.js`: add `extractPak` and `extractIoStore`.
- Create `node-shell/packages/backend-core/src/pak-extract-worker.js`: run the native Pak extract export in a worker.
- Create `node-shell/packages/backend-core/src/iostore-extract-worker.js`: run the native IoStore extract export in a worker.
- Create `node-shell/packages/backend-core/src/extract-worker-client.js`: shared worker spawn, timeout, payload, parse, and error response helpers for extract workers.
- Create `node-shell/packages/backend-core/test/extract-worker-client.test.js`: worker payload and error response tests.
- Modify `node-shell/packages/backend-core/test/backend-client.test.js`: assert extract methods delegate to workers.
- Modify `node-shell/packages/analysis-domain/src/analysis-service.js`: add `extract(filePath, outputDirectory)` dispatch.
- Modify `node-shell/packages/analysis-domain/test/analysis-service.test.js`: add Pak, IoStore, unsupported, pair-missing, and unavailable extract tests.
- Modify `node-shell/apps/desktop/main.js`: add directory picker plus `analysis:extractSelectedContainer` handler.
- Modify `node-shell/apps/desktop/preload.js`: expose `extractSelectedContainer(filePath)`.
- Modify `node-shell/apps/desktop/test/main-ipc.test.js`: add cancel, success, and package-not-open extract IPC tests.
- Modify `node-shell/apps/desktop/renderer-src/src/types/upi.ts`: add `ExtractResult` and `UpiClient.extractSelectedContainer`.
- Modify `node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts`: add preload extract method.
- Modify `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`: add extract state and action.
- Modify `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`: add extract status and stale result tests.
- Modify `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`: add `Extract to...` button to the Packages top row.
- Modify `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`: assert button state and callback.
- Modify `node-shell/apps/desktop/renderer-src/src/App.tsx`: wire store extract action into `AnalysisTabs` and busy state.
- Modify `node-shell/apps/desktop/renderer-src/src/App.test.tsx`: assert extract props are passed through.
- Modify `node-shell/apps/desktop/renderer-src/src/styles.css`: align the package mode row with the new action button.
- Modify `node-shell/apps/desktop/test/electron-gui-smoke.test.js`: assert `Extract to...` renders and `window.upi.extractSelectedContainer` exists.
- Create `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/ContainerExtractor.h`: extract result structs and native extract function declarations.
- Create `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/ContainerExtractor.cpp`: Pak and IoStore extract implementation.
- Modify `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Public/UnrealPackageInsightBackend.h`: export extract ABI functions.
- Modify `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UnrealPackageInsightBackend.cpp`: bridge UTF-8 arguments to native extract functions.
- Modify `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.h`: declare extract response builder.
- Modify `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.cpp`: build `ExtractResponse` and issue messages.
- Modify `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`: add `PakFileUtilities`, `IoStoreUtilities`, and `Json` dependencies.

## Common Commands

- Run protocol generation:

```powershell
npm.cmd --prefix node-shell run generate-protocol
```

- Run backend-core tests:

```powershell
npm.cmd --prefix node-shell exec -- node --test "packages/backend-core/test/*.test.js"
```

- Run analysis-domain tests:

```powershell
npm.cmd --prefix node-shell exec -- node --test "packages/analysis-domain/test/*.test.js"
```

- Run desktop main IPC tests:

```powershell
npm.cmd --prefix node-shell exec -- node --test "apps/desktop/test/main-ipc.test.js"
```

- Run one renderer test file:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
```

- Run native backend build workflow after C++ changes:

```powershell
npm.cmd run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

- Run all node-shell tests:

```powershell
npm.cmd --prefix node-shell test
```

- Run Electron GUI smoke:

```powershell
npm.cmd --prefix node-shell run build:renderer
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

## Task 1: Extract Protocol Schema And Decoder

**Files:**
- Create: `node-shell/packages/protocol/upi_extract_response.fbs`
- Create: `node-shell/packages/protocol/src/extract-response-decoder.js`
- Create: `node-shell/packages/protocol/test/extract-response-decoder.test.js`
- Modify: `scripts/generate-protocol.js`
- Modify: `node-shell/packages/protocol/test/generated-protocol.test.js`

- [ ] **Step 1: Write the failing generated-protocol test**

In `node-shell/packages/protocol/test/generated-protocol.test.js`, add the extract generated files to the expected lists:

```js
const expectedCppFiles = [
  path.join(programCppGeneratedRoot, 'upi_backend_info_generated.h'),
  path.join(programCppGeneratedRoot, 'upi_common_generated.h'),
  path.join(programCppGeneratedRoot, 'upi_pak_analysis_generated.h'),
  path.join(programCppGeneratedRoot, 'upi_iostore_analysis_generated.h'),
  path.join(programCppGeneratedRoot, 'upi_extract_response_generated.h'),
];
const expectedJsFiles = [
  path.join(generatedRoot, 'js', 'upi', 'v1.js'),
  path.join(generatedRoot, 'js', 'upi', 'v1', 'backend-info-response.js'),
  path.join(generatedRoot, 'js', 'upi', 'v1', 'pak-analysis-response.js'),
  path.join(generatedRoot, 'js', 'upi', 'v1', 'io-store-analysis-response.js'),
  path.join(generatedRoot, 'js', 'upi', 'v1', 'extract-response.js'),
];
const expectedTsFiles = [
  path.join(generatedRoot, 'ts', 'upi', 'v1.ts'),
  path.join(generatedRoot, 'ts', 'upi', 'v1', 'backend-info-response.ts'),
  path.join(generatedRoot, 'ts', 'upi', 'v1', 'pak-analysis-response.ts'),
  path.join(generatedRoot, 'ts', 'upi', 'v1', 'io-store-analysis-response.ts'),
  path.join(generatedRoot, 'ts', 'upi', 'v1', 'extract-response.ts'),
];
```

In the `rootModules` array, add:

```js
{
  name: 'ExtractResponse',
  directModule: require('../generated/js/upi/v1/extract-response.js'),
  lowerCamelAccessors: ['outputDirectory', 'extractedFileCount'],
},
```

- [ ] **Step 2: Run the generated-protocol test and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/protocol/test/generated-protocol.test.js
```

Expected: FAIL with a missing generated file or module for `extract-response`.

- [ ] **Step 3: Add the extract schema**

Create `node-shell/packages/protocol/upi_extract_response.fbs`:

```fbs
include "upi_common.fbs";

namespace upi.v1;

table ExtractResponse {
  schema_version: uint;
  status: ResponseStatus;
  issues: [Issue];
  container_path: string;
  output_directory: string;
  extracted_file_count: uint;
  error_count: uint;
}

root_type ExtractResponse;
file_identifier "UPEX";
```

- [ ] **Step 4: Update protocol generation inputs**

In `scripts/generate-protocol.js`, add `upi_extract_response.fbs` to `SCHEMAS` after `upi_iostore_analysis.fbs`:

```js
const SCHEMAS = [
  'upi_common.fbs',
  'upi_backend_info.fbs',
  'upi_pak_analysis.fbs',
  'upi_iostore_analysis.fbs',
  'upi_extract_response.fbs',
];
```

Add these TypeScript barrel exports before `ResponseStatus`:

```js
"export { ExtractResponse } from './v1/extract-response.js';",
```

- [ ] **Step 5: Run protocol generation**

Run:

```powershell
npm.cmd --prefix node-shell run generate-protocol
```

Expected: exits `0` and prints `[OK] Generated FlatBuffers bindings...`.

- [ ] **Step 6: Write the failing decoder test**

Create `node-shell/packages/protocol/test/extract-response-decoder.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const flatbuffers = require('flatbuffers');

const {
  ExtractResponse,
  Issue,
  IssueSeverity,
  ResponseStatus,
} = require('../generated/js/upi/v1.js');
const { decodeExtractResponse } = require('../src/extract-response-decoder.js');

function buildExtractResponse() {
  const builder = new flatbuffers.Builder(256);
  const code = builder.createString('extract.failed');
  const message = builder.createString('Extraction failed.');
  const issue = Issue.createIssue(builder, IssueSeverity.Error, code, message);
  const issues = ExtractResponse.createIssuesVector(builder, [issue]);
  const containerPath = builder.createString('C:\\Paks\\A.pak');
  const outputDirectory = builder.createString('D:\\Extracted');

  ExtractResponse.startExtractResponse(builder);
  ExtractResponse.addSchemaVersion(builder, 1);
  ExtractResponse.addStatus(builder, ResponseStatus.Error);
  ExtractResponse.addIssues(builder, issues);
  ExtractResponse.addContainerPath(builder, containerPath);
  ExtractResponse.addOutputDirectory(builder, outputDirectory);
  ExtractResponse.addExtractedFileCount(builder, 3);
  ExtractResponse.addErrorCount(builder, 1);
  const response = ExtractResponse.endExtractResponse(builder);
  ExtractResponse.finishExtractResponseBuffer(builder, response);
  return Buffer.from(builder.asUint8Array());
}

test('decodeExtractResponse decodes status, paths, counts, and issues', () => {
  assert.deepEqual(decodeExtractResponse(buildExtractResponse()), {
    schemaVersion: 1,
    status: ResponseStatus.Error,
    issues: [{
      severity: IssueSeverity.Error,
      code: 'extract.failed',
      message: 'Extraction failed.',
    }],
    containerPath: 'C:\\Paks\\A.pak',
    outputDirectory: 'D:\\Extracted',
    extractedFileCount: 3,
    errorCount: 1,
  });
});

test('decodeExtractResponse rejects buffers with the wrong identifier', () => {
  assert.throws(
    () => decodeExtractResponse(Buffer.from([0, 1, 2, 3])),
    /Invalid ExtractResponse identifier/,
  );
});
```

- [ ] **Step 7: Run the decoder test and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/protocol/test/extract-response-decoder.test.js
```

Expected: FAIL because `node-shell/packages/protocol/src/extract-response-decoder.js` does not exist.

- [ ] **Step 8: Implement the decoder**

Create `node-shell/packages/protocol/src/extract-response-decoder.js`:

```js
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
```

- [ ] **Step 9: Run protocol tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/protocol/test/generated-protocol.test.js packages/protocol/test/extract-response-decoder.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- scripts/generate-protocol.js node-shell/packages/protocol/upi_extract_response.fbs node-shell/packages/protocol/src/extract-response-decoder.js node-shell/packages/protocol/test/extract-response-decoder.test.js node-shell/packages/protocol/test/generated-protocol.test.js node-shell/packages/protocol/generated ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol
git commit -m "Add extract response protocol"
```

## Task 2: Backend-Core Extract Workers And Client

**Files:**
- Create: `node-shell/packages/backend-core/src/extract-worker-client.js`
- Create: `node-shell/packages/backend-core/src/pak-extract-worker.js`
- Create: `node-shell/packages/backend-core/src/iostore-extract-worker.js`
- Create: `node-shell/packages/backend-core/test/extract-worker-client.test.js`
- Modify: `node-shell/packages/backend-core/src/backend-library.js`
- Modify: `node-shell/packages/backend-core/src/backend-client.js`
- Modify: `node-shell/packages/backend-core/test/backend-client.test.js`

- [ ] **Step 1: Write failing backend client delegation tests**

In `node-shell/packages/backend-core/test/backend-client.test.js`, update `createFakeKoffi().load().func(signature)` to reject in-process extract exports:

```js
if (signature === 'int UPI_ExtractPakV1(str, str, str, void*, int, void*)') {
  return () => {
    throw new Error('Parent process must not run Pak extraction in-process');
  };
}

if (signature === 'int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)') {
  return () => {
    throw new Error('Parent process must not run IoStore extraction in-process');
  };
}
```

Add tests:

```js
test('createBackendClient delegates Pak extraction to the worker process', () => {
  const workerCalls = [];
  const expectedResponse = {
    status: 0,
    issues: [],
    containerPath: 'A.pak',
    outputDirectory: 'D:\\Out',
  };
  const client = createBackendClient({
    dllPath: 'backend.dll',
    koffi: createFakeKoffi(),
    platform: 'linux',
    runPakExtractWorker(request) {
      workerCalls.push(request);
      return expectedResponse;
    },
  });

  const response = client.extractPak({
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  });

  assert.equal(response, expectedResponse);
  assert.deepEqual(workerCalls, [{
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  }]);
});

test('createBackendClient delegates IoStore extraction to the worker process', () => {
  const workerCalls = [];
  const expectedResponse = {
    status: 0,
    issues: [],
    containerPath: 'global.utoc',
    outputDirectory: 'D:\\Out',
  };
  const client = createBackendClient({
    dllPath: 'backend.dll',
    koffi: createFakeKoffi(),
    platform: 'linux',
    runIoStoreExtractWorker(request) {
      workerCalls.push(request);
      return expectedResponse;
    },
  });

  const response = client.extractIoStore({
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  });

  assert.equal(response, expectedResponse);
  assert.deepEqual(workerCalls, [{
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  }]);
});
```

- [ ] **Step 2: Run backend client tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/backend-core/test/backend-client.test.js
```

Expected: FAIL because `extractPak` and `extractIoStore` do not exist.

- [ ] **Step 3: Write failing worker client tests**

Create `node-shell/packages/backend-core/test/extract-worker-client.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_EXTRACT_WORKER_MAX_BUFFER,
  DEFAULT_EXTRACT_WORKER_TIMEOUT_MS,
  PAK_EXTRACT_RESULT_PREFIX,
  IOSTORE_EXTRACT_RESULT_PREFIX,
  runExtractWorker,
  serializePakExtractPayload,
  serializeIoStoreExtractPayload,
  parseExtractWorkerResult,
} = require('../src/extract-worker-client.js');

test('serializePakExtractPayload keeps AES keys in stdin payload only', () => {
  assert.deepEqual(JSON.parse(serializePakExtractPayload({
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  })), {
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  });
});

test('serializeIoStoreExtractPayload keeps AES keys in stdin payload only', () => {
  assert.deepEqual(JSON.parse(serializeIoStoreExtractPayload({
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  })), {
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  });
});

test('runExtractWorker passes payload on stdin and reports worker failures', () => {
  const calls = [];
  const response = runExtractWorker({
    kind: 'pak',
    resultPrefix: PAK_EXTRACT_RESULT_PREFIX,
    workerPath: 'worker.js',
    nodePath: 'node.exe',
    payload: { dllPath: 'backend.dll', pakPath: 'A.pak', outputDirectory: 'D:\\Out', aesKey: 'secret' },
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 9, signal: null, stdout: '', stderr: '' };
    },
  });

  assert.equal(response.status, 1);
  assert.equal(response.containerPath, 'A.pak');
  assert.equal(response.outputDirectory, 'D:\\Out');
  assert.equal(response.issues[0].code, 'pak.extract_worker_failed');
  assert.equal(calls[0].command, 'node.exe');
  assert.deepEqual(calls[0].args, ['worker.js']);
  assert.doesNotMatch(calls[0].args.join(' '), /secret/);
  assert.equal(calls[0].options.timeout, DEFAULT_EXTRACT_WORKER_TIMEOUT_MS);
  assert.equal(calls[0].options.maxBuffer, DEFAULT_EXTRACT_WORKER_MAX_BUFFER);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(JSON.parse(calls[0].options.input).aesKey, 'secret');
});

test('parseExtractWorkerResult returns decoded payloads and rejects malformed worker output', () => {
  const decoded = { status: 0, issues: [], containerPath: 'A.pak', outputDirectory: 'D:\\Out' };
  assert.deepEqual(parseExtractWorkerResult({
    kind: 'pak',
    resultPrefix: PAK_EXTRACT_RESULT_PREFIX,
    payload: { pakPath: 'A.pak', outputDirectory: 'D:\\Out' },
    stdout: `${PAK_EXTRACT_RESULT_PREFIX}${JSON.stringify({ ok: true, response: decoded })}\n`,
  }), decoded);

  const malformed = parseExtractWorkerResult({
    kind: 'iostore',
    resultPrefix: IOSTORE_EXTRACT_RESULT_PREFIX,
    payload: { utocPath: 'global.utoc', outputDirectory: 'D:\\Out' },
    stdout: '',
  });
  assert.equal(malformed.status, 1);
  assert.equal(malformed.issues[0].code, 'iostore.extract_worker_protocol_error');
});
```

- [ ] **Step 4: Run worker tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/backend-core/test/extract-worker-client.test.js
```

Expected: FAIL because `extract-worker-client.js` does not exist.

- [ ] **Step 5: Implement shared extract worker client**

Create `node-shell/packages/backend-core/src/extract-worker-client.js`:

```js
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { ResponseStatus, IssueSeverity } = require('../../protocol/generated/js/upi/v1.js');
const { createWorkerEnv } = require('./pak-analysis-worker-client.js');

const PAK_EXTRACT_RESULT_PREFIX = '__UPI_PAK_EXTRACT_RESULT__';
const IOSTORE_EXTRACT_RESULT_PREFIX = '__UPI_IOSTORE_EXTRACT_RESULT__';
const DEFAULT_EXTRACT_WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_EXTRACT_WORKER_MAX_BUFFER = 64 * 1024 * 1024;

function containerPathForPayload(kind, payload) {
  if (kind === 'iostore') {
    return payload.utocPath || payload.ucasPath || '';
  }
  return payload.pakPath || '';
}

function createExtractWorkerErrorResponse({ kind, payload, code, message }) {
  return {
    schemaVersion: 1,
    status: ResponseStatus.Error,
    issues: [{
      severity: IssueSeverity.Error,
      code,
      message,
    }],
    containerPath: containerPathForPayload(kind, payload || {}),
    outputDirectory: payload?.outputDirectory || '',
    extractedFileCount: 0,
    errorCount: 1,
  };
}

function serializePakExtractPayload({ dllPath, pakPath, outputDirectory, aesKey }) {
  return JSON.stringify({
    dllPath,
    pakPath,
    outputDirectory,
    aesKey: aesKey ?? '',
  });
}

function serializeIoStoreExtractPayload({ dllPath, utocPath, ucasPath, outputDirectory, aesKey }) {
  return JSON.stringify({
    dllPath,
    utocPath,
    ucasPath,
    outputDirectory,
    aesKey: aesKey ?? '',
  });
}

function defaultPakExtractWorkerPath() {
  return path.join(__dirname, 'pak-extract-worker.js');
}

function defaultIoStoreExtractWorkerPath() {
  return path.join(__dirname, 'iostore-extract-worker.js');
}

function workerExitDescription(result) {
  if (result.error) {
    return result.error.message;
  }
  if (result.signal) {
    return `signal ${result.signal}`;
  }
  return `exit code ${result.status}`;
}

function isWorkerTimeout(result) {
  return result && result.error && result.error.code === 'ETIMEDOUT';
}

function findWorkerResult(stdout, resultPrefix) {
  return String(stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith(resultPrefix));
}

function parseExtractWorkerResult({ kind, resultPrefix, payload, stdout }) {
  const resultLine = findWorkerResult(stdout, resultPrefix);
  if (!resultLine) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_protocol_error`,
      message: `${kind} extract worker exited without returning a response.`,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(resultLine.slice(resultPrefix.length));
  } catch (error) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_protocol_error`,
      message: `${kind} extract worker returned invalid JSON: ${error.message}`,
    });
  }

  if (!parsed || parsed.ok !== true || !parsed.response) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_failed`,
      message: parsed && parsed.error ? parsed.error : `${kind} extract worker failed.`,
    });
  }

  return parsed.response;
}

function runExtractWorker({
  kind,
  resultPrefix,
  payload,
  workerPath,
  nodePath = process.execPath,
  spawnSync: spawnSyncImpl = spawnSync,
  env = process.env,
  timeoutMs = DEFAULT_EXTRACT_WORKER_TIMEOUT_MS,
  maxBuffer = DEFAULT_EXTRACT_WORKER_MAX_BUFFER,
}) {
  const serialized = kind === 'iostore'
    ? serializeIoStoreExtractPayload(payload)
    : serializePakExtractPayload(payload);
  const result = spawnSyncImpl(nodePath, [workerPath], {
    encoding: 'utf8',
    env: createWorkerEnv(env),
    input: serialized,
    timeout: timeoutMs,
    maxBuffer,
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || result.signal) {
    if (isWorkerTimeout(result)) {
      return createExtractWorkerErrorResponse({
        kind,
        payload,
        code: `${kind}.extract_worker_timeout`,
        message: `${kind} extract worker timed out after ${timeoutMs} ms.`,
      });
    }

    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_failed`,
      message: `${kind} extract worker failed with ${workerExitDescription(result)}.`,
    });
  }

  return parseExtractWorkerResult({ kind, resultPrefix, payload, stdout: result.stdout });
}

function extractPakInWorker(options) {
  return runExtractWorker({
    kind: 'pak',
    resultPrefix: PAK_EXTRACT_RESULT_PREFIX,
    payload: {
      dllPath: options.dllPath,
      pakPath: options.pakPath,
      outputDirectory: options.outputDirectory,
      aesKey: options.aesKey ?? '',
    },
    workerPath: options.workerPath || defaultPakExtractWorkerPath(),
    nodePath: options.nodePath,
    spawnSync: options.spawnSync,
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxBuffer: options.maxBuffer,
  });
}

function extractIoStoreInWorker(options) {
  return runExtractWorker({
    kind: 'iostore',
    resultPrefix: IOSTORE_EXTRACT_RESULT_PREFIX,
    payload: {
      dllPath: options.dllPath,
      utocPath: options.utocPath,
      ucasPath: options.ucasPath,
      outputDirectory: options.outputDirectory,
      aesKey: options.aesKey ?? '',
    },
    workerPath: options.workerPath || defaultIoStoreExtractWorkerPath(),
    nodePath: options.nodePath,
    spawnSync: options.spawnSync,
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxBuffer: options.maxBuffer,
  });
}

module.exports = {
  DEFAULT_EXTRACT_WORKER_MAX_BUFFER,
  DEFAULT_EXTRACT_WORKER_TIMEOUT_MS,
  IOSTORE_EXTRACT_RESULT_PREFIX,
  PAK_EXTRACT_RESULT_PREFIX,
  createExtractWorkerErrorResponse,
  extractIoStoreInWorker,
  extractPakInWorker,
  parseExtractWorkerResult,
  runExtractWorker,
  serializeIoStoreExtractPayload,
  serializePakExtractPayload,
};
```

- [ ] **Step 6: Implement worker scripts**

Create `node-shell/packages/backend-core/src/pak-extract-worker.js`:

```js
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
```

Create `node-shell/packages/backend-core/src/iostore-extract-worker.js`:

```js
#!/usr/bin/env node

const fs = require('node:fs');

const koffi = require('koffi');

const { decodeExtractResponse } = require('../../protocol/src/extract-response-decoder.js');
const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { IOSTORE_EXTRACT_RESULT_PREFIX } = require('./extract-worker-client.js');

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
  process.stdout.write(`${IOSTORE_EXTRACT_RESULT_PREFIX}${JSON.stringify(payload)}\n`);
}

function main(input = readPayloadFromStdin()) {
  const payload = decodePayload(input);
  const library = loadBackendLibrary({ dllPath: payload.dllPath, koffi });
  const bytes = callBufferedExport({
    fn: library.extractIoStoreV1,
    koffi,
    args: [
      payload.utocPath || '',
      payload.ucasPath || '',
      payload.outputDirectory || '',
      payload.aesKey ?? '',
    ],
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
```

- [ ] **Step 7: Load extract exports**

In `node-shell/packages/backend-core/src/backend-library.js`, add return entries:

```js
extractPakV1: library.func('int UPI_ExtractPakV1(str, str, str, void*, int, void*)'),
extractIoStoreV1: library.func('int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)'),
```

- [ ] **Step 8: Add backend client extract methods**

In `node-shell/packages/backend-core/src/backend-client.js`, import:

```js
const {
  extractIoStoreInWorker,
  extractPakInWorker,
} = require('./extract-worker-client.js');
```

Add parameters to `createBackendClient`:

```js
runIoStoreExtractWorker = extractIoStoreInWorker,
runPakExtractWorker = extractPakInWorker,
```

Add methods to the returned client:

```js
extractPak({ pakPath, outputDirectory, aesKey = '' }) {
  return runPakExtractWorker({
    dllPath,
    pakPath,
    outputDirectory,
    aesKey: aesKey ?? '',
  });
},

extractIoStore({ utocPath, ucasPath, outputDirectory, aesKey = '' }) {
  return runIoStoreExtractWorker({
    dllPath,
    utocPath,
    ucasPath,
    outputDirectory,
    aesKey: aesKey ?? '',
  });
},
```

- [ ] **Step 9: Run backend-core tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/backend-core/test/backend-client.test.js packages/backend-core/test/extract-worker-client.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- node-shell/packages/backend-core/src/backend-library.js node-shell/packages/backend-core/src/backend-client.js node-shell/packages/backend-core/src/extract-worker-client.js node-shell/packages/backend-core/src/pak-extract-worker.js node-shell/packages/backend-core/src/iostore-extract-worker.js node-shell/packages/backend-core/test/backend-client.test.js node-shell/packages/backend-core/test/extract-worker-client.test.js
git commit -m "Add backend extract worker plumbing"
```

## Task 3: Analysis Domain Extract Dispatch

**Files:**
- Modify: `node-shell/packages/analysis-domain/src/analysis-service.js`
- Modify: `node-shell/packages/analysis-domain/test/analysis-service.test.js`

- [ ] **Step 1: Write failing analysis-domain extract tests**

In `node-shell/packages/analysis-domain/test/analysis-service.test.js`, extend `createBackendClient()`:

```js
const calls = {
  pak: [],
  iostore: [],
  extractPak: [],
  extractIoStore: [],
};
```

Add client methods:

```js
async extractPak(request) {
  calls.extractPak.push(request);
  return { status: 'OK', kind: 'extractPak', request };
},
async extractIoStore(request) {
  calls.extractIoStore.push(request);
  return { status: 'OK', kind: 'extractIoStore', request };
},
```

Add tests:

```js
test('extracts Pak selections with the session AES key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const { calls, client } = createBackendClient();
  const aesSession = new AesKeySession();
  aesSession.setKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAB');
  const service = new AnalysisService({ backendClient: client, filePaths: [pakPath], aesSession });

  const result = await service.extract(pakPath, 'D:\\Out');

  assert.equal(result.status, 'OK');
  assert.deepEqual(calls.extractPak, [{
    pakPath,
    outputDirectory: 'D:\\Out',
    aesKey: 'abcdefabcdefabcdefabcdefabcdefab',
  }]);
});

test('extracts IoStore selections with the resolved pair and session AES key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const utocPath = path.join(root, 'global.utoc');
  const ucasPath = path.join(root, 'global.ucas');
  createFile(utocPath, 'utoc');
  createFile(ucasPath, 'ucas');
  const { calls, client } = createBackendClient();
  const aesSession = new AesKeySession();
  aesSession.setKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAB');
  const service = new AnalysisService({ backendClient: client, filePaths: [utocPath, ucasPath], aesSession });

  const result = await service.extract(ucasPath, 'D:\\Out');

  assert.equal(result.status, 'OK');
  assert.deepEqual(calls.extractIoStore, [{
    utocPath,
    ucasPath,
    outputDirectory: 'D:\\Out',
    aesKey: 'abcdefabcdefabcdefabcdefabcdefab',
  }]);
});

test('extract returns iostore.pair_missing before calling backend for orphan .ucas selections', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ucasPath = path.join(root, 'global.ucas');
  createFile(ucasPath, 'ucas');
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: [ucasPath] });

  const result = await service.extract(ucasPath, 'D:\\Out');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'iostore.pair_missing',
      message: 'Selected IoStore file is missing its matching .utoc or .ucas file.',
    }],
  });
  assert.deepEqual(calls.extractIoStore, []);
});

test('extract returns container.unsupported for unsupported files', async () => {
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: [] });

  const result = await service.extract('C:\\Paks\\readme.txt', 'D:\\Out');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'container.unsupported',
      message: 'Unsupported container file type.',
    }],
  });
  assert.deepEqual(calls.extractPak, []);
  assert.deepEqual(calls.extractIoStore, []);
});

test('extract returns container.output_directory_required without calling backend', async () => {
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: ['C:\\Paks\\A.pak'] });

  const result = await service.extract('C:\\Paks\\A.pak', '');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'container.output_directory_required',
      message: 'Select an output directory before extracting.',
    }],
  });
  assert.deepEqual(calls.extractPak, []);
});
```

- [ ] **Step 2: Run analysis-domain tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/analysis-service.test.js
```

Expected: FAIL because `AnalysisService.extract` does not exist.

- [ ] **Step 3: Implement extract dispatch**

In `node-shell/packages/analysis-domain/src/analysis-service.js`, add:

```js
const OUTPUT_DIRECTORY_REQUIRED_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'container.output_directory_required',
    message: 'Select an output directory before extracting.',
  }],
};
```

Add this method to `AnalysisService`:

```js
async extract(filePath, outputDirectory) {
  if (!outputDirectory || String(outputDirectory).trim() === '') {
    return cloneErrorResponse(OUTPUT_DIRECTORY_REQUIRED_RESPONSE);
  }

  const kind = getContainerKind(filePath);
  if (kind === 'pak') {
    return this.extractPak(filePath, outputDirectory);
  }
  if (kind === 'utoc' || kind === 'ucas') {
    return this.extractIoStore(filePath, outputDirectory);
  }
  return cloneErrorResponse(UNSUPPORTED_CONTAINER_RESPONSE);
}

async extractPak(pakPath, outputDirectory) {
  try {
    await fileStamp(pakPath);
  } catch {
    return cloneErrorResponse(FILE_UNAVAILABLE_RESPONSE);
  }

  const aesKey = this.aesSession.getKey();
  const { client } = await this.resolveBackend(pakPath);
  return client.extractPak({ pakPath, outputDirectory, aesKey });
}

async extractIoStore(selectedPath, outputDirectory) {
  const selection = resolveIoStoreSelection(selectedPath, this.filePaths);
  if (!selection?.ok) {
    return {
      status: 'Error',
      issues: [{ ...selection.issue }],
    };
  }

  const { utocPath, ucasPath, ucasPaths } = selection;
  try {
    await Promise.all([utocPath, ...ucasPaths].map((containerPath) => fileStamp(containerPath)));
  } catch {
    return cloneErrorResponse(FILE_UNAVAILABLE_RESPONSE);
  }

  const aesKey = this.aesSession.getKey();
  const { client } = await this.resolveBackend(utocPath);
  return client.extractIoStore({ utocPath, ucasPath, outputDirectory, aesKey });
}
```

- [ ] **Step 4: Run analysis-domain tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/analysis-service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- node-shell/packages/analysis-domain/src/analysis-service.js node-shell/packages/analysis-domain/test/analysis-service.test.js
git commit -m "Add analysis extract dispatch"
```

## Task 4: Electron Main IPC And Preload API

**Files:**
- Modify: `node-shell/apps/desktop/main.js`
- Modify: `node-shell/apps/desktop/preload.js`
- Modify: `node-shell/apps/desktop/test/main-ipc.test.js`
- Modify: `node-shell/apps/desktop/renderer-src/src/types/upi.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts`

- [ ] **Step 1: Write failing Electron main IPC tests**

In `node-shell/apps/desktop/test/main-ipc.test.js`, add:

```js
test('analysis:extractSelectedContainer returns package.not_open before a package directory is opened', async () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({ state });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'package.not_open',
      message: 'Open a package directory before extracting files.',
    }],
  });
});

test('analysis:extractSelectedContainer returns null when output directory selection is canceled', async () => {
  const state = createDesktopState();
  state.analysisService = {
    async extract() {
      throw new Error('extract should not run');
    },
  };
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog() {
        return { canceled: true, filePaths: [] };
      },
    },
  });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak');

  assert.equal(result, null);
});

test('analysis:extractSelectedContainer chooses a directory and calls analysis service extract', async () => {
  const calls = [];
  const state = createDesktopState();
  state.analysisService = {
    async extract(filePath, outputDirectory) {
      calls.push({ filePath, outputDirectory });
      return {
        status: 'OK',
        issues: [],
        containerPath: filePath,
        outputDirectory,
        extractedFileCount: 0,
        errorCount: 0,
      };
    },
  };
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog(options) {
        assert.deepEqual(options, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Extract to...',
        });
        return { canceled: false, filePaths: ['D:\\Extracted'] };
      },
    },
  });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak');

  assert.deepEqual(calls, [{ filePath: 'C:\\Paks\\A.pak', outputDirectory: 'D:\\Extracted' }]);
  assert.deepEqual(result, {
    status: 'OK',
    issues: [],
    containerPath: 'C:\\Paks\\A.pak',
    outputDirectory: 'D:\\Extracted',
    extractedFileCount: 0,
    errorCount: 0,
  });
});
```

- [ ] **Step 2: Run IPC tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/main-ipc.test.js
```

Expected: FAIL because `extractSelectedContainer` is not defined.

- [ ] **Step 3: Implement main-process handler**

In `node-shell/apps/desktop/main.js`, add:

```js
const PACKAGE_NOT_OPEN_EXTRACT_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'package.not_open',
    message: 'Open a package directory before extracting files.',
  }],
};
```

Add handler inside `createIpcHandlers`:

```js
async extractSelectedContainer(filePath) {
  if (!state.analysisService) {
    return cloneResponse(PACKAGE_NOT_OPEN_EXTRACT_RESPONSE);
  }

  const selection = await dialogModule.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Extract to...',
  });

  if (selection.canceled || selection.filePaths.length === 0) {
    return null;
  }

  return state.analysisService.extract(filePath, selection.filePaths[0]);
},
```

Update `registerIpcHandlers`:

```js
ipcMainModule.handle('analysis:extractSelectedContainer', (_event, filePath) => (
  handlers.extractSelectedContainer(filePath)
));
```

Export `PACKAGE_NOT_OPEN_EXTRACT_RESPONSE` from `module.exports` if tests import it later.

- [ ] **Step 4: Expose preload API**

In `node-shell/apps/desktop/preload.js`, add:

```js
extractSelectedContainer(filePath) {
  return ipcRenderer.invoke('analysis:extractSelectedContainer', filePath);
},
```

- [ ] **Step 5: Update renderer types**

In `node-shell/apps/desktop/renderer-src/src/types/upi.ts`, add:

```ts
export type ExtractResult = {
  schemaVersion?: number;
  status?: IpcStatus;
  issues?: Issue[];
  containerPath?: string;
  outputDirectory?: string;
  extractedFileCount?: number;
  errorCount?: number;
};
```

Add to `UpiClient`:

```ts
extractSelectedContainer(filePath: string): Promise<ExtractResult | null>;
```

In `node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts`, add the same method to `window.upi`.

- [ ] **Step 6: Run IPC and typecheck tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/main-ipc.test.js
npm.cmd --prefix node-shell run typecheck:renderer
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- node-shell/apps/desktop/main.js node-shell/apps/desktop/preload.js node-shell/apps/desktop/test/main-ipc.test.js node-shell/apps/desktop/renderer-src/src/types/upi.ts node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts
git commit -m "Add desktop extract IPC"
```

## Task 5: Renderer Store And Packages Button

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/styles.css`

- [ ] **Step 1: Write failing store tests**

In `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`, update `createClient()` to include:

```ts
extractSelectedContainer: async (filePath) => ({
  status: 'OK',
  issues: [],
  containerPath: filePath,
  outputDirectory: 'D:\\Extracted',
  extractedFileCount: 0,
  errorCount: 0,
}),
```

Add tests:

```ts
test('extractSelectedContainer reports cancel without changing the analysis result', async () => {
  const store = createAppStore(
    createClient({
      extractSelectedContainer: async () => null,
    }),
  );
  await store.getState().analyzeFile('C:\\Paks\\A.pak');
  const before = store.getState().analysisResult;

  await store.getState().extractSelectedContainer();

  expect(store.getState().analysisResult).toBe(before);
  expect(store.getState().statusText).toBe('Extract canceled');
  expect(store.getState().isExtracting).toBe(false);
});

test('extractSelectedContainer keeps analysis data on success and reports completion', async () => {
  const store = createAppStore(createClient());
  await store.getState().analyzeFile('C:\\Paks\\A.pak');
  const before = store.getState().analysisResult;

  await store.getState().extractSelectedContainer();

  expect(store.getState().analysisResult).toBe(before);
  expect(store.getState().statusText).toBe('Extract complete');
  expect(store.getState().isExtracting).toBe(false);
});

test('extractSelectedContainer converts extract failures into visible issue results', async () => {
  const store = createAppStore(
    createClient({
      extractSelectedContainer: async () => ({
        status: 'Error',
        issues: [{ severity: 'error', code: 'extract.failed', message: 'Extraction failed.' }],
        containerPath: 'C:\\Paks\\A.pak',
        outputDirectory: 'D:\\Out',
        extractedFileCount: 0,
        errorCount: 1,
      }),
    }),
  );
  await store.getState().analyzeFile('C:\\Paks\\A.pak');

  await store.getState().extractSelectedContainer();

  expect(store.getState().statusText).toBe('Extract failed');
  expect(store.getState().analysisResult?.issues?.[0]?.code).toBe('extract.failed');
  expect(store.getState().isExtracting).toBe(false);
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: FAIL because `extractSelectedContainer` and `isExtracting` are missing.

- [ ] **Step 3: Implement store extract state**

In `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`, import `ExtractResult`.

Add to `AppState`:

```ts
isExtracting: boolean;
extractRequestId: number;
extractSelectedContainer(): Promise<void>;
```

Initialize:

```ts
isExtracting: false,
extractRequestId: 0,
```

Add helpers:

```ts
function isErrorStatus(status: unknown): boolean {
  return status === 'Error' || status === 1;
}

function createAnalysisResultFromExtract(result: ExtractResult): AnalysisResult {
  return {
    status: result.status,
    issues: Array.isArray(result.issues) ? result.issues : [],
  };
}
```

Add action:

```ts
async extractSelectedContainer() {
  const filePath = get().selectedFilePath;
  if (!filePath) {
    set({ statusText: 'Select a container first' });
    return;
  }

  const requestId = get().extractRequestId + 1;
  set({ extractRequestId: requestId, isExtracting: true, statusText: 'Extracting...' });

  try {
    const result = await client.extractSelectedContainer(filePath);
    if (get().extractRequestId !== requestId || get().selectedFilePath !== filePath) {
      return;
    }

    if (!result) {
      set({ statusText: 'Extract canceled' });
      return;
    }

    if (isErrorStatus(result.status)) {
      set({
        analysisResult: createAnalysisResultFromExtract(result),
        statusText: 'Extract failed',
      });
      return;
    }

    set({ statusText: 'Extract complete' });
  } catch (error) {
    if (get().extractRequestId !== requestId || get().selectedFilePath !== filePath) {
      return;
    }

    set({
      analysisResult: createErrorResult('renderer.extract_failed', error),
      statusText: 'Extract failed',
    });
  } finally {
    if (get().extractRequestId === requestId && get().selectedFilePath === filePath) {
      set({ isExtracting: false });
    }
  }
},
```

When `openDirectory()` starts or applies a new scan, increment `extractRequestId` and set `isExtracting: false` to invalidate stale extracts.

- [ ] **Step 4: Write failing AnalysisTabs button tests**

In `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`, update the `antd` mock to include:

```tsx
Button: ({
  children,
  disabled,
  loading,
  onClick,
}: {
  children?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?(): void;
}) => (
  <button
    data-loading={loading ? 'true' : 'false'}
    disabled={disabled}
    type="button"
    onClick={onClick}
  >
    {children}
  </button>
),
```

Update `renderTabs` to pass:

```tsx
selectedFilePath={options.selectedFilePath ?? 'C:\\Paks\\A.pak'}
isExtracting={options.isExtracting ?? false}
onExtractSelectedContainer={options.onExtractSelectedContainer ?? (() => {})}
```

Add tests:

```tsx
test('Packages tab renders Extract to button and invokes the extract callback', () => {
  const onExtractSelectedContainer = vi.fn();
  renderTabs(analysisResult(), { onExtractSelectedContainer });

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
  fireEvent.click(screen.getByRole('button', { name: 'Extract to...' }));

  expect(onExtractSelectedContainer).toHaveBeenCalledTimes(1);
});

test('Extract to button is disabled without a selected file or analysis result', () => {
  const { rerender } = renderTabs(null, { selectedFilePath: 'C:\\Paks\\A.pak' });

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
  expect(screen.getByRole('button', { name: 'Extract to...' })).toBeDisabled();

  rerender(
    <AnalysisTabs
      result={analysisResult()}
      selectedFilePath=""
      selectedPackageId=""
      tableHeight={500}
      isExtracting={false}
      onExtractSelectedContainer={() => {}}
      onDetailsSelectionChange={() => {}}
    />,
  );

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
  expect(screen.getByRole('button', { name: 'Extract to...' })).toBeDisabled();
});

test('Extract to button shows loading state while extraction is in progress', () => {
  renderTabs(analysisResult(), { isExtracting: true });

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));

  expect(screen.getByRole('button', { name: 'Extract to...' })).toHaveAttribute('data-loading', 'true');
  expect(screen.getByRole('button', { name: 'Extract to...' })).toBeDisabled();
});
```

- [ ] **Step 5: Run AnalysisTabs tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
```

Expected: FAIL because the new props and button do not exist.

- [ ] **Step 6: Implement AnalysisTabs button**

In `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`, import `Button`:

```ts
import { Button, Empty, Segmented, Table, Tabs, Typography } from 'antd';
```

Extend `AnalysisTabsProps`:

```ts
selectedFilePath: string;
isExtracting: boolean;
onExtractSelectedContainer(): void;
```

Extend `PackagePaneProps`:

```ts
canExtract: boolean;
isExtracting: boolean;
onExtractSelectedContainer(): void;
```

Render the row:

```tsx
<div className="package-mode-row">
  <Segmented<PackageMode>
    options={PACKAGE_MODE_OPTIONS}
    value={mode}
    onChange={onModeChange}
  />
  <Button
    disabled={!canExtract || isExtracting}
    loading={isExtracting}
    onClick={onExtractSelectedContainer}
  >
    Extract to...
  </Button>
</div>
```

Pass `canExtract={Boolean(selectedFilePath && result && viewModel.packageRows.length > 0)}` from `AnalysisTabs`.

- [ ] **Step 7: Wire App props and styles**

In `node-shell/apps/desktop/renderer-src/src/App.tsx`, select:

```ts
const isExtracting = useAppStore((state) => state.isExtracting);
const extractSelectedContainer = useAppStore((state) => state.extractSelectedContainer);
```

Update busy state:

```ts
const shellBusy = isOpeningDirectory || isAnalyzing || isExtracting;
```

Pass props:

```tsx
<AnalysisTabs
  result={analysisResult}
  selectedFilePath={selectedFilePath}
  selectedPackageId={selectedPackageId}
  tableHeight={tableHeight}
  isExtracting={isExtracting}
  onExtractSelectedContainer={() => void extractSelectedContainer()}
  onDetailsSelectionChange={setDetailSelection}
/>
```

In `node-shell/apps/desktop/renderer-src/src/styles.css`, update `.package-mode-row`:

```css
.package-mode-row {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 32px;
}
```

- [ ] **Step 8: Update App test mock**

In `node-shell/apps/desktop/renderer-src/src/App.test.tsx`, add action:

```ts
extractSelectedContainer: vi.fn(() => Promise.resolve()),
```

Add state defaults:

```ts
extractRequestId: 0,
extractSelectedContainer: mockHarness.actions.extractSelectedContainer,
isExtracting: false,
```

Update mocked `AnalysisTabs` props to include:

```tsx
isExtracting,
onExtractSelectedContainer,
selectedFilePath,
```

Render a probe button:

```tsx
<button
  data-extracting={isExtracting ? 'true' : 'false'}
  data-selected-file-path={selectedFilePath}
  type="button"
  onClick={onExtractSelectedContainer}
>
  Extract probe
</button>
```

Add test:

```ts
test('passes selected container and extract action to analysis tabs', () => {
  mockHarness.state = createMockState({
    analysisResult: {
      overview: { packageCount: 1 },
      packages: [{ packagePath: '../../../Engine/Config/Base.ini', order: 0 }],
    },
    selectedFilePath: 'C:\\Paks\\A.pak',
  });

  render(<App />);

  const probe = screen.getByRole('button', { name: 'Extract probe' });
  expect(probe).toHaveAttribute('data-selected-file-path', 'C:\\Paks\\A.pak');
  fireEvent.click(probe);
  expect(mockHarness.actions.extractSelectedContainer).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 9: Run renderer tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx apps/desktop/renderer-src/src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- node-shell/apps/desktop/renderer-src/src/stores/appStore.ts node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx node-shell/apps/desktop/renderer-src/src/App.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "Add renderer extract action"
```

## Task 6: Native Extract Exports

**Files:**
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/ContainerExtractor.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/ContainerExtractor.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Public/UnrealPackageInsightBackend.h`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UnrealPackageInsightBackend.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.h`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`

- [ ] **Step 1: Add C++ declarations**

Create `ContainerExtractor.h`:

```cpp
#pragma once

#include "Containers/Array.h"
#include "Containers/UnrealString.h"
#include "CoreTypes.h"

struct FUpiExtractResult
{
	FString ContainerPath;
	FString OutputDirectory;
	uint32 ExtractedFileCount = 0;
	uint32 ErrorCount = 0;
	TArray<FString> Issues;
};

bool UPI_ExtractPakFile(const FString& PakPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult);
bool UPI_ExtractIoStoreFile(const FString& UtocPath, const FString& UcasPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult);
```

- [ ] **Step 2: Add native ABI declarations**

In `UnrealPackageInsightBackend.h`, add:

```cpp
UPI_BACKEND_API int32_t UPI_ExtractPakV1(const char* PakPathUtf8, const char* OutputDirectoryUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_ExtractIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* OutputDirectoryUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
```

- [ ] **Step 3: Add extract response builder declaration**

In `UpiFlatBufferBuilders.h`, include `ContainerExtractor.h` and add:

```cpp
TArray<uint8> UPI_BuildExtractResponseFromResult(const FUpiExtractResult& Result, bool bSuccess);
```

- [ ] **Step 4: Implement extract response builder**

In `UpiFlatBufferBuilders.cpp`, include:

```cpp
#include "upi_extract_response_generated.h"
```

Add issue severity conditions for extract codes:

```cpp
IssueCode == TEXT("extract.path_required") ||
IssueCode == TEXT("extract.output_directory_required") ||
IssueCode == TEXT("extract.file_not_found") ||
IssueCode == TEXT("extract.invalid_output_directory") ||
IssueCode == TEXT("extract.aes_key_invalid") ||
IssueCode == TEXT("pak.extract_failed") ||
IssueCode == TEXT("iostore.extract_failed")
```

Add messages:

```cpp
if (IssueCode == TEXT("extract.path_required"))
{
	return TEXT("Container path is required.");
}
if (IssueCode == TEXT("extract.output_directory_required"))
{
	return TEXT("Output directory is required.");
}
if (IssueCode == TEXT("extract.file_not_found"))
{
	return TEXT("Container file was not found.");
}
if (IssueCode == TEXT("extract.invalid_output_directory"))
{
	return TEXT("Output directory could not be created or accessed.");
}
if (IssueCode == TEXT("extract.aes_key_invalid"))
{
	return TEXT("AES key must be a 16-byte or 32-byte hex value.");
}
if (IssueCode == TEXT("pak.extract_failed"))
{
	return TEXT("Pak extraction failed.");
}
if (IssueCode == TEXT("iostore.extract_failed"))
{
	return TEXT("IoStore extraction failed.");
}
```

Add builder:

```cpp
TArray<uint8> UPI_BuildExtractResponseFromResult(const FUpiExtractResult& Result, bool bSuccess)
{
	flatbuffers::FlatBufferBuilder Builder;

	std::vector<flatbuffers::Offset<upi::v1::Issue>> Issues;
	Issues.reserve(Result.Issues.Num());
	for (const FString& IssueCode : Result.Issues)
	{
		const auto Code = UPI_CreateString(Builder, IssueCode);
		const auto Message = UPI_CreateString(Builder, UPI_IssueMessageForCode(IssueCode));
		Issues.push_back(upi::v1::CreateIssue(
			Builder,
			UPI_IssueSeverityForCode(IssueCode, bSuccess),
			Code,
			Message));
	}

	const auto ContainerPath = UPI_CreateString(Builder, Result.ContainerPath);
	const auto OutputDirectory = UPI_CreateString(Builder, Result.OutputDirectory);
	const auto Response = upi::v1::CreateExtractResponseDirect(
		Builder,
		UPI_SchemaVersion,
		bSuccess ? upi::v1::ResponseStatus_Ok : upi::v1::ResponseStatus_Error,
		&Issues,
		ContainerPath,
		OutputDirectory,
		Result.ExtractedFileCount,
		Result.ErrorCount);

	upi::v1::FinishExtractResponseBuffer(Builder, Response);
	return UPI_CopyBuilderBytes(Builder);
}
```

- [ ] **Step 5: Implement extract bridges**

In `UnrealPackageInsightBackend.cpp`, include `ContainerExtractor.h` and add:

```cpp
int32_t UPI_ExtractPakV1(const char* PakPathUtf8, const char* OutputDirectoryUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	if (RequiredSize == nullptr)
	{
		return UPI_CALL_BAD_ARGUMENT;
	}

	const FString PakPath = PakPathUtf8 != nullptr ? FString(UTF8_TO_TCHAR(PakPathUtf8)) : FString();
	const FString OutputDirectory = OutputDirectoryUtf8 != nullptr ? FString(UTF8_TO_TCHAR(OutputDirectoryUtf8)) : FString();
	const FString AesKey = AesKeyUtf8OrNull != nullptr ? FString(UTF8_TO_TCHAR(AesKeyUtf8OrNull)) : FString();

	FUpiExtractResult Result;
	const bool bSuccess = UPI_ExtractPakFile(PakPath, OutputDirectory, AesKey, Result);
	return UPI_CopyResponseBytes(UPI_BuildExtractResponseFromResult(Result, bSuccess), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_ExtractIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* OutputDirectoryUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	if (RequiredSize == nullptr)
	{
		return UPI_CALL_BAD_ARGUMENT;
	}

	const FString UtocPath = UtocPathUtf8 != nullptr ? FString(UTF8_TO_TCHAR(UtocPathUtf8)) : FString();
	const FString UcasPath = UcasPathUtf8 != nullptr ? FString(UTF8_TO_TCHAR(UcasPathUtf8)) : FString();
	const FString OutputDirectory = OutputDirectoryUtf8 != nullptr ? FString(UTF8_TO_TCHAR(OutputDirectoryUtf8)) : FString();
	const FString AesKey = AesKeyUtf8OrNull != nullptr ? FString(UTF8_TO_TCHAR(AesKeyUtf8OrNull)) : FString();

	FUpiExtractResult Result;
	const bool bSuccess = UPI_ExtractIoStoreFile(UtocPath, UcasPath, OutputDirectory, AesKey, Result);
	return UPI_CopyResponseBytes(UPI_BuildExtractResponseFromResult(Result, bSuccess), OutBytes, OutCapacity, RequiredSize);
}
```

- [ ] **Step 6: Implement native extractor**

Create `ContainerExtractor.cpp`:

```cpp
#include "ContainerExtractor.h"

#include "HAL/FileManager.h"
#include "IoStoreUtilities.h"
#include "Misc/AES.h"
#include "Misc/Base64.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/KeyChainUtilities.h"
#include "Misc/Paths.h"
#include "PakFileUtilities.h"

namespace
{
	uint8 UPI_HexNibble(TCHAR Char)
	{
		if (Char >= TEXT('0') && Char <= TEXT('9'))
		{
			return static_cast<uint8>(Char - TEXT('0'));
		}
		if (Char >= TEXT('a') && Char <= TEXT('f'))
		{
			return static_cast<uint8>(Char - TEXT('a') + 10);
		}
		if (Char >= TEXT('A') && Char <= TEXT('F'))
		{
			return static_cast<uint8>(Char - TEXT('A') + 10);
		}
		return 0xff;
	}

	bool UPI_ParseHexAesKey(const FString& AesKey, TArray<uint8>& OutKeyBytes)
	{
		OutKeyBytes.Reset();
		FString Hex = AesKey.TrimStartAndEnd();
		if (Hex.StartsWith(TEXT("0x"), ESearchCase::IgnoreCase))
		{
			Hex.RightChopInline(2, EAllowShrinking::No);
		}

		if (Hex.IsEmpty())
		{
			return true;
		}

		const int32 InputByteCount = Hex.Len() / 2;
		if (Hex.Len() % 2 != 0 || (InputByteCount != 16 && InputByteCount != FAES::FAESKey::KeySize))
		{
			return false;
		}

		OutKeyBytes.SetNumZeroed(FAES::FAESKey::KeySize);
		for (int32 Index = 0; Index < InputByteCount; ++Index)
		{
			const uint8 High = UPI_HexNibble(Hex[Index * 2]);
			const uint8 Low = UPI_HexNibble(Hex[Index * 2 + 1]);
			if (High == 0xff || Low == 0xff)
			{
				OutKeyBytes.Reset();
				return false;
			}
			OutKeyBytes[Index] = static_cast<uint8>((High << 4) | Low);
		}
		return true;
	}

	bool UPI_BuildKeyChain(const FString& AesKey, FKeyChain& OutKeyChain)
	{
		OutKeyChain = FKeyChain();
		TArray<uint8> KeyBytes;
		if (!UPI_ParseHexAesKey(AesKey, KeyBytes))
		{
			return false;
		}
		if (KeyBytes.IsEmpty())
		{
			return true;
		}

		FNamedAESKey NewKey;
		NewKey.Name = TEXT("Default");
		NewKey.Guid = FGuid();
		NewKey.Key.Reset();
		FMemory::Memcpy(NewKey.Key.Key, KeyBytes.GetData(), FAES::FAESKey::KeySize);
		OutKeyChain.GetEncryptionKeys().Add(NewKey.Guid, NewKey);
		OutKeyChain.SetPrincipalEncryptionKey(OutKeyChain.GetEncryptionKeys().Find(NewKey.Guid));
		return true;
	}

	bool UPI_WriteTemporaryCryptoKeysFile(const FString& AesKey, FString& OutFilePath)
	{
		TArray<uint8> KeyBytes;
		if (!UPI_ParseHexAesKey(AesKey, KeyBytes))
		{
			return false;
		}
		if (KeyBytes.IsEmpty())
		{
			OutFilePath.Reset();
			return true;
		}

		const FString TempDirectory = FPaths::ProjectIntermediateDir().IsEmpty()
			? FPaths::EngineIntermediateDir()
			: FPaths::ProjectIntermediateDir();
		IFileManager::Get().MakeDirectory(*TempDirectory, true);
		OutFilePath = FPaths::CreateTempFilename(*TempDirectory, TEXT("UPI-CryptoKeys"), TEXT(".json"));

		const FString Json = FString::Printf(
			TEXT("{\"EncryptionKey\":{\"Name\":\"Default\",\"Guid\":\"00000000000000000000000000000000\",\"Key\":\"%s\"},\"SecondaryEncryptionKeys\":[]}"),
			*FBase64::Encode(KeyBytes));
		return FFileHelper::SaveStringToFile(Json, *OutFilePath);
	}

	FString UPI_QuoteCommandArgument(const FString& Value)
	{
		return FString::Printf(TEXT("\"%s\""), *Value.Replace(TEXT("\""), TEXT("\\\"")));
	}

	bool UPI_ValidateCommonInputs(const FString& ContainerPath, const FString& OutputDirectory, FUpiExtractResult& OutResult)
	{
		OutResult.ContainerPath = ContainerPath;
		OutResult.OutputDirectory = OutputDirectory;

		if (ContainerPath.IsEmpty())
		{
			OutResult.Issues.Add(TEXT("extract.path_required"));
			return false;
		}
		if (OutputDirectory.IsEmpty())
		{
			OutResult.Issues.Add(TEXT("extract.output_directory_required"));
			return false;
		}
		if (!IFileManager::Get().FileExists(*ContainerPath))
		{
			OutResult.Issues.Add(TEXT("extract.file_not_found"));
			return false;
		}
		if (!IFileManager::Get().MakeDirectory(*OutputDirectory, true) && !IFileManager::Get().DirectoryExists(*OutputDirectory))
		{
			OutResult.Issues.Add(TEXT("extract.invalid_output_directory"));
			return false;
		}
		return true;
	}
}

bool UPI_ExtractPakFile(const FString& PakPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult)
{
	OutResult = FUpiExtractResult();
	if (!UPI_ValidateCommonInputs(PakPath, OutputDirectory, OutResult))
	{
		return false;
	}

	FString CryptoKeysFile;
	if (!UPI_WriteTemporaryCryptoKeysFile(AesKey, CryptoKeysFile))
	{
		OutResult.Issues.Add(TEXT("extract.aes_key_invalid"));
		return false;
	}

	ON_SCOPE_EXIT
	{
		if (!CryptoKeysFile.IsEmpty())
		{
			IFileManager::Get().Delete(*CryptoKeysFile, false, true);
		}
	};

	FString CommandLine = FString::Printf(
		TEXT("-Extract %s %s -ExtractToMountPoint"),
		*UPI_QuoteCommandArgument(PakPath),
		*UPI_QuoteCommandArgument(OutputDirectory));
	if (!CryptoKeysFile.IsEmpty())
	{
		CommandLine += FString::Printf(TEXT(" -cryptokeys=%s"), *UPI_QuoteCommandArgument(CryptoKeysFile));
	}

	if (!ExecuteUnrealPak(*CommandLine))
	{
		OutResult.Issues.Add(TEXT("pak.extract_failed"));
		OutResult.ErrorCount = 1;
		return false;
	}

	return true;
}

bool UPI_ExtractIoStoreFile(const FString& UtocPath, const FString& UcasPath, const FString& OutputDirectory, const FString& AesKey, FUpiExtractResult& OutResult)
{
	OutResult = FUpiExtractResult();
	const FString ContainerPath = !UtocPath.IsEmpty() ? UtocPath : UcasPath;
	if (!UPI_ValidateCommonInputs(ContainerPath, OutputDirectory, OutResult))
	{
		return false;
	}

	FKeyChain KeyChain;
	if (!UPI_BuildKeyChain(AesKey, KeyChain))
	{
		OutResult.Issues.Add(TEXT("extract.aes_key_invalid"));
		return false;
	}

	bool bIsSigned = false;
	if (!ExtractFilesFromIoStoreContainer(*ContainerPath, *OutputDirectory, KeyChain, nullptr, nullptr, nullptr, &bIsSigned))
	{
		OutResult.Issues.Add(TEXT("iostore.extract_failed"));
		OutResult.ErrorCount = 1;
		return false;
	}

	return true;
}
```

- [ ] **Step 7: Add module dependencies**

In `UnrealPackageInsightBackend.Build.cs`, keep existing dependencies and add:

```csharp
PrivateDependencyModuleNames.AddRange(
	new string[]
	{
		"IoStoreUtilities",
		"Json",
		"PakFileUtilities"
	}
);
```

- [ ] **Step 8: Build native backend and fix compile errors**

Run:

```powershell
npm.cmd run build:native:development -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

Expected: exits `0`, Unreal output reports build success, and staged development backend exists.

If this fails because `ExecuteUnrealPak` cannot be safely invoked or linked from this Program DLL, stop and report the blocker instead of implementing custom Pak path logic. The user explicitly requested direct UnrealPak behavior.

- [ ] **Step 9: Commit**

```powershell
git add -- ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/ContainerExtractor.h ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/ContainerExtractor.cpp ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Public/UnrealPackageInsightBackend.h ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UnrealPackageInsightBackend.cpp ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.h ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.cpp ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs
git commit -m "Add native container extraction exports"
```

## Task 7: Full Build, Smoke, And Integration Verification

**Files:**
- Modify: `node-shell/apps/desktop/test/electron-gui-smoke.test.js`
- Possibly generated/staged native outputs under `node-shell/native/**`

- [ ] **Step 1: Update Electron GUI smoke expectations**

In `node-shell/apps/desktop/test/electron-gui-smoke.test.js`, add checks equivalent to:

```js
const extractButtonText = await runtime.evaluate(() => document.body.innerText.includes('Extract to...'));
assert.equal(extractButtonText, true);

const hasExtractApi = await runtime.evaluate(() => typeof window.upi.extractSelectedContainer === 'function');
assert.equal(hasExtractApi, true);
```

Use the existing DevTools Protocol helper objects in that file; do not introduce a second browser automation style.

- [ ] **Step 2: Run protocol generation once more**

Run:

```powershell
npm.cmd --prefix node-shell run generate-protocol
```

Expected: exits `0`.

- [ ] **Step 3: Run the full native backend workflow**

Run:

```powershell
npm.cmd run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

Expected:

- exits `0`,
- build script smoke check prints backend/protocol info such as `Backend`, `Unreal`, and `Protocol`,
- staged manifests and DLLs exist for debug, development, and shipping.

- [ ] **Step 4: Confirm staged backend outputs**

Run:

```powershell
Get-ChildItem -Path 'C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\native' -Recurse -Filter backend.json
Get-ChildItem -Path 'C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\native' -Recurse -Filter UnrealPackageInsightBackend.dll
```

Expected: each expected configuration has both `backend.json` and `UnrealPackageInsightBackend.dll`.

- [ ] **Step 5: Run all node-shell tests**

Run:

```powershell
npm.cmd --prefix node-shell test
```

Expected: PASS.

- [ ] **Step 6: Run fresh Electron GUI smoke**

Run:

```powershell
npm.cmd --prefix node-shell run build:renderer
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

Expected:

- Electron launches,
- renderer reports no runtime exceptions,
- `#root` has mounted content,
- expected visible UI text includes `Extract to...`,
- preload API exists as `window.upi`,
- `window.upi.extractSelectedContainer` is a function.

- [ ] **Step 7: Review git status and avoid unrelated files**

Run:

```powershell
git status --short
```

Expected: only files changed by this feature are staged/committed. Existing unrelated `node-shell/package.json`, `node-shell/package-lock.json`, and `node-shell/Engine/` changes must not be included unless the user explicitly owns and approves them.

- [ ] **Step 8: Commit smoke update and staged native outputs**

If Task 6 did not already include generated native staging outputs, commit them now:

```powershell
git add -- node-shell/apps/desktop/test/electron-gui-smoke.test.js node-shell/native
git commit -m "Verify container extract integration"
```

If `node-shell/native` has no changes because the build reproduces existing binaries exactly, commit only the smoke test update.

## Final Verification Checklist

- [ ] `npm.cmd --prefix node-shell run generate-protocol` passed.
- [ ] `npm.cmd run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine` passed.
- [ ] Expected `backend.json` files exist under `node-shell/native/**`.
- [ ] Expected `UnrealPackageInsightBackend.dll` files exist under `node-shell/native/**`.
- [ ] `npm.cmd --prefix node-shell test` passed.
- [ ] Fresh Electron GUI smoke passed and checked `Extract to...`, no renderer exceptions, mounted `#root`, and `window.upi.extractSelectedContainer`.
- [ ] Work was committed in scoped commits without unrelated pre-existing changes.

## Notes For Execution

- Before implementation, use `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
- For C++ edits, follow `.agents/workflow/update-native-backend.md` before finishing.
- Do not use project-local PowerShell scripts for backend staging, backend building, or protocol generation.
- Do not add workflow environment variable dependencies.
- Do not implement custom mount point normalization in UPI. If direct PakFileUtilities command extraction cannot work in the DLL, stop and report that blocker.
