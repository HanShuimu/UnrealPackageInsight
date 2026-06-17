# Program-Local C++ Protocol Generation Design

## Goal

Make Unreal backend compilation self-contained after the Program source is copied into the Unreal Engine tree. `UnrealPackageInsightBackend.Build.cs` must not depend on `UPI_REPO_ROOT`, the current working directory, or a search back into the UnrealPackageInsight repository to find generated C++ FlatBuffers headers.

The C++ protocol headers should live in the UE Program source tree and be copied with the Program before Unreal Build Tool compiles it.

## Current Problem

Generated C++ protocol headers currently live at:

```text
node-shell/packages/protocol/generated/cpp
```

The build script copies:

```text
ue-backend/UnrealPackageInsightBackend
```

to:

```text
<EngineRoot>/Engine/Source/Programs/UnrealPackageInsightBackend
```

After that copy, Unreal Build Tool compiles the staged Program from inside the Engine tree. `UnrealPackageInsightBackend.Build.cs` currently tries to find generated headers through `UPI_REPO_ROOT` or by walking parent directories. That fails when the Engine tree has no parent relationship to the repo, and it makes the Program depend on external environment state.

## Chosen Design

The repository keeps only one checked-in copy of generated C++ protocol headers, inside the Program source tree:

```text
ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol
```

These generated C++ headers are tracked by git, just like the generated JS/TS protocol files already are. They are not ignored.

The old C++ generated directory is removed:

```text
node-shell/packages/protocol/generated/cpp
```

Generated JS and TS protocol outputs stay where they are:

```text
node-shell/packages/protocol/generated/js
node-shell/packages/protocol/generated/ts
```

## Protocol Generation Flow

`scripts/generate-protocol.js` writes generated outputs to two protocol consumers:

- C++ headers to the Unreal Program source tree:

  ```text
  ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol
  ```

- TypeScript and CommonJS bindings to Node protocol directories:

  ```text
  node-shell/packages/protocol/generated/ts
  node-shell/packages/protocol/generated/js
  ```

The script should continue to:

- accept `--flatc <path>`,
- accept `--allow-different-flatc-version`,
- prefer `--flatc`, then `UPI_FLATC`, then `flatc`,
- require FlatBuffers compiler version `24.3.25` unless explicitly overridden,
- normalize generated line endings,
- rewrite the generated TypeScript barrel,
- use the local TypeScript compiler from `node-shell/node_modules/.bin`.

## Native Build Flow

`scripts/build-native-backend.js` validates that Program-local C++ generated protocol headers exist before copying the Program into the Engine tree.

The build flow remains:

1. Read `Engine/Build/Build.version`, including Major, Minor, and Patch.
2. Validate the Program source tree and generated C++ protocol headers.
3. Copy `ue-backend/UnrealPackageInsightBackend` to:

   ```text
   <EngineRoot>/Engine/Source/Programs/UnrealPackageInsightBackend
   ```

4. Build `Debug`, `Development`, and `Shipping` by default.
5. Copy built DLLs into:

   ```text
   node-shell/native/<platform>-<arch>/ue-<major.minor.patch>/<configurationKey>
   ```

6. Write `backend.json` beside each staged DLL.
7. Smoke-check the staged DLL.

No `UPI_REPO_ROOT` environment variable is needed at build time.

## Unreal Build.cs

`UnrealPackageInsightBackend.Build.cs` resolves generated C++ protocol headers only relative to its module directory:

```text
<ModuleDirectory>/Generated/Protocol
```

It should remove:

- `UPI_REPO_ROOT` lookup,
- current-working-directory search,
- upward parent directory search for `node-shell/packages/protocol/generated/cpp`.

If the Program-local generated protocol directory is missing, `Build.cs` should fail with an actionable error telling the developer to regenerate protocol bindings before building the backend.

## Git Tracking

Track these generated files:

```text
ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/*.h
node-shell/packages/protocol/generated/js/**
node-shell/packages/protocol/generated/ts/**
```

Do not track:

```text
node-shell/packages/protocol/generated/cpp/**
```

No `.gitignore` rule is needed for Program-local generated C++ headers because they are committed artifacts.

## Tests

Update tests to lock down the new contract:

- `packages/protocol/test/generated-protocol.test.js` should verify C++ headers exist in the Program-local generated path.
- `test/generate-protocol-script.test.js` should verify `buildFlatcCommands` sends C++ output to the Program-local path.
- `test/build-native-backend-script.test.js` should verify the native build script validates Program-local generated headers before staging.
- Add or update a test proving `Build.cs` no longer contains `UPI_REPO_ROOT`.

Existing full Node tests should continue to pass without requiring `flatc`.

## Non-Goals

- Do not add a second checked-in copy of generated C++ headers.
- Do not keep `UPI_REPO_ROOT` as a fallback.
- Do not make Unreal Build Tool read generated headers from `node-shell`.
- Do not change backend manifest routing behavior.
