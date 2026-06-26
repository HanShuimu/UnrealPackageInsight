# Shared CLI Operations Design

Date: 2026-06-26

## Goal

Implement the previously minimal CLI as a simple command-line tool that supports the same core container abilities exposed by the GUI:

- analyze Pak and IoStore containers,
- extract a selected container to an output directory,
- export analyzed package rows to CSV,
- probe containers and list available backend builds.

The CLI must not grow a separate implementation of GUI behavior. Shared container behavior belongs in reusable Node packages, and the GUI and CLI should use those shared modules through thin presentation-specific shells.

## Current State

The CLI entrypoint is `node-shell/bin/upi-cli.js`, which delegates to `node-shell/src/index.js`.

The current CLI supports:

```text
list-backends
probe <file>
analyze <file> [--backend-id <id>]
```

The current CLI manually performs backend probing and analysis dispatch. It does not use `AnalysisService`, does not support AES keys, does not support extraction, and does not support CSV export.

The GUI already uses shared backend and domain modules:

- `node-shell/packages/backend-core/src/backend-client-provider.js`
- `node-shell/packages/backend-core/src/backend-client.js`
- `node-shell/packages/analysis-domain/src/analysis-service.js`
- `node-shell/packages/analysis-domain/src/aes-key-session.js`
- `node-shell/packages/analysis-domain/src/container-pairing.js`
- `node-shell/packages/analysis-domain/src/package-scan.js`
- `node-shell/packages/analysis-domain/src/packages-table-export.js`

CSV export is now implemented through a shared packages table/export module. The CLI should reuse that module directly instead of duplicating table columns, row sorting, or CSV escaping.

## Architecture Principle

Behavior should be split by responsibility:

- `backend-core`: backend manifests, backend selection, backend clients, native worker calls.
- `analysis-domain`: container file discovery, IoStore pairing, AES session setup, analysis, extraction, package-row normalization, CSV serialization, and high-level container operations shared by GUI and CLI.
- GUI: Electron dialogs, IPC, renderer state, loading indicators, buttons, and modals.
- CLI: argv parsing, stdout/stderr text, process exit codes, and explicit filesystem paths.

The new CLI should introduce a shared high-level operations module under `analysis-domain`, then call that module from `node-shell/src/index.js`. GUI code can keep using `AnalysisService` immediately, but any new cross-surface behavior must live in the shared module. Where it is cheap and low-risk, GUI helpers should reuse the same shared functions, especially for CSV path/content generation and operation context creation.

## Shared Operations Module

Create a CommonJS module:

```text
node-shell/packages/analysis-domain/src/container-operations.js
```

Responsibilities:

- collect sibling `.pak`, `.utoc`, and `.ucas` files for IoStore pairing,
- normalize and validate AES keys through `AesKeySession`,
- create a backend client provider using loaded manifests,
- apply an explicit backend id by storing it in the provider selection store,
- create an `AnalysisService`,
- expose high-level operations for analyze, extract, and packages CSV export.

The module should export:

```js
createContainerOperationContext(options)
analyzeContainer(options)
extractContainer(options)
exportPackagesCsv(options)
listSiblingContainerFiles(filePath)
normalizeCsvOutputPath(filePath)
```

`createContainerOperationContext` is the shared setup function. It should accept injected dependencies for tests, including `loadBackendManifests`, `providerFactory`, `probeContainerFile`, `koffi`, and `writeFile`.

`exportPackagesCsv` should analyze the container, build package rows using `buildPackageRows`, sort rows using `sortPackageRows`, serialize using `serializePackagesCsv`, write the CSV to an explicit path, and return a small result object.

## CLI Contract

The CLI remains intentionally small and non-interactive. It should not open dialogs. All required paths are explicit command-line arguments.

Supported commands:

```text
upi list-backends
upi probe <container>
upi analyze <container> [--backend-id <id>] [--aes-key <key>] [--pretty]
upi extract <container> --out-dir <directory> [--backend-id <id>] [--aes-key <key>]
upi export-csv <container> --out <file.csv> [--backend-id <id>] [--aes-key <key>]
```

The npm form remains:

```text
npm --prefix node-shell run cli -- <command>
```

Option behavior:

- `--backend-id <id>` explicitly selects a backend for the resolved probe path.
- `--aes-key <key>` accepts the same hex or Unreal config Base64 formats as the GUI.
- `--pretty` affects JSON output for `analyze` only.
- `--out-dir <directory>` is required for `extract`.
- `--out <file.csv>` is required for `export-csv`.

If `--backend-id` is omitted, CLI backend selection should match GUI provider behavior: choose the first sorted compatible candidate, which prefers Development over Shipping and newer engine versions over older ones.

## Output Contract

`list-backends` keeps the existing human-readable line format:

```text
<backend-id> UE <version> <configuration>
```

`probe` prints JSON.

`analyze` prints the raw analysis result JSON, including `backendId` from `AnalysisService`.

`extract` prints JSON with the extract response returned by the native backend. The response contains fields such as:

```json
{
  "status": 0,
  "issues": [],
  "containerPath": "C:\\Paks\\A.pak",
  "outputDirectory": "D:\\Out",
  "extractedFileCount": 0,
  "errorCount": 0
}
```

`export-csv` writes the CSV file and prints a concise JSON result:

```json
{
  "status": "OK",
  "filePath": "D:\\Exports\\A.pak.packages.csv",
  "packageCount": 1234,
  "byteCount": 45678,
  "backendId": "ue-5.8.0-win32-x64-development"
}
```

CSV content must match the GUI Packages Table contract:

- UTF-8 with BOM,
- CRLF row endings,
- headers from `PACKAGE_TABLE_COLUMNS`,
- raw numeric values,
- default physical-order sort unless a future shared sort option is added,
- standard CSV escaping from `serializePackagesCsv`.

## Error Handling

Expected errors should become readable CLI messages and non-zero exit codes:

- unsupported command,
- missing required positional argument,
- missing `--out-dir` for extract,
- missing `--out` for CSV export,
- invalid AES key,
- unsupported container type,
- unavailable file,
- missing IoStore pair,
- no compatible backend,
- invalid explicit backend id,
- native analysis or extraction error response.

Structured backend/domain error responses should still be printed as JSON when the operation reaches the backend or `AnalysisService`. CLI usage errors should print plain usage text and exit `1`.

For `export-csv`, an analysis result with no package rows is an error. The command should not write an empty CSV and should exit `1` with a message containing `No packages to export.`

## GUI Impact

The first implementation does not need to change GUI behavior. The GUI already uses shared modules for analysis, extraction, and CSV generation.

The plan should still avoid adding any new behavior directly to GUI-only files when that behavior is useful to CLI. If a helper is needed by both surfaces, it belongs under `analysis-domain`.

Because this change does not modify GUI files under `node-shell/apps/desktop/**`, a fresh Electron GUI smoke test is not required for the CLI-only implementation. If the implementation later changes GUI files, the repository GUI smoke rule applies.

## Testing

Tests should focus on shared behavior first, then CLI routing:

- shared operation context creates `AnalysisService` with AES and backend selection,
- shared `exportPackagesCsv` uses the shared packages table/export module,
- CLI parses required commands and options,
- CLI calls shared operations instead of duplicating domain logic,
- IoStore `.ucas` selections resolve through sibling `.utoc` pairing,
- invalid AES keys fail before backend calls,
- CSV export refuses empty package rows,
- JSON output handles bigint values safely.

Full native backend rebuild is not required because no C++ or protocol files change.

## Out Of Scope

- Extracting only selected package rows.
- Exporting Tree-mode hierarchy.
- Adding interactive backend selection prompts.
- Adding progress reporting.
- Adding workflow environment variables.
- Changing native backend ABI or FlatBuffer schemas.
