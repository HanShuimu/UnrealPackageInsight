# Container Extract Design

Date: 2026-06-23

## Goal

Add an `Extract to...` action to the Packages tab for `.pak`, `.utoc`, and `.ucas` containers. The user chooses an output directory, and the app extracts files from the selected container into that directory.

The extraction behavior should match UnrealPak and the engine utilities as closely as possible. UPI should not add its own custom mount point path calculation. Path handling, including `-ExtractToMountPoint` semantics and the safe hash-directory fallback for paths that would escape the destination, should come from the same engine utility behavior used by UnrealPak.

## User Experience

The Packages tab gains a top-row `Extract to...` button beside the existing Table/Tree mode control.

When clicked:

1. Electron opens a native directory picker.
2. If the user cancels, nothing is extracted and the status becomes `Extract canceled`.
3. If the user selects a directory, the selected container is extracted to that directory.
4. While extraction runs, the app shows `Extracting...` and disables duplicate extraction starts for the same UI session.
5. On success, the status shows a concise success message such as `Extract complete`.
6. On failure, the status shows `Extract failed` and the analysis issues area receives a readable error result.

The action applies to the currently selected analyzed container, not to a selected package row inside the table.

## Native Backend

Add native backend exports:

- `UPI_ExtractPakV1(const char* PakPathUtf8, const char* OutputDirectoryUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)`
- `UPI_ExtractIoStoreV1(const char* UtocPathUtf8, const char* UcasPathUtf8, const char* OutputDirectoryUtf8, const char* AesKeyUtf8OrNull, uint8_t* OutBytes, int32_t OutCapacity, int32_t* RequiredSize)`

These follow the existing buffered FlatBuffer-style ABI pattern used by analysis exports.

Pak extraction should reuse UnrealPak/PakFileUtilities behavior instead of implementing independent path derivation. The implementation should route through the engine's `PakFileUtilities` extraction command path with `-ExtractToMountPoint`, so behavior follows UnrealPak. If this engine command path cannot be safely invoked from the DLL runtime, the implementation should stop and report that blocker rather than adding UPI-specific mount point rules.

IoStore extraction should call the public `ExtractFilesFromIoStoreContainer(...)` API from `IoStoreUtilities`.

AES keys should be passed through an engine `FKeyChain` in the same style as UnrealPak. The key currently held by the GUI AES session is supplied as the active key. Missing or invalid key failures should return extract issues that mirror existing analysis issue style.

## Protocol

Add a small extract response schema, for example:

- `schemaVersion`
- `status`
- `issues`
- `outputDirectory`
- `containerPath`
- `extractedFileCount`, if available from the chosen engine path
- `errorCount`, if available

The design does not require per-file progress in the first version. If the reused engine path only returns success/failure, file counts can be omitted or left as zero.

Generated protocol files must be updated together with native backend changes.

## JavaScript Backend Flow

Extend the backend client with:

- `extractPak({ pakPath, outputDirectory, aesKey })`
- `extractIoStore({ utocPath, ucasPath, outputDirectory, aesKey })`

Run extraction in worker processes, matching the existing analysis worker isolation. This avoids a long native call blocking Electron main and keeps AES keys off command-line arguments.

Extend `AnalysisService` with `extract(filePath, outputDirectory)`. It should:

1. Resolve `.pak`, `.utoc`, or `.ucas` using existing container kind and IoStore pairing logic.
2. Resolve the selected backend using the existing backend provider.
3. Use the current `AesKeySession` key.
4. Dispatch to the appropriate backend client extract method.

No environment variables are added to workflows or runtime behavior.

## Electron And Renderer

Expose `extractSelectedContainer(filePath)` or an equivalent preload API that:

1. Opens the output directory picker in Electron main.
2. Calls the analysis service extract method if a directory was selected.
3. Returns `null` for cancel or an extract result for completion.

The Zustand app store gains:

- `isExtracting`
- `extractSelectedContainer()`

`AnalysisTabs` receives the selected file path and extraction callback, then renders the `Extract to...` button in the Packages tab top row.

The button is disabled when:

- no selected container exists,
- no analysis result exists,
- the current result is not extractable,
- analysis or extraction is in progress.

## Error Handling

Expected failure modes:

- no package directory is open,
- no selected container,
- unsupported file type,
- missing IoStore pair,
- missing output directory,
- backend selection is unavailable,
- encrypted container needs an AES key,
- native extraction fails.

These should return structured issues rather than throwing through the UI whenever practical. Unexpected exceptions can still be converted to renderer error results using the existing `createErrorResult` pattern.

Path traversal and unusual mount point behavior should remain aligned with UnrealPak/IoStoreUtilities. UPI should not apply extra path rewriting beyond what the reused engine utility path already does.

## Tests And Verification

Use test-first implementation for new behavior where practical.

Planned automated tests:

- backend-core client tests for extract export invocation and worker payload handling,
- analysis-domain tests for pak versus IoStore extraction dispatch and pair-missing behavior,
- Electron main IPC tests for directory selection cancel and successful dispatch,
- renderer/store tests for button state and status transitions,
- protocol generation tests for the extract response schema.

Required verification before completion:

- `npm.cmd --prefix node-shell run generate-protocol`
- native backend build using the repository workflow:
  `npm.cmd run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine`
- confirm staged backend manifests and DLLs exist for expected configurations,
- `npm.cmd --prefix node-shell test`
- fresh Electron GUI smoke test that verifies renderer mount, expected UI text including `Extract to...`, preload API availability as `window.upi`, and no runtime exceptions.

## Out Of Scope

- Extracting only selected package rows.
- Per-file progress UI.
- Custom UPI mount point normalization.
- New workflow environment variables.
