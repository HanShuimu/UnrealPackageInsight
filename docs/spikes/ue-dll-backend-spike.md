# UE DLL Backend Spike Report

Date: 2026-06-15

## Question

Can a UE-built Program DLL expose C ABI functions that an independent Node.js shell can load and call?

## Engine

- Engine root: `C:\WORKSPACE_UE\UnrealEngine`
- Build script: `C:\WORKSPACE_UE\UnrealEngine\Engine\Build\BatchFiles\Build.bat`
- Target: `UnrealPackageInsightBackend`
- Platform: `Win64`
- Configuration: `Development`
- Build toolchain: Visual Studio 2022 14.44.35222
- Windows SDK: 10.0.22621.0

## Repository Inputs

- Backend source: `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend`
- Node shell: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell`
- Staging script: `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\stage-ue-backend.ps1`
- Build script: `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\build-ue-backend.ps1`

## Commands Run

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
.\scripts\stage-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine
.\scripts\build-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine -Configuration Development
$env:UPI_BACKEND_DLL = "C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
$env:UPI_ENGINE_ROOT = "C:\WORKSPACE_UE\UnrealEngine"
npm.cmd run call-backend -- $env:UPI_BACKEND_DLL
```

The npm script expanded to:

```text
node src/index.js C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

## Observed Build Result

```text
Using Visual Studio 2022 14.44.35222 toolchain (C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (C:\Program Files (x86)\Windows Kits\10).
[1/3] Compile [x64] UnrealPackageInsightBackend.cpp
[2/3] Link [x64] UnrealPackageInsightBackend.dll
[3/3] WriteMetadata UnrealPackageInsightBackend.target [NoUba]
Result: Succeeded
Total execution time: 6.94 seconds
UPI_BACKEND_DLL=C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

## Observed Export Result

`dumpbin.exe` was not found, and `artifacts\ue-dll-backend\exports.txt` contained:

```text
[WARN] dumpbin.exe not found; Node FFI symbol resolution will verify exports.
```

Koffi resolved and called `UPI_GetBackendInfo` and `UPI_Add` from Node, so the exports were practically verified by symbol resolution and successful calls.

## Observed Node Result

```text
> unreal-package-insight-node-shell@0.1.0 call-backend
> node src/index.js C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll

Backend info: UnrealPackageInsightBackend/0.1 UE-DLL-Spike
UPI_Add(20, 22): 42
```

## Root Cause Note

The initial build failed with unresolved `GInternalProjectName` and `GForeignEngineDir` when linking Core into the Program DLL.

The fix was to define `TCHAR GInternalProjectName[64] = TEXT("");` and `IMPLEMENT_FOREIGN_ENGINE_DIR()` in the backend cpp, matching the local UE Program DLL precedent from TextureShareSDK.

## Decision

Success

The UE Program DLL was built, Node loaded it, and both exported functions were called successfully.

## Next Step

Run a second spike that touches a tiny UE API surface, such as returning `FEngineVersion::Current().ToString()` or another low-risk Core-only UE value, before attempting pak or iostore parsing.
