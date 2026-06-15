# UE DLL Backend Spike Design

Date: 2026-06-15
Project: UnrealPackageInsight

## Purpose

Validate whether an Unreal Engine 5 backend can be built as a DLL and called from an independent Node.js shell.

This spike exists to answer one architecture question before the main product architecture is finalized:

Can a UE-built backend expose stable functions that an external application can load and call without launching a UE Program executable?

## Background

The long-term product goal is a GUI plus CLI analysis tool for Unreal Engine 5 build artifacts, including pak files, IoStore files, cooked packages, asset registry data, and other generated outputs.

A pure UE Program gives direct access to UE code, but standalone distribution can require engine runtime files and content. An independent application is easier to distribute, but deep analysis may still need UE code. This spike tests a middle path: keep the application shell outside UE, while compiling a tiny UE-backed DLL that exposes an external API.

Relevant Unreal Engine documentation:

- UBT supports `Program` targets as standalone utility programs built on top of UE:
  https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-build-tool-target-reference
- UBT builds UE through modules and normally compiles modules into binaries loaded by a UE executable:
  https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-build-tool-in-unreal-engine
- Plugin module descriptors include a `Program` module type:
  https://dev.epicgames.com/documentation/en-us/unreal-engine/plugins-in-unreal-engine
- UBT has a `bShouldCompileAsDLL` target option that requires monolithic linking:
  https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-build-tool-target-reference
- UE dynamic library loading and runtime dependency staging are complex enough to treat as explicit spike risks:
  https://dev.epicgames.com/documentation/unreal-engine/integrating-third-party-libraries-into-unreal-engine

## Scope

Build the smallest possible UE-side backend DLL and the smallest possible Node.js caller.

The DLL exports only plain C ABI functions. The Node shell loads the DLL, resolves symbols, calls them, and prints results.

## Non-Goals

This spike will not parse pak, utoc, ucas, asset registry, cooked packages, or any real build artifact.

This spike will not build a GUI.

This spike will not define the final backend protocol.

This spike will not decide the final distribution model for full UE-powered analysis.

This spike will not require UObject, reflection, asset loading, package loading, editor modules, or complex UE subsystem initialization.

## Proposed Repository Layout

```text
ue-backend/
  UnrealPackageInsightBackend/
    Source/
      UnrealPackageInsightBackend/
        Private/
        Public/
        UnrealPackageInsightBackend.Build.cs
    UnrealPackageInsightBackend.Target.cs

node-shell/
  package.json
  src/
    index.js

docs/
  spikes/
    ue-dll-backend-spike.md
```

The exact UE-side placement may need adjustment during implementation. The intended first attempt is to keep the backend source in this repository and document how it is copied or symlinked into an Engine `Source/Programs` location, or otherwise exposed to UBT.

## Local Engine Assumption

The first implementation should use the source-built Unreal Engine tree at:

```text
C:\WORKSPACE_UE\UnrealEngine
```

The expected build entry point is:

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Build\BatchFiles\Build.bat
```

This engine source tree already contains Program targets and DLL-producing Program targets. The spike should model the target configuration after these local examples:

- `Engine\Source\Programs\BlankProgram\BlankProgram.Target.cs`
- `Engine\Source\Programs\VirtualProduction\TextureShare\TextureShareSDK.Target.cs`
- `Engine\Source\Programs\Shared\EpicGames.Perforce.Native\DotNetPerforceLib.Target.cs`
- `Engine\Source\Programs\Enterprise\Datasmith\DatasmithSDK\DatasmithSDK.Target.cs`

The implementation may read from this engine tree freely. It should not make irreversible changes to the engine tree. If copying the spike Program into `Engine\Source\Programs` is required, the copied directory must be treated as generated staging for the spike and documented in the spike report.

## UE Backend Shape

The backend target should be a minimal UE Program-style target configured to produce a DLL if UBT permits it.

The exported API should use C ABI and simple value types:

```cpp
extern "C" __declspec(dllexport) const char* UPI_GetBackendInfo();
extern "C" __declspec(dllexport) int UPI_Add(int a, int b);
```

`UPI_GetBackendInfo` returns a static string such as:

```text
UnrealPackageInsightBackend/0.1 UE-DLL-Spike
```

`UPI_Add` returns `a + b`.

The first version should avoid returning heap-allocated strings across the boundary. This avoids allocator ownership issues between UE and Node.

## UE Program DLL Build Plan

The first build attempt should stage the UE backend source as:

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Programs\UnrealPackageInsightBackend
```

The staged Program should include:

```text
UnrealPackageInsightBackend.Target.cs
Source\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Build.cs
Source\UnrealPackageInsightBackend\Private\UnrealPackageInsightBackend.cpp
Source\UnrealPackageInsightBackend\Public\UnrealPackageInsightBackend.h
```

The target should be Win64-only for the spike and should start from this configuration:

```csharp
using UnrealBuildTool;

[SupportedPlatforms("Win64")]
public class UnrealPackageInsightBackendTarget : TargetRules
{
    public UnrealPackageInsightBackendTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Program;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        LinkType = TargetLinkType.Monolithic;
        LaunchModuleName = "UnrealPackageInsightBackend";

        bShouldCompileAsDLL = true;
        bHasExports = true;

        bBuildDeveloperTools = false;
        bBuildWithEditorOnlyData = false;
        bCompileAgainstEngine = false;
        bCompileAgainstCoreUObject = false;
        bCompileAgainstApplicationCore = false;
        bCompileICU = false;
        bUsesSlate = false;

        OutputFile = "Binaries/Win64/UnrealPackageInsightBackend/UnrealPackageInsightBackend.dll";
    }
}
```

The module should depend only on `Core` for the first attempt. If even `Core` causes unwanted dependencies for the external Node process, the spike should record that and try a narrower plain C++ export only if UBT still permits the Program target to build.

The intended build command is:

```powershell
& 'C:\WORKSPACE_UE\UnrealEngine\Engine\Build\BatchFiles\Build.bat' UnrealPackageInsightBackend Win64 Development -WaitMutex
```

Expected primary artifact:

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

If `OutputFile` is rejected or ignored by UBT for this target shape, the implementation should remove it and discover the actual output under:

```text
C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64
```

The spike report should capture the exact target file used, the exact build command, and the exact output path.

## Export Verification Plan

After building the DLL, verify the export surface before calling it from Node.

Preferred check when Visual Studio tools are available:

```powershell
dumpbin /exports C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

The expected exports are undecorated C symbols:

```text
UPI_GetBackendInfo
UPI_Add
```

If `dumpbin` is unavailable, the Node FFI symbol resolution step is the required verification. The spike should still document that export inspection was skipped because the tool was unavailable.

## Node Shell Shape

The Node shell should load the compiled DLL and call the exported functions.

Preferred FFI library: `koffi`.

Fallback if dependency installation or native loading fails: implement a tiny Node native addon or a small helper executable, but only after documenting why `koffi` failed.

The shell command should print:

```text
Backend info: UnrealPackageInsightBackend/0.1 UE-DLL-Spike
UPI_Add(20, 22): 42
```

The Node shell should accept the DLL path through a command-line argument or environment variable so the first spike does not hardcode the engine output path:

```powershell
node node-shell\src\index.js C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

Before loading the DLL, the shell should prepend these directories to the process search path:

```text
<dll directory>
C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64
```

This is a pragmatic first attempt to help Windows resolve dependent UE DLLs. If dependencies still fail to load, the failure should be recorded rather than hidden by broad file copying.

## Success Criteria

The spike succeeds only if all of these are true:

1. UBT builds a DLL artifact for the backend.
2. The DLL can be loaded from the Node shell process.
3. `UPI_GetBackendInfo` is resolved and returns the expected static string.
4. `UPI_Add` is resolved and returns the expected integer result.
5. The build and run steps are documented in `docs/spikes/ue-dll-backend-spike.md`.

## Failure Criteria

The spike is still useful if it fails, as long as the failure is precise.

Document the exact blocker if any of these happen:

- UBT cannot produce the DLL shape from this target.
- UBT produces a DLL, but required UE runtime dependencies cannot be found by Node.
- The DLL loads, but exported symbols are missing or decorated unexpectedly.
- The DLL loads, but UE static initialization or module assumptions fail in a non-UE host.
- The DLL call works only when engine binaries or content are copied into fragile locations.
- Node FFI cannot safely call the exported API.

## Risks

UE module binaries are normally designed to be loaded by UE-built executables, not arbitrary external processes.

UE and external callers may disagree about CRT, allocator ownership, exception handling, symbol visibility, or runtime dependency search paths.

Using UE APIs beyond `Core` may pull in large dependency sets or require initialization that is not acceptable for a lightweight backend.

Even if this spike works for trivial exported functions, it may not prove that deeper package or IoStore analysis can run in-process safely.

## Decision After Spike

If the DLL call succeeds cleanly, keep DLL backend as an experimental backend path and run a second spike that touches a tiny UE API surface.

If the DLL loads only with fragile dependency copying, prefer an out-of-process backend while preserving the same logical backend API.

If UBT cannot produce a suitable DLL or the DLL cannot be safely loaded by Node, use an external process backend as the default architecture.

## Open Implementation Notes

The implementation should first locate a usable UE5 engine installation on the machine.

For the first implementation, the default engine path is `C:\WORKSPACE_UE\UnrealEngine`.

The implementation should avoid irreversible changes to the engine directory. Any copy into the engine tree should be documented, and symlink or generated staging folders should be preferred when practical.

The implementation should capture exact build commands, output artifact paths, and runtime dependency errors in the spike report.
