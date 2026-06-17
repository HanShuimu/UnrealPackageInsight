# UnrealPackageInsight Project Architecture Design

Date: 2026-06-15

## Purpose

Define the first production architecture after the UE Program DLL spike.

The first product version is an Electron desktop tool for inspecting Unreal Engine 5 Windows packaged build directories. It opens a package directory, shows UE container files in a left tree, and analyzes selected `.pak`, `.utoc`, or `.ucas` files on demand.

The design keeps DLL loading, binary protocol decoding, package directory scanning, container pairing, and analysis orchestration outside the UI so the same core can support a CLI later. The CLI entrypoint may exist as a placeholder in this phase, but CLI behavior is not part of this implementation scope.

## Existing Context

The repository already contains a successful UE DLL backend spike:

- `ue-backend/UnrealPackageInsightBackend` builds as a UE Program DLL.
- `node-shell` loads the DLL through `koffi`.
- `scripts/stage-ue-backend.ps1` stages the backend into the source-built engine tree.
- `scripts/build-ue-backend.ps1` builds the DLL and locates the artifact.
- `docs/spikes/ue-dll-backend-spike.md` records the build and Node FFI smoke result.

The architecture also uses the container research in:

- `docs/spikes/pak-iostore-container-layout-research.md`
- `docs/spikes/pak-iostore-resource-entry-schema.md`

Key research conclusions used here:

- Pak entries are based on `FPakEntry`.
- Pak physical ordering should use `FPakEntry::Offset`.
- IoStore metadata comes from `.utoc`; `.ucas` alone does not contain a resource list.
- IoStore physical ordering should use `FIoStoreTocChunkInfo::OffsetOnDisk`, not the logical `FIoStoreTocChunkInfo::Offset`.
- IoStore should expose chunk and compressed block data; package-level rows are an aggregation over chunk data.

## First Version Scope

In scope:

- Electron desktop GUI.
- Open a UE5 Windows packaged build directory.
- Left file tree focused on `.pak`, `.utoc`, `.ucas` files and their parent folders.
- On-demand analysis when a supported file is selected.
- Pak analysis through a dedicated DLL API.
- IoStore analysis through a dedicated DLL API.
- `.utoc` / `.ucas` pairing in Node before calling the DLL.
- AES key prompt when analysis reports that a key is required.
- AES key kept only in memory for the current GUI session.
- FlatBuffers response protocol from DLL to Node.
- Shared Node backend modules so future CLI code does not depend on Electron internals.
- A CLI entrypoint file may be present, but implemented as a placeholder.

Out of scope:

- Implementing CLI commands.
- Persisting AES keys.
- Managing multiple AES keys or key maps.
- Artificial entry limits.
- String table optimization in the protocol.
- A separate layout visualization protocol field.
- Hand-written binary parsing of Pak or IoStore in Node.
- Reading `.ucas` as an independent resource index without its `.utoc`.

## User Experience

The GUI uses a two-pane desktop layout:

- Left pane: package directory tree.
- Right pane: analysis panel for the selected container file.

Right panel tabs depend on the analysis type:

- Pak: `Overview | Packages | Blocks | Issues`
- IoStore: `Overview | Packages | Chunks | Blocks | Issues`

Opening a package directory should feel fast. The app scans the directory and builds the tree, but does not deeply analyze every container up front.

Selecting a supported file triggers on-demand analysis:

- Selecting `.pak` calls Pak analysis.
- Selecting `.utoc` resolves its `.ucas` partition files, then calls IoStore analysis.
- Selecting `.ucas` resolves its owning `.utoc`, then calls IoStore analysis.

If pairing fails, the right panel shows an issue without calling the DLL.

## High-Level Architecture

```text
ue-backend/
  UnrealPackageInsightBackend/
    C ABI exports
    Pak analyzer
    IoStore analyzer
    FlatBuffers response builders

node-shell/
  packages/
    protocol/
      .fbs schemas
      generated C++ and JS/TS bindings
    backend-core/
      backend config resolution
      DLL search path setup
      koffi bindings
      FlatBuffers response decoding
      BackendClient
    analysis-domain/
      package directory scanning
      container file classification
      .utoc/.ucas pairing
      AES key session cache
      on-demand analysis orchestration
      result cache
  apps/
    desktop/
      Electron main process
      Electron renderer
  bin/
    upi-gui.js
    upi-cli.js placeholder
```

`backend-core` and `analysis-domain` must not depend on Electron renderer code. Electron is a consumer of the shared core, not the owner of it.

## GUI Startup

The GUI entrypoint first validates that the backend can be loaded:

```text
upi-gui
  -> backend-core.resolveBackendConfig()
  -> backend-core.loadBackend()
  -> backend-core.getBackendInfo()
  -> launch Electron
```

Electron main process then uses the same `backend-core` code for runtime analysis.

DLL handles are process-local. The preflight load in `upi-gui` and the runtime load in Electron main are separate loads. The shared guarantee is code and protocol reuse, not sharing a DLL instance between processes.

## UE DLL API

Pak and IoStore are separate APIs. Do not route both through a generic `AnalyzeContainer` entrypoint.

The input side uses simple C ABI arguments because first-version requests only need paths and an optional AES key. The output side uses FlatBuffers bytes because analysis results can be large.

```cpp
UPI_CallStatus UPI_GetBackendInfoV1(
    uint8_t* OutBytes,
    int32_t OutCapacity,
    int32_t* RequiredSize);

UPI_CallStatus UPI_AnalyzePakV1(
    const char* PakPathUtf8,
    const char* AesKeyUtf8OrNull,
    uint8_t* OutBytes,
    int32_t OutCapacity,
    int32_t* RequiredSize);

UPI_CallStatus UPI_AnalyzeIoStoreV1(
    const char* UtocPathUtf8,
    const char* UcasPathUtf8,
    const char* AesKeyUtf8OrNull,
    uint8_t* OutBytes,
    int32_t OutCapacity,
    int32_t* RequiredSize);
```

Path and key rules:

- Paths are UTF-8.
- Node passes absolute normalized paths.
- The DLL converts UTF-8 paths to UE string types internally.
- AES key may be null or empty.
- AES key accepts 32 or 64 hex characters, with optional `0x` prefix.
- AES key validation errors are returned as protocol issues.

Call status:

```text
UPI_CALL_OK
UPI_CALL_BUFFER_TOO_SMALL
UPI_CALL_BAD_ARGUMENT
UPI_CALL_INTERNAL_ERROR
```

`UPI_CALL_BUFFER_TOO_SMALL` sets `RequiredSize`; Node reallocates and calls again.

Business failures such as missing AES key are not represented as `UPI_CALL_INTERNAL_ERROR`. They return `UPI_CALL_OK` with a FlatBuffers response whose `status` is `Error` and whose `issues` explain the cause.

## Protocol Strategy

Use FlatBuffers for DLL responses.

Do not use a single global `UpiResult` with `ResultKind` and a union payload. Each DLL interface has its own response root type. Shared schema files only define cross-cutting primitives.

Schema layout:

```text
protocol/
  upi_common.fbs
  upi_backend_info.fbs
  upi_pak_analysis.fbs
  upi_iostore_analysis.fbs
```

Common concepts:

```text
ResponseStatus:
  Ok
  Error

IssueSeverity:
  Info
  Warning
  Error

Issue:
  severity
  code
  message
```

Issue codes are strings, not a global enum. Codes are namespaced by API:

```text
pak.aes_key_required
pak.aes_key_invalid
pak.index_corrupted
pak.partial_listing
iostore.aes_key_required
iostore.aes_key_invalid
iostore.pair_missing
iostore.directory_index_missing
iostore.toc_corrupted
```

This avoids central enum growth as new APIs and analyzers are added.

Each response has a FlatBuffers file identifier:

```text
BackendInfoResponse: UPBI
PakAnalysisResponse: UPPA
IoStoreAnalysisResponse: UPIO
```

Node uses the decoder corresponding to the function it called.

## Backend Info Response

```text
BackendInfoResponse:
  schemaVersion: uint
  status: ResponseStatus
  issues: [Issue]
  backendName: string
  backendVersion: string
  unrealVersion: string
  protocolVersion: uint
```

This response is used by GUI startup preflight and by Electron main runtime initialization.

## Pak Analysis Response

Pak response is centered on `FPakEntry`.

```text
PakAnalysisResponse:
  schemaVersion: uint
  status: ResponseStatus
  issues: [Issue]
  overview: PakOverview
  packages: [PakPackageEntry]
  compressedBlocks: [PakCompressedBlockEntry]
```

### PakOverview

```text
PakOverview:
  pakPath: string
  mountPoint: string
  pakVersion: uint
  pakSize: ulong
  indexEncrypted: bool
  encryptionKeyGuid: string
  hasFullDirectoryIndex: bool
  partialListing: bool
  packageCount: uint
  compressedBlockCount: uint
```

`partialListing` is true when the backend can enumerate entries but cannot recover complete logical paths, such as a pak without a full directory index.

### PakPackageEntry

```text
PakPackageEntry:
  packagePath: string
  mountPoint: string
  offset: ulong
  payloadOffset: ulong
  size: ulong
  compressedSize: ulong
  recordSize: ulong
  compression: string
  compressionMethodIndex: uint
  compressionBlockSize: uint
  compressionBlockCount: uint
  firstCompressedBlockIndex: uint
  relativeBlockOffsets: bool
  order: uint
  flags: uint
  hash: string
  hasPath: bool
```

Field meanings:

- `packagePath`: logical path from the pak index, preferably normalized as mount point plus filename.
- `offset`: `FPakEntry::Offset`; the record header start in the pak file.
- `payloadOffset`: `FPakEntry.Offset + FPakEntry.GetSerializedSize(PakVersion)`.
- `size`: `FPakEntry::UncompressedSize`.
- `compressedSize`: `FPakEntry::Size`.
- `recordSize`: `payloadOffset - offset + compressedSize`.
- `compression`: `FPakInfo::CompressionMethods[CompressionMethodIndex]`, or `None`.
- `order`: generated by sorting packages by `offset`.
- `flags`: raw `FPakEntry::Flags`.
- `hash`: SHA1 hash from `FPakEntry::Hash`, encoded as hex.
- `hasPath`: false when the path cannot be recovered.

### PakCompressedBlockEntry

```text
PakCompressedBlockEntry:
  packageIndex: uint
  blockIndex: uint
  compressedStart: ulong
  compressedEnd: ulong
  compressedSize: ulong
  diskSize: ulong
  physicalStart: ulong
  physicalEnd: ulong
```

`physicalStart` resolves relative compressed block offsets when needed. `diskSize` includes AES alignment when required.

## IoStore Analysis Response

IoStore response is centered on `.utoc` metadata. `.ucas` is treated as backing data, not as an independent resource index.

```text
IoStoreAnalysisResponse:
  schemaVersion: uint
  status: ResponseStatus
  issues: [Issue]
  overview: IoStoreOverview
  partitions: [IoStorePartition]
  packages: [IoStorePackageEntry]
  chunks: [IoStoreChunkEntry]
  compressedBlocks: [IoStoreCompressedBlockEntry]
```

`packages` is an aggregation over chunks. `chunks` and `compressedBlocks` are the lower-level factual tables.

### IoStoreOverview

```text
IoStoreOverview:
  utocPath: string
  containerBasePath: string
  containerId: ulong
  tocVersion: uint
  tocEntryCount: uint
  compressionBlockCount: uint
  compressionBlockSize: uint
  partitionCount: uint
  partitionSize: ulong
  containerFlags: uint
  encryptionKeyGuid: string
  directoryIndexSize: uint
  indexed: bool
  partialListing: bool
```

`partialListing` is true when chunk metadata is available but logical file paths are incomplete, such as a non-indexed IoStore container.

### IoStorePartition

```text
IoStorePartition:
  partitionIndex: uint
  ucasPath: string
  size: ulong
```

Partition `0` is the main `.ucas`. Later partitions may use names such as `*_sN.ucas`.

### IoStorePackageEntry

```text
IoStorePackageEntry:
  packagePath: string
  packageId: ulong
  firstChunkIndex: uint
  chunkCount: uint
  firstPartitionIndex: uint
  firstOffset: ulong
  size: ulong
  compressedSize: ulong
  diskSize: ulong
  order: uint
  hasPath: bool
```

This table is a UI-friendly package aggregation. Grouping uses `packageId` and `packagePath` where available. A single package may contain multiple chunks such as export bundle data, bulk data, optional bulk data, and memory-mapped bulk data.

### IoStoreChunkEntry

```text
IoStoreChunkEntry:
  packageIndex: uint
  packagePath: string
  tocEntryIndex: uint
  chunkId: string
  chunkType: string
  packageId: ulong
  chunkIndex: uint
  bulkDataCookedIndex: uint
  logicalOffset: ulong
  offset: ulong
  ucasOffset: ulong
  size: ulong
  compressedSize: ulong
  diskSize: ulong
  compression: string
  firstBlockIndex: uint
  blockCount: uint
  partitionIndex: uint
  order: uint
  metaFlags: uint
  containerFlags: uint
  hash: string
  hasPath: bool
```

Field meanings:

- `tocEntryIndex`: TOC entry index.
- `chunkId`: 12-byte `FIoChunkId`, encoded as hex.
- `chunkType`: `EIoChunkType` name such as `ExportBundleData`, `BulkData`, `OptionalBulkData`, or `MemoryMappedBulkData`.
- `packageId`: package-related chunk id prefix; 0 for non-package chunks.
- `logicalOffset`: `FIoStoreTocChunkInfo::Offset`; logical uncompressed offset, not physical disk offset.
- `offset`: `FIoStoreTocChunkInfo::OffsetOnDisk`; global physical offset.
- `ucasOffset`: partition-relative offset.
- `size`: uncompressed chunk size.
- `compressedSize`: effective compressed byte count, not including AES padding.
- `diskSize`: actual disk span, including AES-aligned block sizes.
- `compression`: `None`, a method name, or `Mixed`.
- `order`: generated by sorting `(partitionIndex, offset, tocEntryIndex)`.
- `metaFlags`: `FIoStoreTocEntryMetaFlags`.
- `containerFlags`: `EIoContainerFlags`.
- `hash`: chunk hash encoded as hex.

### IoStoreCompressedBlockEntry

```text
IoStoreCompressedBlockEntry:
  blockIndex: uint
  ownerTocEntryIndex: uint
  partitionIndex: uint
  offset: ulong
  ucasOffset: ulong
  compressedSize: uint
  diskSize: uint
  uncompressedSize: uint
  compression: string
```

`offset` is the global physical offset from `FIoStoreTocCompressedBlockEntry::GetOffset()`. `ucasOffset` is partition-relative. `diskSize` aligns `compressedSize` to AES block size.

## Directory Scan And Pairing

Opening a package directory does not call Pak or IoStore analysis.

```text
openPackageDirectory(root)
  -> recursively scan root
  -> keep supported files: .pak, .utoc, .ucas
  -> keep required parent folder nodes
  -> classify container files
  -> pair .utoc and .ucas by directory and basename
  -> detect partitioned .ucas files
  -> return tree model
```

Pairing rules:

- `.pak` stands alone.
- `.utoc` is the IoStore metadata file.
- `.ucas` is the IoStore data file.
- Selecting `.utoc` requires at least its matching `.ucas`.
- Selecting `.ucas` requires its matching `.utoc`.
- If pair resolution fails, return an `iostore.pair_missing` issue without calling the DLL.

## On-Demand Analysis Flow

```text
select supported file
  -> analysis-domain resolves target type
  -> analysis-domain resolves paths and AES key
  -> backend-core calls corresponding C ABI function
  -> backend-core decodes FlatBuffer response
  -> analysis-domain caches response
  -> Electron main returns view model over IPC
  -> renderer fills tabs
```

Cache key:

```text
analysisType
canonical input paths
file mtime and size
AES key fingerprint
```

The AES key fingerprint is only used for cache separation. It is not shown in the UI and is not persisted.

## AES Key Handling

AES keys are kept only in memory for the current GUI session.

Flow:

```text
analyze selected container
  -> response.status == Error
  -> issue code ends with .aes_key_required
  -> renderer shows AES key dialog
  -> user submits key
  -> Electron main stores key in AesKeySession
  -> analysis-domain retries current analysis
```

The renderer must not persist the key. The main process must not write it to disk.

## Electron IPC

Electron main owns filesystem, backend, AES key, and cache state.

Renderer requests:

```text
getBackendInfo()
openPackageDirectory(root)
analyzeSelectedContainer(nodeId)
submitAesKeyAndRetry(requestId, aesKey)
clearSessionAesKey()
```

Renderer responses are view models, not raw FlatBuffers. FlatBuffer decoding belongs in `backend-core`.

## Error Handling

Errors have three layers:

```text
C ABI call status:
  function invocation, buffer sizing, argument validity, unexpected native failure

FlatBuffer response.status:
  whether the specific analysis result is usable

Issue:
  specific business or format condition
```

Examples:

- Missing AES key:
  - C ABI: `UPI_CALL_OK`
  - response: `Error`
  - issue: `pak.aes_key_required` or `iostore.aes_key_required`

- Missing `.utoc` for selected `.ucas`:
  - No DLL call
  - analysis-domain returns a view model with `iostore.pair_missing`

- Missing directory index:
  - C ABI: `UPI_CALL_OK`
  - response: `Ok`
  - issue: `iostore.directory_index_missing`
  - `partialListing: true`

## Testing Strategy

### backend-core

- Resolves backend DLL path.
- Prepends DLL directory and Engine `Binaries/Win64` to search path.
- Binds C ABI functions with expected signatures.
- Handles `UPI_CALL_BUFFER_TOO_SMALL` by retrying with `RequiredSize`.
- Decodes BackendInfo, PakAnalysis, and IoStoreAnalysis FlatBuffers.
- Rejects buffers with wrong file identifiers.

### analysis-domain

- Scans package directories and filters `.pak`, `.utoc`, `.ucas`.
- Keeps parent folders needed for the tree.
- Pairs `.utoc` and `.ucas`.
- Resolves selected `.ucas` back to `.utoc`.
- Returns pair-missing issues before DLL calls.
- Caches analysis by input path metadata and AES key fingerprint.
- Triggers retry flow for `*.aes_key_required`.

### UE backend

- Builds as a UE Program DLL.
- Exports all expected V1 C ABI functions.
- Produces valid FlatBuffers for backend info.
- Produces valid Pak response fixtures.
- Produces valid IoStore response fixtures.
- Distinguishes missing AES key from corrupt containers.

### Cross-language fixtures

C++ generates fixed `.bin` fixtures:

```text
backend-info.bin
pak-basic.bin
pak-aes-required.bin
iostore-basic.bin
iostore-partial-listing.bin
```

Node decoder tests read the same fixtures and verify fields exactly. This keeps C++ writing and Node reading synchronized through the generated FlatBuffers schema.

### Desktop smoke

Manual first-version smoke flow:

```text
start GUI
open package directory
select pak
select utoc
select ucas
verify missing pair issue
verify AES key dialog appears when required
verify retry fills tabs after key submission
```

## Future CLI Placeholder

The repository may include a CLI entrypoint file to reserve package structure and future executable naming. For this phase it should do no real work beyond printing that CLI commands are not implemented.

Future CLI commands can reuse:

- `backend-core`
- `analysis-domain`
- generated protocol decoders

No first-version desktop code should need to be moved out of Electron to enable that future CLI.

## Design Decisions

- Use Electron for the first GUI.
- Analyze on demand, not on directory open.
- Keep AES keys only in process memory.
- Use C ABI strings for request arguments.
- Use FlatBuffers for response payloads.
- Keep Pak and IoStore DLL APIs separate.
- Keep response root types separate per API.
- Use string issue codes instead of global issue enums.
- Do not include `layout` in the first protocol.
- Do not implement CLI behavior in this phase.

## Open Risks

- Some shipped pak files may not include a full directory index, causing partial listings.
- Non-indexed IoStore containers may not expose logical package paths.
- Large FlatBuffers may require careful memory handling in both UE and Node.
- In-process DLL failures can terminate Electron main. The first implementation keeps the API narrow; if stability becomes a problem, `backend-core` can later move the DLL into a worker process while preserving the same public client interface.
- Exact IoStore partition discovery may require internal UE APIs beyond public `FIoStoreReader` in order to expose all desired fields.
