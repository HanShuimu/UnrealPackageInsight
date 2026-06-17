# Native Backend Routing Design

Date: 2026-06-17

## Purpose

UnrealPackageInsight should not require users to pass a DLL path, set `UPI_BACKEND_DLL`, set
`UPI_ENGINE_ROOT`, or depend on a default EngineRoot when launching the GUI or CLI.

The tool should choose a compatible Unreal backend DLL from staged native artifacts based on
the selected container file. The first version will use lightweight JavaScript-side container
probing:

- Pak: read `FPakInfo` from the file trailer.
- IoStore: read `FIoStoreTocHeader` from `.utoc`.
- `.ucas`: resolve the paired `.utoc` first, then probe the `.utoc`.

This design follows the findings in `docs/spikes/pak-iostore-version-identification.md`: Pak
and IoStore containers store format versions, not exact Unreal Engine release versions. The UI
must not claim that Pak version or IoStore TOC version uniquely identifies UE 5.x.

## Goals

- Start the GUI without a DLL path or engine path.
- Make GUI and CLI share one backend routing implementation.
- Support multiple Unreal Engine versions and multiple build configurations.
- Replace project PowerShell scripts with JavaScript scripts.
- Generate `backend.json` from the repository build script, not from `Build.cs`, `Target.cs`, or
  Unreal post-build hooks.
- Record the required C++ backend rebuild workflow under `.agents/workflow` and reference it
  from `AGENTS.md`.

## Non-Goals

- Do not infer exact UE release versions from container headers.
- Do not implement package-level version probing in the first version.
- Do not add a `Build.cs` or `Target.cs` side effect that writes repository artifacts.
- Do not keep `UPI_BACKEND_DLL`, `UPI_ENGINE_ROOT`, or a default EngineRoot as normal startup
  paths.

## Native Artifact Layout

Native backends are staged under `node-shell/native` using the Node/Electron host platform and
architecture, then the Unreal major/minor/patch version, then the backend configuration:

```text
node-shell/native/
  win32-x64/
    ue-5.7.4/
      debug/
        UnrealPackageInsightBackend.dll
        backend.json
      development/
        UnrealPackageInsightBackend.dll
        backend.json
      shipping/
        UnrealPackageInsightBackend.dll
        backend.json
```

`win32-x64` comes from `process.platform` and `process.arch`. Unreal's platform name remains
`Win64` and is stored in the manifest.

## Backend Manifest

Each staged backend directory contains a generated `backend.json`:

```json
{
  "id": "ue-5.7.4-win32-x64-development",
  "engineVersion": "5.7.4",
  "hostPlatform": "win32",
  "hostArch": "x64",
  "unrealPlatform": "Win64",
  "configuration": "Development",
  "configurationKey": "development",
  "protocolVersion": 1,
  "dll": "UnrealPackageInsightBackend.dll",
  "supports": {
    "pak": {
      "versionMin": 1,
      "versionMax": 12
    },
    "iostore": {
      "tocVersionMin": 1,
      "tocVersionMax": 8
    }
  }
}
```

`engineVersion` is the backend build source version read from
`<EngineRoot>/Engine/Build/Build.version`. It helps users choose a backend and helps the build
script place artifacts. It is not a claim that a selected container was created by that exact
engine version.

## JavaScript Build Flow

Project-local PowerShell scripts should be removed:

```text
scripts/stage-ue-backend.ps1
scripts/build-ue-backend.ps1
scripts/generate-protocol.ps1
```

They are replaced by JavaScript scripts:

```text
scripts/build-native-backend.js
scripts/generate-protocol.js
```

Add a root-level `package.json` as the developer command hub. The simple native build entry
point is:

```text
npm run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

`build` is an alias for the default native backend build configuration, `Development`.
Configuration-specific commands are also exposed:

```text
npm run build:native -- --engine-root C:\WORKSPACE_UE\UnrealEngine --configuration Development
npm run build:native:debug -- --engine-root C:\WORKSPACE_UE\UnrealEngine
npm run build:native:development -- --engine-root C:\WORKSPACE_UE\UnrealEngine
npm run build:native:shipping -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

The npm commands may require `--engine-root`; that is a build-time input, not a runtime GUI or
CLI startup dependency. The GUI and CLI still choose backends from staged manifests and do not
use EngineRoot to run.

`scripts/build-native-backend.js` owns the whole native backend generation flow:

1. Parse arguments, for example:

   ```text
   node scripts/build-native-backend.js --engine-root C:\WORKSPACE_UE\UnrealEngine --configuration Development
   ```

2. Read `<EngineRoot>/Engine/Build/Build.version` and derive `engineVersion` as
   `major.minor.patch` from `MajorVersion`, `MinorVersion`, and `PatchVersion`. If any of
   those fields are missing or non-numeric, fail the build script with a clear error.
3. Stage `ue-backend/UnrealPackageInsightBackend` into
   `<EngineRoot>/Engine/Source/Programs/UnrealPackageInsightBackend`.
4. Invoke Unreal Build Tool through:

   ```text
   <EngineRoot>/Engine/Build/BatchFiles/Build.bat UnrealPackageInsightBackend Win64 <Configuration> -WaitMutex
   ```

5. Locate `UnrealPackageInsightBackend.dll`.
6. Copy the DLL into:

   ```text
   node-shell/native/<host-platform>-<host-arch>/ue-<major.minor.patch>/<configuration-key>/
   ```

7. Generate `backend.json` in the same directory.
8. Smoke-check the staged DLL by calling `UPI_GetBackendInfoV1` and validating the protocol
   version.
9. Print the staged backend id and native directory.

The script does not integrate with `Build.cs`, `Target.cs`, or UBT post-build steps. Unreal
only compiles the Program; the repository script stages, builds, copies, writes manifest, and
verifies.

`scripts/generate-protocol.js` keeps the existing FlatBuffers generation responsibilities:

- find or accept `flatc`,
- verify the expected FlatBuffers version unless explicitly overridden,
- generate C++, TypeScript, and CommonJS bindings,
- repair the TypeScript barrel,
- normalize generated line endings.

`node-shell/package.json` should call the JavaScript protocol script instead of PowerShell.

## Runtime Components

The runtime routing logic is shared by GUI and CLI:

- `container-probe`: reads Pak and IoStore container metadata in JavaScript.
- `backend-registry`: scans `node-shell/native/<platform>-<arch>/**/backend.json`, validates
  manifests, and resolves absolute DLL paths.
- `backend-selector`: matches a probe result to compatible manifests.
- `backend-client-provider`: creates and caches backend clients by backend id.
- `AnalysisService`: requests a backend client for the selected file at analysis time rather
  than receiving one eager global client at startup.

## Probe Rules

Pak probe reads the file trailer and returns:

```text
containerType = pak
pakFormatVersion
pakFormatVersionName
encryptedIndex
encryptionKeyGuid
compressionMethods, if safely readable
```

IoStore probe reads `.utoc` and returns:

```text
containerType = iostore
tocFormatVersion
tocFormatVersionName
tocEntryCount
compressionBlockEntryCount
partitionCount
containerFlags
encryptionKeyGuid
```

`.ucas` has no independent version catalog. A `.ucas` selection must resolve its paired
`.utoc` using the existing pairing rules, then probe the `.utoc`.

Probe results must use container-format wording. They must not say "Pak v12 means UE 5.7" or
"TOC v8 means UE 5.7".

## Backend Selection

Selection filters manifests in this order:

1. current host platform and architecture,
2. supported protocol version,
3. container type support,
4. container format version range.

If no backend matches, return `backend.no_compatible_backend`.

If exactly one backend matches, use it.

If multiple backends match:

- GUI shows a chooser dialog.
- CLI prints the candidates and requires `--backend-id`.
- The shared selector does not silently guess.

Candidate sort order for display and default highlight:

1. `Development` configuration first,
2. higher `engineVersion` first using numeric major/minor/patch comparison,
3. manifest id lexicographically as a stable final key.

The GUI still requires user confirmation when multiple candidates exist.

## GUI Behavior

The GUI launcher no longer validates or loads a DLL. Electron main no longer requires
`UPI_BACKEND_DLL`.

`backend:getInfo` should report the backend registry summary, such as available backend count,
current host platform, and available engine/configuration labels. The exact Unreal backend info
from `UPI_GetBackendInfoV1` is fetched only after a backend has been selected for analysis.

When a selected file has multiple compatible backends, the renderer shows a chooser with:

- selected file path,
- detected container type and format version,
- candidate labels such as `UE 5.7.4 Development`,
- candidate ids.

The GUI remembers the user's choice as `filePath -> backendId` for the current session so repeat
analysis of the same file does not ask again.

## CLI Behavior

`node-shell/src/index.js` becomes the CLI main for the shared routing path. `node-shell/bin/upi-cli.js`
delegates to it.

Initial commands:

```text
node src/index.js list-backends
node src/index.js probe <file>
node src/index.js analyze <file> [--backend-id <id>]
```

`analyze` uses the same probe, registry, selector, and backend provider as the GUI. If there
are multiple candidates and no `--backend-id`, it exits with a clear candidate list and a
retry example.

## Caching

- `backend-registry` can cache manifests but should expose a refresh/test override path.
- `backend-client-provider` caches loaded clients by backend id.
- `AnalysisService` result cache keys must include backend id.
- AES keys remain session-only and are not written to disk.

## Error Handling

Use structured issue codes:

- `probe.unsupported_container`
- `probe.file_unavailable`
- `probe.pak_footer_invalid`
- `probe.iostore_pair_missing`
- `probe.utoc_header_invalid`
- `backend.registry_empty`
- `backend.manifest_invalid`
- `backend.no_compatible_backend`
- `backend.multiple_candidates`
- `backend.load_failed`

GUI displays these through the existing Issues table except for multiple candidates, which uses
the chooser dialog. CLI prints actionable text and exits non-zero for errors.

## Test Strategy

Unit tests:

- manifest loading for multiple UE versions and configurations,
- manifest validation and missing DLL errors,
- Pak footer probe with minimal binary fixtures,
- UTOC header probe with minimal binary fixtures,
- `.ucas` pairing before IoStore probe,
- backend selector for zero, one, and multiple candidates,
- display sort order with configuration and engine version,
- `AnalysisService` lazy backend resolution and cache keys including backend id,
- GUI main startup without DLL or EngineRoot,
- GUI multiple-candidate IPC path,
- CLI `list-backends`, `probe`, and multiple-candidate `analyze`.

Script tests:

- derive engine version from `Build.version`,
- compute native output paths including configuration,
- generate manifest JSON,
- invoke build/stage/copy helpers through injectable filesystem and process runners.

The actual Unreal Build Tool invocation is an integration/manual verification step, not part of
ordinary unit tests.

## Agent Workflow Documentation

Add:

```text
.agents/workflow/update-native-backend.md
```

The workflow states:

- every change under `ue-backend/**/*.cpp`, `ue-backend/**/*.h`, or `ue-backend/**/*.cs` requires
  a native backend rebuild,
- use the root npm build commands, which call `scripts/build-native-backend.js`, not
  project-local PowerShell scripts,
- build each required configuration explicitly,
- verify `backend.json`, the staged DLL, and `UPI_GetBackendInfoV1`,
- run the relevant Node routing tests,
- report in the final answer whether the native backend was rebuilt.

Add `AGENTS.md` with a repository rule pointing agents to this workflow whenever they modify
C++ backend code.

## Implementation Notes

- Verify the exact binary constants and layout offsets for JS Pak and UTOC probes against the
  current UE source during implementation before writing parser code.
- Start with checked-in manifest capability defaults generated by the build script. A later
  capability export such as `UPI_GetBackendCapabilitiesV1` can replace those defaults without
  changing the artifact layout.
- Packaging may include only `shipping`, only `development`, or multiple configurations. The
  router handles whichever valid manifests are present.
