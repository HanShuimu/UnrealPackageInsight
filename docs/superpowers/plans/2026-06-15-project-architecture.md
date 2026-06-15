# Project Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first UnrealPackageInsight desktop architecture: shared Node backend core, FlatBuffers response protocol, Electron GUI shell, and UE DLL V1 interfaces for on-demand Pak and IoStore analysis.

**Architecture:** The UE Program DLL exposes narrow C ABI functions with simple string inputs and FlatBuffers byte outputs. Node owns shared backend loading, protocol decoding, directory scanning, IoStore pairing, AES key session memory, and Electron IPC orchestration. Electron renderer is a view layer over main-process services.

**Tech Stack:** Unreal Engine 5 Program DLL, C++17, FlatBuffers, Node.js CommonJS, `koffi`, Electron, `node:test`, PowerShell build scripts.

---

## Scope Guard

This plan implements the first GUI architecture and preserves a CLI placeholder. It does not implement real CLI commands. It does not persist AES keys. It does not add a `layout` protocol field. It does not add JSON response payloads for analysis results.

The plan is intentionally split so the architecture can run with stub native analysis responses before real Pak and IoStore analyzers are wired in.

## File Structure

Create or modify these files.

```text
node-shell/
  package.json
  src/
    index.js                         # legacy smoke entry kept thin or redirected
  packages/
    protocol/
      upi_common.fbs
      upi_backend_info.fbs
      upi_pak_analysis.fbs
      upi_iostore_analysis.fbs
      generated/
        cpp/
        ts/
        js/
      src/
        backend-info-decoder.js
        pak-analysis-decoder.js
        iostore-analysis-decoder.js
        issue-utils.js
    backend-core/
      src/
        backend-config.js
        backend-library.js
        backend-client.js
        call-buffered-export.js
      test/
        backend-config.test.js
        backend-client.test.js
        call-buffered-export.test.js
    analysis-domain/
      src/
        package-scan.js
        container-pairing.js
        aes-key-session.js
        analysis-cache.js
        analysis-service.js
      test/
        package-scan.test.js
        container-pairing.test.js
        aes-key-session.test.js
        analysis-service.test.js
  apps/
    desktop/
      main.js
      preload.js
      renderer/
        index.html
        renderer.js
        styles.css
      test/
        view-model.test.js
  bin/
    upi-gui.js
    upi-cli.js

scripts/
  generate-protocol.ps1

ue-backend/
  UnrealPackageInsightBackend/
    Source/
      UnrealPackageInsightBackend/
        Public/
          UnrealPackageInsightBackend.h
        Private/
          UnrealPackageInsightBackend.cpp
          UpiFlatBufferBuilders.h
          UpiFlatBufferBuilders.cpp
          PakAnalyzer.h
          PakAnalyzer.cpp
          IoStoreAnalyzer.h
          IoStoreAnalyzer.cpp
```

Generated protocol files should be committed so normal test runs do not require `flatc`. `scripts/generate-protocol.ps1` is the single regeneration path.

## Task 1: Prepare Node Package Scripts And Dependencies

**Files:**
- Modify: `node-shell/package.json`
- Verify: `node-shell/package-lock.json`

- [ ] **Step 1: Add desktop and protocol scripts**

Update `node-shell/package.json` to include these scripts and dependencies:

```json
{
  "name": "unreal-package-insight-node-shell",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "main": "bin/upi-gui.js",
  "scripts": {
    "test": "node --test",
    "call-backend": "node src/index.js",
    "generate-protocol": "powershell -ExecutionPolicy Bypass -File ../scripts/generate-protocol.ps1",
    "gui": "node bin/upi-gui.js",
    "cli": "node bin/upi-cli.js"
  },
  "dependencies": {
    "electron": "^31.0.0",
    "flatbuffers": "^24.3.25",
    "koffi": "3.0.2"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm install
```

Expected: `package-lock.json` updates and `npm test` remains runnable.

- [ ] **Step 3: Run the existing tests**

Run:

```powershell
npm test
```

Expected: existing `dll-paths` and `backend-runner` tests pass.

- [ ] **Step 4: Commit**

```powershell
git add node-shell/package.json node-shell/package-lock.json
git commit -m "Prepare Node desktop dependencies"
```

## Task 2: Add FlatBuffers Schemas And Generation Script

**Files:**
- Create: `node-shell/packages/protocol/upi_common.fbs`
- Create: `node-shell/packages/protocol/upi_backend_info.fbs`
- Create: `node-shell/packages/protocol/upi_pak_analysis.fbs`
- Create: `node-shell/packages/protocol/upi_iostore_analysis.fbs`
- Create: `scripts/generate-protocol.ps1`

- [ ] **Step 1: Add common schema**

Create `node-shell/packages/protocol/upi_common.fbs`:

```fbs
namespace upi.v1;

enum ResponseStatus : byte {
  Ok = 0,
  Error = 1
}

enum IssueSeverity : byte {
  Info = 0,
  Warning = 1,
  Error = 2
}

table Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
}
```

- [ ] **Step 2: Add backend info schema**

Create `node-shell/packages/protocol/upi_backend_info.fbs`:

```fbs
include "upi_common.fbs";

namespace upi.v1;

table BackendInfoResponse {
  schema_version: uint;
  status: ResponseStatus;
  issues: [Issue];
  backend_name: string;
  backend_version: string;
  unreal_version: string;
  protocol_version: uint;
}

root_type BackendInfoResponse;
file_identifier "UPBI";
```

- [ ] **Step 3: Add Pak schema**

Create `node-shell/packages/protocol/upi_pak_analysis.fbs`:

```fbs
include "upi_common.fbs";

namespace upi.v1;

table PakOverview {
  pak_path: string;
  mount_point: string;
  pak_version: uint;
  pak_size: ulong;
  index_encrypted: bool;
  encryption_key_guid: string;
  has_full_directory_index: bool;
  partial_listing: bool;
  package_count: uint;
  compressed_block_count: uint;
}

table PakPackageEntry {
  package_path: string;
  mount_point: string;
  offset: ulong;
  payload_offset: ulong;
  size: ulong;
  compressed_size: ulong;
  record_size: ulong;
  compression: string;
  compression_method_index: uint;
  compression_block_size: uint;
  compression_block_count: uint;
  first_compressed_block_index: uint;
  relative_block_offsets: bool;
  order: uint;
  flags: uint;
  hash: string;
  has_path: bool;
}

table PakCompressedBlockEntry {
  package_index: uint;
  block_index: uint;
  compressed_start: ulong;
  compressed_end: ulong;
  compressed_size: ulong;
  disk_size: ulong;
  physical_start: ulong;
  physical_end: ulong;
}

table PakAnalysisResponse {
  schema_version: uint;
  status: ResponseStatus;
  issues: [Issue];
  overview: PakOverview;
  packages: [PakPackageEntry];
  compressed_blocks: [PakCompressedBlockEntry];
}

root_type PakAnalysisResponse;
file_identifier "UPPA";
```

- [ ] **Step 4: Add IoStore schema**

Create `node-shell/packages/protocol/upi_iostore_analysis.fbs`:

```fbs
include "upi_common.fbs";

namespace upi.v1;

table IoStoreOverview {
  utoc_path: string;
  container_base_path: string;
  container_id: ulong;
  toc_version: uint;
  toc_entry_count: uint;
  compression_block_count: uint;
  compression_block_size: uint;
  partition_count: uint;
  partition_size: ulong;
  container_flags: uint;
  encryption_key_guid: string;
  directory_index_size: uint;
  indexed: bool;
  partial_listing: bool;
}

table IoStorePartition {
  partition_index: uint;
  ucas_path: string;
  size: ulong;
}

table IoStorePackageEntry {
  package_path: string;
  package_id: ulong;
  first_chunk_index: uint;
  chunk_count: uint;
  first_partition_index: uint;
  first_offset: ulong;
  size: ulong;
  compressed_size: ulong;
  disk_size: ulong;
  order: uint;
  has_path: bool;
}

table IoStoreChunkEntry {
  package_index: uint;
  package_path: string;
  toc_entry_index: uint;
  chunk_id: string;
  chunk_type: string;
  package_id: ulong;
  chunk_index: uint;
  bulk_data_cooked_index: uint;
  logical_offset: ulong;
  offset: ulong;
  ucas_offset: ulong;
  size: ulong;
  compressed_size: ulong;
  disk_size: ulong;
  compression: string;
  first_block_index: uint;
  block_count: uint;
  partition_index: uint;
  order: uint;
  meta_flags: uint;
  container_flags: uint;
  hash: string;
  has_path: bool;
}

table IoStoreCompressedBlockEntry {
  block_index: uint;
  owner_toc_entry_index: uint;
  partition_index: uint;
  offset: ulong;
  ucas_offset: ulong;
  compressed_size: uint;
  disk_size: uint;
  uncompressed_size: uint;
  compression: string;
}

table IoStoreAnalysisResponse {
  schema_version: uint;
  status: ResponseStatus;
  issues: [Issue];
  overview: IoStoreOverview;
  partitions: [IoStorePartition];
  packages: [IoStorePackageEntry];
  chunks: [IoStoreChunkEntry];
  compressed_blocks: [IoStoreCompressedBlockEntry];
}

root_type IoStoreAnalysisResponse;
file_identifier "UPIO";
```

- [ ] **Step 5: Add generation script**

Create `scripts/generate-protocol.ps1`:

```powershell
param(
	[string]$Flatc = $env:UPI_FLATC
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$NodeShellDir = Join-Path $RepoRoot "node-shell"
$ProtocolDir = Join-Path $RepoRoot "node-shell\packages\protocol"
$CppOut = Join-Path $ProtocolDir "generated\cpp"
$TsOut = Join-Path $ProtocolDir "generated\ts"
$JsOut = Join-Path $ProtocolDir "generated\js"

if ([string]::IsNullOrWhiteSpace($Flatc)) {
	$Command = Get-Command flatc -ErrorAction SilentlyContinue
	if ($Command) {
		$Flatc = $Command.Source
	}
}

if ([string]::IsNullOrWhiteSpace($Flatc) -or !(Test-Path -LiteralPath $Flatc)) {
	throw "flatc not found. Install the FlatBuffers compiler or set UPI_FLATC to flatc.exe."
}

$Tsc = Join-Path $NodeShellDir "node_modules\.bin\tsc.cmd"
if (!(Test-Path -LiteralPath $Tsc)) {
	throw "TypeScript compiler not found at $Tsc. Run npm install from node-shell before generating protocol bindings."
}

foreach ($OutDir in @($CppOut, $TsOut, $JsOut)) {
	if (Test-Path -LiteralPath $OutDir) {
		Remove-Item -LiteralPath $OutDir -Recurse -Force
	}
	New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

$Schemas = @(
	"upi_backend_info.fbs",
	"upi_pak_analysis.fbs",
	"upi_iostore_analysis.fbs"
)

$SchemaPaths = foreach ($Schema in $Schemas) {
	Join-Path $ProtocolDir $Schema
}

$CommonSchemaPath = Join-Path $ProtocolDir "upi_common.fbs"
$AllSchemaPaths = @($CommonSchemaPath) + $SchemaPaths

& $Flatc --warnings-as-errors --cpp --filename-suffix "_generated" -o $CppOut -I $ProtocolDir @AllSchemaPaths
if ($LASTEXITCODE -ne 0) {
	throw "flatc C++ generation failed."
}

& $Flatc --warnings-as-errors --ts -o $TsOut -I $ProtocolDir @AllSchemaPaths
if ($LASTEXITCODE -ne 0) {
	throw "flatc TypeScript generation failed."
}

$TsFiles = @(Get-ChildItem -Path $TsOut -Recurse -Filter "*.ts" | Select-Object -ExpandProperty FullName)
if (!$TsFiles -or $TsFiles.Count -eq 0) {
	throw "flatc TypeScript generation produced no .ts files in $TsOut."
}

$TscArgs = @(
	"--target", "ES2020",
	"--module", "commonjs",
	"--moduleResolution", "node",
	"--rootDir", $TsOut,
	"--outDir", $JsOut,
	"--skipLibCheck",
	"--noEmitOnError"
) + $TsFiles

& $Tsc @TscArgs
if ($LASTEXITCODE -ne 0) {
	throw "TypeScript compilation failed for generated protocol bindings."
}

Write-Output "[OK] Generated FlatBuffers bindings in $ProtocolDir\generated"
```

- [ ] **Step 6: Generate bindings**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm run generate-protocol
```

Expected generated files include:

```text
node-shell/packages/protocol/generated/cpp/upi_backend_info_generated.h
node-shell/packages/protocol/generated/cpp/upi_common_generated.h
node-shell/packages/protocol/generated/cpp/upi_pak_analysis_generated.h
node-shell/packages/protocol/generated/cpp/upi_iostore_analysis_generated.h
node-shell/packages/protocol/generated/ts/upi/v1.ts
node-shell/packages/protocol/generated/ts/upi/v1/backend-info-response.ts
node-shell/packages/protocol/generated/ts/upi/v1/pak-analysis-response.ts
node-shell/packages/protocol/generated/ts/upi/v1/io-store-analysis-response.ts
node-shell/packages/protocol/generated/js/upi/v1.js
node-shell/packages/protocol/generated/js/upi/v1/backend-info-response.js
node-shell/packages/protocol/generated/js/upi/v1/pak-analysis-response.js
node-shell/packages/protocol/generated/js/upi/v1/io-store-analysis-response.js
```

- [ ] **Step 7: Commit**

```powershell
git add scripts/generate-protocol.ps1 node-shell/packages/protocol
git commit -m "Add FlatBuffers protocol schemas"
```

## Task 3: Add Protocol Decoders And Fixture Tests

**Files:**
- Create: `node-shell/packages/protocol/src/issue-utils.js`
- Create: `node-shell/packages/protocol/src/backend-info-decoder.js`
- Create: `node-shell/packages/protocol/src/pak-analysis-decoder.js`
- Create: `node-shell/packages/protocol/src/iostore-analysis-decoder.js`
- Create: `node-shell/packages/protocol/test/protocol-decoders.test.js`

- [ ] **Step 1: Add issue helpers**

Create `node-shell/packages/protocol/src/issue-utils.js`:

```js
function readIssue(issue) {
  return {
    severity: issue.severity(),
    code: issue.code() || '',
    message: issue.message() || '',
  };
}

function hasIssueCode(response, suffixOrCode) {
  const issues = response.issues || [];
  return issues.some((issue) => issue.code === suffixOrCode || issue.code.endsWith(suffixOrCode));
}

module.exports = {
  readIssue,
  hasIssueCode,
};
```

- [ ] **Step 2: Add backend info decoder**

Create `node-shell/packages/protocol/src/backend-info-decoder.js`:

```js
const flatbuffers = require('flatbuffers').flatbuffers || require('flatbuffers');
const { BackendInfoResponse } = require('../generated/js/upi/v1/backend-info-response.js');
const { readIssue } = require('./issue-utils');

function decodeBackendInfoResponse(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const byteBuffer = new flatbuffers.ByteBuffer(bytes);
  if (!BackendInfoResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid BackendInfoResponse FlatBuffer identifier');
  }
  const response = BackendInfoResponse.getRootAsBackendInfoResponse(byteBuffer);
  const issues = [];
  for (let index = 0; index < response.issuesLength(); index += 1) {
    issues.push(readIssue(response.issues(index)));
  }
  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues,
    backendName: response.backendName() || '',
    backendVersion: response.backendVersion() || '',
    unrealVersion: response.unrealVersion() || '',
    protocolVersion: response.protocolVersion(),
  };
}

module.exports = {
  decodeBackendInfoResponse,
};
```

- [ ] **Step 3: Add Pak decoder**

Create `node-shell/packages/protocol/src/pak-analysis-decoder.js` with this shape:

```js
const flatbuffers = require('flatbuffers').flatbuffers || require('flatbuffers');
const { PakAnalysisResponse } = require('../generated/js/upi/v1/pak-analysis-response.js');
const { readIssue } = require('./issue-utils');

function readU64(value) {
  return typeof value === 'bigint' ? value : BigInt(value.toString());
}

function decodePakAnalysisResponse(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const byteBuffer = new flatbuffers.ByteBuffer(bytes);
  if (!PakAnalysisResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid PakAnalysisResponse FlatBuffer identifier');
  }
  const response = PakAnalysisResponse.getRootAsPakAnalysisResponse(byteBuffer);
  const overview = response.overview();
  const issues = [];
  const packages = [];
  const compressedBlocks = [];

  for (let index = 0; index < response.issuesLength(); index += 1) {
    issues.push(readIssue(response.issues(index)));
  }
  for (let index = 0; index < response.packagesLength(); index += 1) {
    const item = response.packages(index);
    packages.push({
      packagePath: item.packagePath() || '',
      mountPoint: item.mountPoint() || '',
      offset: readU64(item.offset()),
      payloadOffset: readU64(item.payloadOffset()),
      size: readU64(item.size()),
      compressedSize: readU64(item.compressedSize()),
      recordSize: readU64(item.recordSize()),
      compression: item.compression() || '',
      compressionMethodIndex: item.compressionMethodIndex(),
      compressionBlockSize: item.compressionBlockSize(),
      compressionBlockCount: item.compressionBlockCount(),
      firstCompressedBlockIndex: item.firstCompressedBlockIndex(),
      relativeBlockOffsets: item.relativeBlockOffsets(),
      order: item.order(),
      flags: item.flags(),
      hash: item.hash() || '',
      hasPath: item.hasPath(),
    });
  }
  for (let index = 0; index < response.compressedBlocksLength(); index += 1) {
    const item = response.compressedBlocks(index);
    compressedBlocks.push({
      packageIndex: item.packageIndex(),
      blockIndex: item.blockIndex(),
      compressedStart: readU64(item.compressedStart()),
      compressedEnd: readU64(item.compressedEnd()),
      compressedSize: readU64(item.compressedSize()),
      diskSize: readU64(item.diskSize()),
      physicalStart: readU64(item.physicalStart()),
      physicalEnd: readU64(item.physicalEnd()),
    });
  }

  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues,
    overview: overview ? {
      pakPath: overview.pakPath() || '',
      mountPoint: overview.mountPoint() || '',
      pakVersion: overview.pakVersion(),
      pakSize: readU64(overview.pakSize()),
      indexEncrypted: overview.indexEncrypted(),
      encryptionKeyGuid: overview.encryptionKeyGuid() || '',
      hasFullDirectoryIndex: overview.hasFullDirectoryIndex(),
      partialListing: overview.partialListing(),
      packageCount: overview.packageCount(),
      compressedBlockCount: overview.compressedBlockCount(),
    } : null,
    packages,
    compressedBlocks,
  };
}

module.exports = {
  decodePakAnalysisResponse,
};
```

- [ ] **Step 4: Add IoStore decoder**

Create `node-shell/packages/protocol/src/iostore-analysis-decoder.js`:

```js
const flatbuffers = require('flatbuffers').flatbuffers || require('flatbuffers');
const { IoStoreAnalysisResponse } = require('../generated/js/upi/v1/io-store-analysis-response.js');
const { readIssue } = require('./issue-utils');

function readU64(value) {
  return typeof value === 'bigint' ? value : BigInt(value.toString());
}

function decodeIoStoreAnalysisResponse(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const byteBuffer = new flatbuffers.ByteBuffer(bytes);
  if (!IoStoreAnalysisResponse.bufferHasIdentifier(byteBuffer)) {
    throw new Error('Invalid IoStoreAnalysisResponse FlatBuffer identifier');
  }
  const response = IoStoreAnalysisResponse.getRootAsIoStoreAnalysisResponse(byteBuffer);
  const overview = response.overview();
  const issues = [];
  const partitions = [];
  const packages = [];
  const chunks = [];
  const compressedBlocks = [];

  for (let index = 0; index < response.issuesLength(); index += 1) {
    issues.push(readIssue(response.issues(index)));
  }
  for (let index = 0; index < response.partitionsLength(); index += 1) {
    const item = response.partitions(index);
    partitions.push({
      partitionIndex: item.partitionIndex(),
      ucasPath: item.ucasPath() || '',
      size: readU64(item.size()),
    });
  }
  for (let index = 0; index < response.packagesLength(); index += 1) {
    const item = response.packages(index);
    packages.push({
      packagePath: item.packagePath() || '',
      packageId: readU64(item.packageId()),
      firstChunkIndex: item.firstChunkIndex(),
      chunkCount: item.chunkCount(),
      firstPartitionIndex: item.firstPartitionIndex(),
      firstOffset: readU64(item.firstOffset()),
      size: readU64(item.size()),
      compressedSize: readU64(item.compressedSize()),
      diskSize: readU64(item.diskSize()),
      order: item.order(),
      hasPath: item.hasPath(),
    });
  }
  for (let index = 0; index < response.chunksLength(); index += 1) {
    const item = response.chunks(index);
    chunks.push({
      packageIndex: item.packageIndex(),
      packagePath: item.packagePath() || '',
      tocEntryIndex: item.tocEntryIndex(),
      chunkId: item.chunkId() || '',
      chunkType: item.chunkType() || '',
      packageId: readU64(item.packageId()),
      chunkIndex: item.chunkIndex(),
      bulkDataCookedIndex: item.bulkDataCookedIndex(),
      logicalOffset: readU64(item.logicalOffset()),
      offset: readU64(item.offset()),
      ucasOffset: readU64(item.ucasOffset()),
      size: readU64(item.size()),
      compressedSize: readU64(item.compressedSize()),
      diskSize: readU64(item.diskSize()),
      compression: item.compression() || '',
      firstBlockIndex: item.firstBlockIndex(),
      blockCount: item.blockCount(),
      partitionIndex: item.partitionIndex(),
      order: item.order(),
      metaFlags: item.metaFlags(),
      containerFlags: item.containerFlags(),
      hash: item.hash() || '',
      hasPath: item.hasPath(),
    });
  }
  for (let index = 0; index < response.compressedBlocksLength(); index += 1) {
    const item = response.compressedBlocks(index);
    compressedBlocks.push({
      blockIndex: item.blockIndex(),
      ownerTocEntryIndex: item.ownerTocEntryIndex(),
      partitionIndex: item.partitionIndex(),
      offset: readU64(item.offset()),
      ucasOffset: readU64(item.ucasOffset()),
      compressedSize: item.compressedSize(),
      diskSize: item.diskSize(),
      uncompressedSize: item.uncompressedSize(),
      compression: item.compression() || '',
    });
  }

  return {
    schemaVersion: response.schemaVersion(),
    status: response.status(),
    issues,
    overview: overview ? {
      utocPath: overview.utocPath() || '',
      containerBasePath: overview.containerBasePath() || '',
      containerId: readU64(overview.containerId()),
      tocVersion: overview.tocVersion(),
      tocEntryCount: overview.tocEntryCount(),
      compressionBlockCount: overview.compressionBlockCount(),
      compressionBlockSize: overview.compressionBlockSize(),
      partitionCount: overview.partitionCount(),
      partitionSize: readU64(overview.partitionSize()),
      containerFlags: overview.containerFlags(),
      encryptionKeyGuid: overview.encryptionKeyGuid() || '',
      directoryIndexSize: overview.directoryIndexSize(),
      indexed: overview.indexed(),
      partialListing: overview.partialListing(),
    } : null,
    partitions,
    packages,
    chunks,
    compressedBlocks,
  };
}

module.exports = {
  decodeIoStoreAnalysisResponse,
};
```

- [ ] **Step 5: Add generated fixture tests**

Create `node-shell/packages/protocol/test/protocol-decoders.test.js`. Use generated FlatBuffers builders to create one response per root type, decode it, and assert key fields:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const flatbuffers = require('flatbuffers').flatbuffers || require('flatbuffers');

const { decodeBackendInfoResponse } = require('../src/backend-info-decoder');

test('decodeBackendInfoResponse rejects the wrong buffer identifier', () => {
  assert.throws(() => decodeBackendInfoResponse(Buffer.from([0, 1, 2, 3])), /BackendInfoResponse/);
});

test('decodeBackendInfoResponse decodes a generated response', () => {
  const builder = new flatbuffers.Builder(128);
  const name = builder.createString('UnrealPackageInsightBackend');
  const version = builder.createString('0.1.0');
  const unrealVersion = builder.createString('5.x');
  const { BackendInfoResponse } = require('../generated/js/upi/v1/backend-info-response.js');
  BackendInfoResponse.startBackendInfoResponse(builder);
  BackendInfoResponse.addSchemaVersion(builder, 1);
  BackendInfoResponse.addStatus(builder, 0);
  BackendInfoResponse.addBackendName(builder, name);
  BackendInfoResponse.addBackendVersion(builder, version);
  BackendInfoResponse.addUnrealVersion(builder, unrealVersion);
  BackendInfoResponse.addProtocolVersion(builder, 1);
  const response = BackendInfoResponse.endBackendInfoResponse(builder);
  builder.finish(response, 'UPBI');

  const decoded = decodeBackendInfoResponse(Buffer.from(builder.asUint8Array()));

  assert.equal(decoded.backendName, 'UnrealPackageInsightBackend');
  assert.equal(decoded.backendVersion, '0.1.0');
  assert.equal(decoded.protocolVersion, 1);
});
```

- [ ] **Step 6: Run decoder tests**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
```

Expected: decoder tests pass along with existing tests.

- [ ] **Step 7: Commit**

```powershell
git add node-shell/packages/protocol
git commit -m "Add protocol decoders"
```

## Task 4: Refactor Shared Backend Core

**Files:**
- Create: `node-shell/packages/backend-core/src/backend-config.js`
- Create: `node-shell/packages/backend-core/src/call-buffered-export.js`
- Create: `node-shell/packages/backend-core/src/backend-library.js`
- Create: `node-shell/packages/backend-core/src/backend-client.js`
- Create: `node-shell/packages/backend-core/test/call-buffered-export.test.js`
- Modify: `node-shell/src/dll-paths.js`
- Modify: `node-shell/src/backend-runner.js`

- [ ] **Step 1: Move path logic into backend-core**

Create `node-shell/packages/backend-core/src/backend-config.js` by moving the existing path functions from `node-shell/src/dll-paths.js`. Export:

```js
const path = require('node:path');

const DEFAULT_ENGINE_ROOT = 'C:\\WORKSPACE_UE\\UnrealEngine';
const WINDOWS_PATH_DELIMITER = ';';

function usageError() {
  return new Error('Usage: node src/index.js <path-to-backend-dll>');
}

function resolveDllPath(dllPath, cwd = process.cwd()) {
  if (!dllPath || typeof dllPath !== 'string' || dllPath.trim().length === 0) {
    throw usageError();
  }
  return path.win32.isAbsolute(dllPath)
    ? path.win32.normalize(dllPath)
    : path.win32.resolve(cwd, dllPath);
}

function getEngineWin64BinariesDir(engineRoot = DEFAULT_ENGINE_ROOT) {
  return path.win32.join(engineRoot, 'Engine', 'Binaries', 'Win64');
}

function buildDllSearchPath({ dllPath, engineRoot = DEFAULT_ENGINE_ROOT, existingPath = process.env.PATH || '' }) {
  const dllDirectory = path.win32.dirname(dllPath);
  const engineBinaries = getEngineWin64BinariesDir(engineRoot);
  const additions = [dllDirectory, engineBinaries];
  const existingParts = existingPath.length > 0 ? existingPath.split(WINDOWS_PATH_DELIMITER) : [];
  const seen = new Set();
  const merged = [];
  for (const part of additions.concat(existingParts)) {
    if (!part || seen.has(part.toLowerCase())) continue;
    seen.add(part.toLowerCase());
    merged.push(part);
  }
  return merged.join(WINDOWS_PATH_DELIMITER);
}

module.exports = {
  DEFAULT_ENGINE_ROOT,
  WINDOWS_PATH_DELIMITER,
  resolveDllPath,
  getEngineWin64BinariesDir,
  buildDllSearchPath,
};
```

- [ ] **Step 2: Keep legacy import compatibility**

Replace `node-shell/src/dll-paths.js` with:

```js
module.exports = require('../packages/backend-core/src/backend-config');
```

- [ ] **Step 3: Add buffered call helper**

Create `node-shell/packages/backend-core/src/call-buffered-export.js`:

```js
const CALL_OK = 0;
const CALL_BUFFER_TOO_SMALL = 1;

function createSizePointer(koffi) {
  const pointer = [0];
  return koffi && typeof koffi.alloc === 'function' ? koffi.alloc('int32', 1) : pointer;
}

function readSizePointer(pointer) {
  if (Array.isArray(pointer)) return pointer[0];
  if (pointer && typeof pointer.deref === 'function') return pointer.deref();
  if (pointer && typeof pointer[0] === 'number') return pointer[0];
  return 0;
}

function callBufferedExport({ fn, koffi, args = [], initialSize = 4096 }) {
  let capacity = initialSize;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const output = Buffer.alloc(capacity);
    const requiredSize = createSizePointer(koffi);
    const status = fn(...args, output, capacity, requiredSize);
    if (status === CALL_OK) {
      const size = readSizePointer(requiredSize) || capacity;
      return output.subarray(0, size);
    }
    if (status === CALL_BUFFER_TOO_SMALL) {
      capacity = readSizePointer(requiredSize);
      if (capacity <= output.length) {
        throw new Error('Backend reported BUFFER_TOO_SMALL without increasing RequiredSize');
      }
      continue;
    }
    throw new Error(`Backend call failed with status ${status}`);
  }
  throw new Error('Backend call did not complete after resizing output buffer');
}

module.exports = {
  CALL_OK,
  CALL_BUFFER_TOO_SMALL,
  callBufferedExport,
};
```

- [ ] **Step 4: Test buffered call retry**

Create `node-shell/packages/backend-core/test/call-buffered-export.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { callBufferedExport, CALL_BUFFER_TOO_SMALL, CALL_OK } = require('../src/call-buffered-export');

test('callBufferedExport retries when output buffer is too small', () => {
  const calls = [];
  const fn = (output, capacity, requiredSize) => {
    calls.push(capacity);
    if (capacity < 8) {
      requiredSize[0] = 8;
      return CALL_BUFFER_TOO_SMALL;
    }
    Buffer.from('payload').copy(output);
    requiredSize[0] = 7;
    return CALL_OK;
  };

  const result = callBufferedExport({ fn, args: [], initialSize: 4 });

  assert.deepEqual(calls, [4, 8]);
  assert.equal(result.toString(), 'payload');
});
```

- [ ] **Step 5: Add backend library binding**

Create `node-shell/packages/backend-core/src/backend-library.js`:

```js
function loadBackendLibrary({ dllPath, koffi }) {
  const library = koffi.load(dllPath);
  return {
    getBackendInfoV1: library.func('int UPI_GetBackendInfoV1(void*, int, void*)'),
    analyzePakV1: library.func('int UPI_AnalyzePakV1(str, str, void*, int, void*)'),
    analyzeIoStoreV1: library.func('int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)'),
  };
}

module.exports = {
  loadBackendLibrary,
};
```

- [ ] **Step 6: Add backend client**

Create `node-shell/packages/backend-core/src/backend-client.js`:

```js
const { callBufferedExport } = require('./call-buffered-export');
const { loadBackendLibrary } = require('./backend-library');
const { decodeBackendInfoResponse } = require('../../protocol/src/backend-info-decoder');
const { decodePakAnalysisResponse } = require('../../protocol/src/pak-analysis-decoder');
const { decodeIoStoreAnalysisResponse } = require('../../protocol/src/iostore-analysis-decoder');

function createBackendClient({ dllPath, koffi }) {
  const exports = loadBackendLibrary({ dllPath, koffi });
  return {
    getBackendInfo() {
      const bytes = callBufferedExport({ fn: exports.getBackendInfoV1, koffi });
      return decodeBackendInfoResponse(bytes);
    },
    analyzePak({ pakPath, aesKey = '' }) {
      const bytes = callBufferedExport({
        fn: exports.analyzePakV1,
        koffi,
        args: [pakPath, aesKey || ''],
      });
      return decodePakAnalysisResponse(bytes);
    },
    analyzeIoStore({ utocPath, ucasPath, aesKey = '' }) {
      const bytes = callBufferedExport({
        fn: exports.analyzeIoStoreV1,
        koffi,
        args: [utocPath, ucasPath, aesKey || ''],
      });
      return decodeIoStoreAnalysisResponse(bytes);
    },
  };
}

module.exports = {
  createBackendClient,
};
```

- [ ] **Step 7: Run tests**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```powershell
git add node-shell/src/dll-paths.js node-shell/packages/backend-core
git commit -m "Extract shared backend core"
```

## Task 5: Add UE DLL V1 Exports With Stub FlatBuffers

**Files:**
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Public/UnrealPackageInsightBackend.h`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UnrealPackageInsightBackend.cpp`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`

- [ ] **Step 1: Update Build.cs include paths**

Modify `UnrealPackageInsightBackend.Build.cs`:

```csharp
using System.IO;
using UnrealBuildTool;

public class UnrealPackageInsightBackend : ModuleRules
{
	public UnrealPackageInsightBackend(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core"
			}
		);

		string RepoRoot = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "..", ".."));
		PublicIncludePaths.Add(Path.Combine(RepoRoot, "node-shell", "packages", "protocol", "generated", "cpp"));
		PublicIncludePaths.Add(Path.Combine(Target.UEThirdPartySourceDirectory, "flatbuffers", "flatbuffers-24.3.25", "include"));
	}
}
```

- [ ] **Step 2: Replace public header exports**

Modify `UnrealPackageInsightBackend.h`:

```cpp
#pragma once

#include <stdint.h>

#if defined(_WIN32)
#define UPI_BACKEND_API extern "C" __declspec(dllexport)
#else
#define UPI_BACKEND_API extern "C" __attribute__((visibility("default")))
#endif

enum UPI_CallStatus : int32_t
{
	UPI_CALL_OK = 0,
	UPI_CALL_BUFFER_TOO_SMALL = 1,
	UPI_CALL_BAD_ARGUMENT = 2,
	UPI_CALL_INTERNAL_ERROR = 3
};

UPI_BACKEND_API int32_t UPI_GetBackendInfoV1(uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_AnalyzePakV1(const char* PakPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
UPI_BACKEND_API int32_t UPI_AnalyzeIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
```

- [ ] **Step 3: Add response copy helper and stub builders**

Create `UpiFlatBufferBuilders.h`:

```cpp
#pragma once

#include "Containers/Array.h"
#include "Containers/StringFwd.h"
#include <stdint.h>

TArray<uint8> UPI_BuildBackendInfoResponse();
TArray<uint8> UPI_BuildPakStubResponse(const char* PakPathUtf8, const char* AesKeyUtf8OrNull);
TArray<uint8> UPI_BuildIoStoreStubResponse(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull);
int32_t UPI_CopyResponseBytes(const TArray<uint8>& ResponseBytes, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize);
```

Create `UpiFlatBufferBuilders.cpp` with FlatBuffers builders for backend info and one minimal Pak/IoStore row each. For the first pass, hard-code:

```text
backendName = UnrealPackageInsightBackend
backendVersion = 0.2.0
protocolVersion = 1
Pak package path = /Game/Stub/Asset.uasset
IoStore chunk type = ExportBundleData
```

- [ ] **Step 4: Wire V1 exports**

Modify `UnrealPackageInsightBackend.cpp` so exports call the builders:

```cpp
#include "UnrealPackageInsightBackend.h"

#include "Modules/ModuleManager.h"
#include "UpiFlatBufferBuilders.h"

TCHAR GInternalProjectName[64] = TEXT("");
IMPLEMENT_FOREIGN_ENGINE_DIR()

int32_t UPI_GetBackendInfoV1(uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	return UPI_CopyResponseBytes(UPI_BuildBackendInfoResponse(), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_AnalyzePakV1(const char* PakPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	return UPI_CopyResponseBytes(UPI_BuildPakStubResponse(PakPathUtf8, AesKeyUtf8OrNull), OutBytes, OutCapacity, RequiredSize);
}

int32_t UPI_AnalyzeIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)
{
	return UPI_CopyResponseBytes(UPI_BuildIoStoreStubResponse(UtocPathUtf8, UcasPathUtf8, AesKeyUtf8OrNull), OutBytes, OutCapacity, RequiredSize);
}
```

- [ ] **Step 5: Stage and build the backend**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
.\scripts\stage-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine
.\scripts\build-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine -Configuration Development
```

Expected: build succeeds and prints `UPI_BACKEND_DLL=...UnrealPackageInsightBackend.dll`.

- [ ] **Step 6: Commit**

```powershell
git add ue-backend/UnrealPackageInsightBackend
git commit -m "Add backend V1 FlatBuffers exports"
```

## Task 6: Update Node Smoke Entry For V1 Backend

**Files:**
- Modify: `node-shell/src/backend-runner.js`
- Modify: `node-shell/src/index.js`
- Modify: `node-shell/test/backend-runner.test.js`

- [ ] **Step 1: Replace smoke runner behavior**

Modify `node-shell/src/backend-runner.js`:

```js
const { createBackendClient } = require('../packages/backend-core/src/backend-client');

function runBackendSmoke({ dllPath, koffi, log = console.log }) {
  const backend = createBackendClient({ dllPath, koffi });
  const info = backend.getBackendInfo();
  log(`Backend: ${info.backendName} ${info.backendVersion}`);
  log(`Unreal: ${info.unrealVersion}`);
  log(`Protocol: ${info.protocolVersion}`);
  return info;
}

module.exports = {
  runBackendSmoke,
};
```

- [ ] **Step 2: Update test fake**

Modify `node-shell/test/backend-runner.test.js` to fake the V1 buffered export call rather than `UPI_Add`. Assert the printed backend name, Unreal version, and protocol version.

- [ ] **Step 3: Run tests**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run native smoke**

Run with the DLL path from Task 5:

```powershell
$env:UPI_ENGINE_ROOT = "C:\WORKSPACE_UE\UnrealEngine"
node src/index.js "C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
```

Expected output includes:

```text
Backend: UnrealPackageInsightBackend 0.2.0
Protocol: 1
```

- [ ] **Step 5: Commit**

```powershell
git add node-shell/src node-shell/test
git commit -m "Update Node smoke for backend V1"
```

## Task 7: Implement Directory Scan And IoStore Pairing

**Files:**
- Create: `node-shell/packages/analysis-domain/src/package-scan.js`
- Create: `node-shell/packages/analysis-domain/src/container-pairing.js`
- Create: `node-shell/packages/analysis-domain/test/package-scan.test.js`
- Create: `node-shell/packages/analysis-domain/test/container-pairing.test.js`

- [ ] **Step 1: Implement container pairing**

Create `container-pairing.js`:

```js
const path = require('node:path');

function getContainerKind(filePath) {
  const ext = path.win32.extname(filePath).toLowerCase();
  if (ext === '.pak') return 'pak';
  if (ext === '.utoc') return 'utoc';
  if (ext === '.ucas') return 'ucas';
  return 'unsupported';
}

function stripIoStorePartitionSuffix(baseName) {
  return baseName.replace(/_s\d+$/i, '');
}

function buildIoStorePairs(filePaths) {
  const byDirAndBase = new Map();
  for (const filePath of filePaths) {
    const kind = getContainerKind(filePath);
    if (kind !== 'utoc' && kind !== 'ucas') continue;
    const dir = path.win32.dirname(filePath).toLowerCase();
    const parsed = path.win32.parse(filePath);
    const base = kind === 'ucas' ? stripIoStorePartitionSuffix(parsed.name).toLowerCase() : parsed.name.toLowerCase();
    const key = `${dir}|${base}`;
    const pair = byDirAndBase.get(key) || { utocPath: '', ucasPaths: [] };
    if (kind === 'utoc') pair.utocPath = filePath;
    if (kind === 'ucas') pair.ucasPaths.push(filePath);
    byDirAndBase.set(key, pair);
  }
  for (const pair of byDirAndBase.values()) {
    pair.ucasPaths.sort((a, b) => a.localeCompare(b));
  }
  return byDirAndBase;
}

function resolveIoStoreSelection(filePath, filePaths) {
  const kind = getContainerKind(filePath);
  if (kind !== 'utoc' && kind !== 'ucas') return null;
  const pairs = buildIoStorePairs(filePaths);
  const dir = path.win32.dirname(filePath).toLowerCase();
  const parsed = path.win32.parse(filePath);
  const base = kind === 'ucas' ? stripIoStorePartitionSuffix(parsed.name).toLowerCase() : parsed.name.toLowerCase();
  const pair = pairs.get(`${dir}|${base}`);
  if (!pair || !pair.utocPath || pair.ucasPaths.length === 0) {
    return {
      ok: false,
      issue: {
        severity: 'error',
        code: 'iostore.pair_missing',
        message: 'Selected IoStore file is missing its matching .utoc or .ucas file.',
      },
    };
  }
  return { ok: true, utocPath: pair.utocPath, ucasPath: pair.ucasPaths[0], ucasPaths: pair.ucasPaths };
}

module.exports = {
  getContainerKind,
  stripIoStorePartitionSuffix,
  buildIoStorePairs,
  resolveIoStoreSelection,
};
```

- [ ] **Step 2: Test pairing**

Create `container-pairing.test.js` with assertions for:

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveIoStoreSelection } = require('../src/container-pairing');

test('resolveIoStoreSelection resolves .ucas back to .utoc', () => {
  const files = [
    'C:\\Build\\Content\\Paks\\global.utoc',
    'C:\\Build\\Content\\Paks\\global.ucas',
  ];
  assert.deepEqual(resolveIoStoreSelection(files[1], files), {
    ok: true,
    utocPath: files[0],
    ucasPath: files[1],
    ucasPaths: [files[1]],
  });
});

test('resolveIoStoreSelection reports missing pair', () => {
  const result = resolveIoStoreSelection('C:\\Build\\Content\\Paks\\global.ucas', [
    'C:\\Build\\Content\\Paks\\global.ucas',
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'iostore.pair_missing');
});
```

- [ ] **Step 3: Implement package scan**

Create `package-scan.js` with an async recursive scanner that returns `{ root, files, tree }`. It should include only `.pak`, `.utoc`, `.ucas` files and parent folders.

- [ ] **Step 4: Test package scan using temporary folders**

Use `node:test`, `fs.mkdtempSync`, and create:

```text
Content/Paks/global.utoc
Content/Paks/global.ucas
Content/Paks/pakchunk0-Windows.pak
Engine/Binaries/Game.exe
```

Assert that only three supported files appear.

- [ ] **Step 5: Run tests and commit**

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
git add node-shell/packages/analysis-domain
git commit -m "Add package directory scanning"
```

## Task 8: Implement AES Session, Cache, And Analysis Service

**Files:**
- Create: `node-shell/packages/analysis-domain/src/aes-key-session.js`
- Create: `node-shell/packages/analysis-domain/src/analysis-cache.js`
- Create: `node-shell/packages/analysis-domain/src/analysis-service.js`
- Create: `node-shell/packages/analysis-domain/test/aes-key-session.test.js`
- Create: `node-shell/packages/analysis-domain/test/analysis-service.test.js`

- [ ] **Step 1: Add AES session**

Create `aes-key-session.js`:

```js
class AesKeySession {
  constructor() {
    this.key = '';
  }

  setKey(key) {
    const normalized = normalizeAesKey(key);
    this.key = normalized;
    return normalized;
  }

  getKey() {
    return this.key;
  }

  clear() {
    this.key = '';
  }
}

function normalizeAesKey(input) {
  const trimmed = String(input || '').trim();
  const withoutPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (withoutPrefix.length === 0) return '';
  if (!/^[0-9a-fA-F]+$/.test(withoutPrefix) || (withoutPrefix.length !== 32 && withoutPrefix.length !== 64)) {
    throw new Error('AES key must be 32 or 64 hex characters');
  }
  return withoutPrefix.toLowerCase();
}

module.exports = {
  AesKeySession,
  normalizeAesKey,
};
```

- [ ] **Step 2: Add analysis cache**

Create `analysis-cache.js`:

```js
const crypto = require('node:crypto');

function aesKeyFingerprint(key) {
  if (!key) return 'none';
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

class AnalysisCache {
  constructor() {
    this.entries = new Map();
  }

  makeKey(parts) {
    return [
      parts.analysisType,
      parts.paths.join('|').toLowerCase(),
      parts.fileStamp,
      aesKeyFingerprint(parts.aesKey),
    ].join('::');
  }

  get(key) {
    return this.entries.get(key);
  }

  set(key, value) {
    this.entries.set(key, value);
  }
}

module.exports = {
  AnalysisCache,
  aesKeyFingerprint,
};
```

- [ ] **Step 3: Add analysis service**

Create `analysis-service.js`:

```js
const fs = require('node:fs');
const { getContainerKind, resolveIoStoreSelection } = require('./container-pairing');
const { AnalysisCache } = require('./analysis-cache');
const { AesKeySession } = require('./aes-key-session');

function hasAesRequiredIssue(response) {
  return (response.issues || []).some((issue) => issue.code.endsWith('.aes_key_required'));
}

class AnalysisService {
  constructor({ backendClient, filePaths, aesSession = new AesKeySession(), cache = new AnalysisCache() }) {
    this.backendClient = backendClient;
    this.filePaths = filePaths;
    this.aesSession = aesSession;
    this.cache = cache;
  }

  analyze(filePath) {
    const kind = getContainerKind(filePath);
    if (kind === 'pak') return this.analyzePak(filePath);
    if (kind === 'utoc' || kind === 'ucas') return this.analyzeIoStore(filePath);
    return { status: 'Error', issues: [{ severity: 'error', code: 'container.unsupported', message: 'Unsupported container file type.' }] };
  }

  analyzePak(pakPath) {
    const aesKey = this.aesSession.getKey();
    const cacheKey = this.cache.makeKey({
      analysisType: 'pak',
      paths: [pakPath],
      fileStamp: fileStamp(pakPath),
      aesKey,
    });
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const result = this.backendClient.analyzePak({ pakPath, aesKey });
    this.cache.set(cacheKey, result);
    return result;
  }

  analyzeIoStore(selectedPath) {
    const resolved = resolveIoStoreSelection(selectedPath, this.filePaths);
    if (!resolved.ok) {
      return { status: 'Error', issues: [resolved.issue] };
    }
    const aesKey = this.aesSession.getKey();
    const cacheKey = this.cache.makeKey({
      analysisType: 'iostore',
      paths: [resolved.utocPath, resolved.ucasPath],
      fileStamp: `${fileStamp(resolved.utocPath)}|${fileStamp(resolved.ucasPath)}`,
      aesKey,
    });
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const result = this.backendClient.analyzeIoStore({ utocPath: resolved.utocPath, ucasPath: resolved.ucasPath, aesKey });
    this.cache.set(cacheKey, result);
    return result;
  }
}

function fileStamp(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
}

module.exports = {
  AnalysisService,
  hasAesRequiredIssue,
};
```

- [ ] **Step 4: Add tests**

Test that:

```text
normalizeAesKey accepts 0x prefix.
normalizeAesKey rejects non-hex input.
AnalysisService calls analyzePak for .pak.
AnalysisService returns iostore.pair_missing before backend for orphan .ucas.
AnalysisService reuses cache for repeated calls with the same file stamp and AES key.
```

- [ ] **Step 5: Run tests and commit**

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
git add node-shell/packages/analysis-domain
git commit -m "Add analysis domain service"
```

## Task 9: Add Desktop Main Process And IPC

**Files:**
- Create: `node-shell/bin/upi-gui.js`
- Create: `node-shell/bin/upi-cli.js`
- Create: `node-shell/apps/desktop/main.js`
- Create: `node-shell/apps/desktop/preload.js`

- [ ] **Step 1: Add GUI launcher**

Create `node-shell/bin/upi-gui.js`:

```js
const path = require('node:path');
const { spawn } = require('node:child_process');
const koffi = require('koffi');
const { DEFAULT_ENGINE_ROOT, buildDllSearchPath, resolveDllPath } = require('../packages/backend-core/src/backend-config');
const { createBackendClient } = require('../packages/backend-core/src/backend-client');

function main(argv = process.argv) {
  const dllPath = resolveDllPath(argv[2] || process.env.UPI_BACKEND_DLL);
  const engineRoot = process.env.UPI_ENGINE_ROOT || DEFAULT_ENGINE_ROOT;
  process.env.PATH = buildDllSearchPath({ dllPath, engineRoot, existingPath: process.env.PATH || '' });
  createBackendClient({ dllPath, koffi }).getBackendInfo();

  const electronPath = require('electron');
  const mainPath = path.join(__dirname, '..', 'apps', 'desktop', 'main.js');
  const child = spawn(electronPath, [mainPath], {
    stdio: 'inherit',
    env: { ...process.env, UPI_BACKEND_DLL: dllPath, UPI_ENGINE_ROOT: engineRoot },
  });
  child.on('exit', (code) => {
    process.exitCode = code || 0;
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
```

- [ ] **Step 2: Add CLI placeholder**

Create `node-shell/bin/upi-cli.js`:

```js
function main() {
  console.log('UnrealPackageInsight CLI commands are unavailable in this phase. Use npm run gui to start the desktop app.');
}

if (require.main === module) {
  main();
}

module.exports = { main };
```

- [ ] **Step 3: Add Electron main**

Create `apps/desktop/main.js` with:

```js
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const koffi = require('koffi');
const { createBackendClient } = require('../../packages/backend-core/src/backend-client');
const { scanPackageDirectory } = require('../../packages/analysis-domain/src/package-scan');
const { AnalysisService } = require('../../packages/analysis-domain/src/analysis-service');
const { AesKeySession } = require('../../packages/analysis-domain/src/aes-key-session');

let backendClient;
let currentScan;
let analysisService;
const aesSession = new AesKeySession();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  backendClient = createBackendClient({ dllPath: process.env.UPI_BACKEND_DLL, koffi });
  createWindow();
});

ipcMain.handle('backend:getInfo', () => backendClient.getBackendInfo());

ipcMain.handle('package:openDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  currentScan = await scanPackageDirectory(result.filePaths[0]);
  analysisService = new AnalysisService({ backendClient, filePaths: currentScan.files.map((file) => file.path), aesSession });
  return currentScan;
});

ipcMain.handle('analysis:analyze', async (_event, filePath) => analysisService.analyze(filePath));

ipcMain.handle('analysis:submitAesKeyAndRetry', async (_event, { filePath, aesKey }) => {
  aesSession.setKey(aesKey);
  return analysisService.analyze(filePath);
});

ipcMain.handle('analysis:clearAesKey', () => {
  aesSession.clear();
  return true;
});
```

- [ ] **Step 4: Add preload bridge**

Create `apps/desktop/preload.js`:

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('upi', {
  getBackendInfo: () => ipcRenderer.invoke('backend:getInfo'),
  openPackageDirectory: () => ipcRenderer.invoke('package:openDirectory'),
  analyze: (filePath) => ipcRenderer.invoke('analysis:analyze', filePath),
  submitAesKeyAndRetry: (filePath, aesKey) => ipcRenderer.invoke('analysis:submitAesKeyAndRetry', { filePath, aesKey }),
  clearAesKey: () => ipcRenderer.invoke('analysis:clearAesKey'),
});
```

- [ ] **Step 5: Run tests and commit**

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
git add node-shell/bin node-shell/apps/desktop/main.js node-shell/apps/desktop/preload.js
git commit -m "Add Electron main process"
```

## Task 10: Build Desktop Renderer

**Files:**
- Create: `node-shell/apps/desktop/renderer/index.html`
- Create: `node-shell/apps/desktop/renderer/renderer.js`
- Create: `node-shell/apps/desktop/renderer/styles.css`

- [ ] **Step 1: Add HTML shell**

Create `index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UnrealPackageInsight</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main class="app-shell">
    <aside class="sidebar">
      <div class="toolbar">
        <button id="open-directory">Open</button>
      </div>
      <div id="tree" class="tree"></div>
    </aside>
    <section class="main-panel">
      <header class="main-header">
        <div id="backend-info"></div>
        <div id="selected-file"></div>
      </header>
      <nav id="tabs" class="tabs"></nav>
      <section id="content" class="content"></section>
    </section>
  </main>
  <dialog id="aes-dialog">
    <form method="dialog">
      <label>AES Key <input id="aes-key" autocomplete="off"></label>
      <menu>
        <button value="cancel">Cancel</button>
        <button id="submit-aes" value="default">Analyze</button>
      </menu>
    </form>
  </dialog>
  <script src="./renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add renderer behavior**

Create `renderer.js` that:

```text
loads backend info on startup
opens directory through window.upi.openPackageDirectory()
renders tree nodes from scan result
calls window.upi.analyze(file.path) on supported file click
detects issue codes ending in .aes_key_required
opens AES dialog and retries through submitAesKeyAndRetry
renders tabs based on result shape:
  Pak: Overview, Packages, Blocks, Issues
  IoStore: Overview, Packages, Chunks, Blocks, Issues
```

Use `textContent`, not HTML string concatenation, for table cells.

- [ ] **Step 3: Add restrained desktop CSS**

Create `styles.css` with:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #172033; background: #f5f7fb; }
.app-shell { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
.sidebar { border-right: 1px solid #d8dee8; background: #fbfcfe; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
.toolbar { padding: 10px; border-bottom: 1px solid #d8dee8; }
button { min-height: 30px; border: 1px solid #b9c4d4; background: #fff; border-radius: 6px; padding: 4px 10px; }
.tree { overflow: auto; padding: 8px; font-size: 13px; }
.tree button { display: block; width: 100%; border: 0; background: transparent; text-align: left; padding: 3px 6px; border-radius: 4px; }
.tree button:hover, .tree button.selected { background: #e7eefb; }
.main-panel { min-width: 0; display: grid; grid-template-rows: auto auto 1fr; }
.main-header { padding: 10px 14px; border-bottom: 1px solid #d8dee8; background: #fff; }
.tabs { display: flex; gap: 4px; padding: 8px 14px; border-bottom: 1px solid #d8dee8; background: #f9fbfe; }
.tab.active { background: #244f9e; color: white; border-color: #244f9e; }
.content { overflow: auto; padding: 14px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; background: #fff; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; white-space: nowrap; }
```

- [ ] **Step 4: Run tests and launch GUI**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
$env:UPI_BACKEND_DLL = "C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
npm run gui -- $env:UPI_BACKEND_DLL
```

Expected: Electron window opens, backend info appears, Open button triggers directory picker.

- [ ] **Step 5: Commit**

```powershell
git add node-shell/apps/desktop/renderer
git commit -m "Add desktop renderer shell"
```

## Task 11: Replace Pak Stub With UE Pak Analyzer

**Files:**
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/PakAnalyzer.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/PakAnalyzer.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`

- [ ] **Step 1: Add PakFile dependency**

Modify Build.cs dependencies:

```csharp
PublicDependencyModuleNames.AddRange(
	new string[]
	{
		"Core",
		"PakFile"
	}
);
```

- [ ] **Step 2: Add Pak analysis model**

Create `PakAnalyzer.h`:

```cpp
#pragma once

#include "Containers/Array.h"
#include "Containers/StringFwd.h"
#include "CoreTypes.h"

struct FUpiPakPackageRecord
{
	FString PackagePath;
	FString MountPoint;
	uint64 Offset = 0;
	uint64 PayloadOffset = 0;
	uint64 Size = 0;
	uint64 CompressedSize = 0;
	uint64 RecordSize = 0;
	FString Compression;
	uint32 CompressionMethodIndex = 0;
	uint32 CompressionBlockSize = 0;
	uint32 CompressionBlockCount = 0;
	uint32 FirstCompressedBlockIndex = 0;
	bool bRelativeBlockOffsets = false;
	uint32 Order = 0;
	uint32 Flags = 0;
	FString Hash;
	bool bHasPath = false;
};

struct FUpiPakCompressedBlockRecord
{
	uint32 PackageIndex = 0;
	uint32 BlockIndex = 0;
	uint64 CompressedStart = 0;
	uint64 CompressedEnd = 0;
	uint64 CompressedSize = 0;
	uint64 DiskSize = 0;
	uint64 PhysicalStart = 0;
	uint64 PhysicalEnd = 0;
};

struct FUpiPakAnalysis
{
	FString PakPath;
	FString MountPoint;
	uint32 PakVersion = 0;
	uint64 PakSize = 0;
	bool bIndexEncrypted = false;
	FString EncryptionKeyGuid;
	bool bHasFullDirectoryIndex = true;
	bool bPartialListing = false;
	TArray<FString> Issues;
	TArray<FUpiPakPackageRecord> Packages;
	TArray<FUpiPakCompressedBlockRecord> CompressedBlocks;
};

bool UPI_AnalyzePakFile(const FString& PakPath, const FString& AesKey, FUpiPakAnalysis& OutAnalysis);
```

- [ ] **Step 3: Implement Pak analyzer with `FPakFile`**

Create `PakAnalyzer.cpp` using `FPakFile::FPakEntryIterator`. Populate fields according to the spec:

```text
Offset = Entry.Offset
PayloadOffset = Entry.Offset + Entry.GetSerializedSize(PakVersion)
Size = Entry.UncompressedSize
CompressedSize = Entry.Size
RecordSize = PayloadOffset - Offset + CompressedSize
CompressionBlockCount = Entry.CompressionBlocks.Num()
Order = index after sorting by Offset
```

Add `pak.aes_key_required` issue when the index is encrypted and no AES key is available.

- [ ] **Step 4: Build FlatBuffer from analysis model**

Modify `UPI_BuildPakStubResponse` into `UPI_BuildPakResponseFromAnalysis`. Keep the exported function name `UPI_AnalyzePakV1`; only replace internals.

- [ ] **Step 5: Build and compare with UnrealPak**

Run:

```powershell
.\scripts\stage-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine
.\scripts\build-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine -Configuration Development
```

For `C:\WORKSPACE_UE\UnrealPackageInsight\artifacts\manual-test\pakchunk0-Windows.pak`, compare package count and sample paths with:

```powershell
& C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPak.exe C:\WORKSPACE_UE\UnrealPackageInsight\artifacts\manual-test\pakchunk0-Windows.pak -List
```

- [ ] **Step 6: Commit**

```powershell
git add ue-backend/UnrealPackageInsightBackend
git commit -m "Implement Pak analysis backend"
```

## Task 12: Replace IoStore Stub With UE IoStore Analyzer

**Files:**
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/IoStoreAnalyzer.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/IoStoreAnalyzer.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Private/UpiFlatBufferBuilders.cpp`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`

- [ ] **Step 1: Add IoStore analysis model**

Create `IoStoreAnalyzer.h` with records matching the spec:

```text
FUpiIoStoreOverview
FUpiIoStorePartitionRecord
FUpiIoStorePackageRecord
FUpiIoStoreChunkRecord
FUpiIoStoreCompressedBlockRecord
FUpiIoStoreAnalysis
```

Use `uint64` for FlatBuffers `ulong` fields and `uint32` for FlatBuffers `uint` fields.

- [ ] **Step 2: Implement chunk enumeration**

Use `FIoStoreReader` to initialize the container base path and enumerate chunks. Populate:

```text
tocEntryIndex
chunkId
chunkType
packageId
logicalOffset = ChunkInfo.Offset
offset = ChunkInfo.OffsetOnDisk
partitionIndex = ChunkInfo.PartitionIndex
size = ChunkInfo.Size
compressedSize = ChunkInfo.CompressedSize
blockCount = ChunkInfo.NumCompressedBlocks
```

Sort chunks by `(partitionIndex, offset, tocEntryIndex)`, then assign `order`.

- [ ] **Step 3: Implement package aggregation**

Group chunks by `(packageId, packagePath)` when `packageId != 0`; otherwise keep non-package chunks out of the package table and leave their `packageIndex` as an invalid sentinel such as `UINT32_MAX`.

For each package:

```text
firstChunkIndex = first chunk in sorted chunk table
chunkCount = grouped chunk count
firstPartitionIndex = min partition index
firstOffset = min chunk offset
size = sum chunk size
compressedSize = sum chunk compressedSize
diskSize = sum chunk diskSize
```

- [ ] **Step 4: Implement compressed block enumeration**

Use `FIoStoreReader::EnumerateCompressedBlocksForChunk` to enumerate compressed blocks for chunks. If the local signature differs from the sketch in `docs/spikes/pak-iostore-container-layout-research.md`, add a private helper in `IoStoreAnalyzer.cpp` named `UPI_EnumerateCompressedBlocksForChunk` that adapts the local signature and returns records with these exact fields:

```text
blockIndex
ownerTocEntryIndex
partitionIndex
offset
ucasOffset
compressedSize
diskSize = Align(compressedSize, FAES::AESBlockSize)
uncompressedSize
compression
```

- [ ] **Step 5: Build FlatBuffer from IoStore analysis model**

Replace IoStore stub response internals with the real model builder while keeping exported function `UPI_AnalyzeIoStoreV1`.

- [ ] **Step 6: Build and verify**

Run:

```powershell
.\scripts\stage-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine
.\scripts\build-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine -Configuration Development
```

Verify with an indexed IoStore package:

```text
Overview shows tocEntryCount > 0.
Chunks tab shows chunk rows.
Packages tab shows grouped package rows where packageId is available.
Selecting .ucas and .utoc yields the same IoStore analysis.
```

- [ ] **Step 7: Commit**

```powershell
git add ue-backend/UnrealPackageInsightBackend
git commit -m "Implement IoStore analysis backend"
```

## Task 13: End-To-End GUI Verification

**Files:**
- Modify only if verification reveals a defect in files touched by earlier tasks.

- [ ] **Step 1: Build backend**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
.\scripts\stage-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine
.\scripts\build-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine -Configuration Development
```

Expected: DLL path printed.

- [ ] **Step 2: Run Node tests**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Launch GUI**

Run:

```powershell
$env:UPI_ENGINE_ROOT = "C:\WORKSPACE_UE\UnrealEngine"
$env:UPI_BACKEND_DLL = "C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
npm run gui -- $env:UPI_BACKEND_DLL
```

Expected:

```text
Electron window opens.
Backend info appears.
Open button opens folder picker.
Package tree shows .pak/.utoc/.ucas files.
Selecting .pak fills Overview, Packages, Blocks, Issues.
Selecting .utoc fills Overview, Packages, Chunks, Blocks, Issues.
Selecting .ucas resolves the paired .utoc.
Missing pair shows iostore.pair_missing.
```

- [ ] **Step 4: Commit final verification fixes**

If verification required fixes, stage the exact files listed by `git status --short`:

```powershell
git status --short
git add path\to\changed-file-1 path\to\changed-file-2
git commit -m "Verify desktop package analysis flow"
```

If no fixes were needed, record the successful commands in the final response instead of creating an empty commit.
