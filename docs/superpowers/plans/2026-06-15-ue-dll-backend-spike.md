# UE DLL Backend Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal Unreal Engine Program DLL and prove an independent Node.js shell can load it and call exported functions.

**Architecture:** Keep source-of-truth backend code in this repository, stage it into `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Programs` for UBT, build a Win64 DLL, then load that DLL from Node through `koffi`. The backend exports only plain C ABI functions so the spike tests the UE-built binary boundary without touching UObject, pak parsing, or heavy UE subsystem initialization.

**Tech Stack:** Unreal Engine 5 source tree at `C:\WORKSPACE_UE\UnrealEngine`, UBT `TargetType.Program`, Win64 DLL export functions, PowerShell staging/build scripts, Node.js CommonJS, `koffi@3.0.2`, `node:test`.

---

## File Structure

- Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Target.cs`
  - Defines the Win64-only Program target and requests DLL output with `bShouldCompileAsDLL`.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Build.cs`
  - Defines a minimal module depending only on `Core`.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Public\UnrealPackageInsightBackend.h`
  - Declares the exported C ABI surface.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Private\UnrealPackageInsightBackend.cpp`
  - Implements fixed test exports.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\stage-ue-backend.ps1`
  - Copies the repo backend source into the local UE source tree after path safety checks.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\build-ue-backend.ps1`
  - Invokes `Build.bat`, discovers the produced DLL, and prints `UPI_BACKEND_DLL=<path>`.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\package.json`
  - Defines Node scripts and pins `koffi@3.0.2`.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\dll-paths.js`
  - Resolves DLL arguments and constructs a Windows DLL search path.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\backend-runner.js`
  - Loads the DLL through an injected or real `koffi` module and calls the exported functions.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\index.js`
  - CLI entry point for the Node shell.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\test\dll-paths.test.js`
  - Unit tests for DLL path resolution and search path construction.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\test\backend-runner.test.js`
  - Unit tests for the Node runner with a fake FFI object.
- Create `C:\WORKSPACE_UE\UnrealPackageInsight\docs\spikes\ue-dll-backend-spike.md`
  - Captures exact commands, artifact paths, output, and the final spike result.
- Modify `C:\WORKSPACE_UE\UnrealPackageInsight\.gitignore`
  - Ignore Node dependencies and local generated spike artifacts.

## Task 1: Node Shell Path Helpers

**Files:**
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\package.json`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\dll-paths.js`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\test\dll-paths.test.js`

- [ ] **Step 1: Create the Node package manifest**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\package.json`:

```json
{
  "name": "unreal-package-insight-node-shell",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test",
    "call-backend": "node src/index.js"
  },
  "dependencies": {
    "koffi": "3.0.2"
  }
}
```

- [ ] **Step 2: Write failing tests for DLL path helpers**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\test\dll-paths.test.js`:

```js
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  resolveDllPath,
  buildDllSearchPath,
  getEngineWin64BinariesDir,
} = require('../src/dll-paths');

test('resolveDllPath returns an absolute path for a relative DLL argument', () => {
  const resolved = resolveDllPath('build/backend.dll', 'C:\\WORKSPACE_UE\\UnrealPackageInsight');
  assert.equal(resolved, 'C:\\WORKSPACE_UE\\UnrealPackageInsight\\build\\backend.dll');
});

test('resolveDllPath keeps an absolute DLL argument unchanged', () => {
  const absolutePath = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\Backend.dll';
  assert.equal(resolveDllPath(absolutePath), absolutePath);
});

test('resolveDllPath throws a usage error when the DLL path is missing', () => {
  assert.throws(
    () => resolveDllPath(''),
    /Usage: node src[\\/]index\.js <path-to-backend-dll>/
  );
});

test('getEngineWin64BinariesDir resolves from the default engine root', () => {
  assert.equal(
    getEngineWin64BinariesDir('C:\\WORKSPACE_UE\\UnrealEngine'),
    'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64'
  );
});

test('buildDllSearchPath prepends the DLL directory and engine Win64 binaries', () => {
  const dllPath = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend\\UnrealPackageInsightBackend.dll';
  const result = buildDllSearchPath({
    dllPath,
    engineRoot: 'C:\\WORKSPACE_UE\\UnrealEngine',
    existingPath: 'C:\\Windows\\System32',
  });

  const parts = result.split(path.delimiter);
  assert.equal(parts[0], 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend');
  assert.equal(parts[1], 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64');
  assert.equal(parts[2], 'C:\\Windows\\System32');
});
```

- [ ] **Step 3: Run tests to verify they fail because the helper module does not exist**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: `node --test` fails with an error containing `Cannot find module '../src/dll-paths'`.

- [ ] **Step 4: Implement DLL path helpers**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\dll-paths.js`:

```js
const path = require('node:path');

const DEFAULT_ENGINE_ROOT = 'C:\\WORKSPACE_UE\\UnrealEngine';

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
  const existingParts = existingPath.length > 0 ? existingPath.split(path.delimiter) : [];
  const seen = new Set();
  const merged = [];

  for (const part of additions.concat(existingParts)) {
    if (!part || seen.has(part.toLowerCase())) {
      continue;
    }

    seen.add(part.toLowerCase());
    merged.push(part);
  }

  return merged.join(path.delimiter);
}

module.exports = {
  DEFAULT_ENGINE_ROOT,
  resolveDllPath,
  getEngineWin64BinariesDir,
  buildDllSearchPath,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: all tests in `dll-paths.test.js` pass.

- [ ] **Step 6: Commit Node path helpers**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git add node-shell\package.json node-shell\src\dll-paths.js node-shell\test\dll-paths.test.js
git commit -m "Add Node DLL path helpers"
```

## Task 2: Node FFI Runner

**Files:**
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\backend-runner.js`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\index.js`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\test\backend-runner.test.js`

- [ ] **Step 1: Write failing tests for the backend runner**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\test\backend-runner.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { runBackendSmoke } = require('../src/backend-runner');

function createFakeKoffi() {
  const calls = [];
  const fakeLibrary = {
    func(signature) {
      calls.push(signature);
      if (signature === 'str UPI_GetBackendInfo()') {
        return () => 'UnrealPackageInsightBackend/0.1 UE-DLL-Spike';
      }
      if (signature === 'int UPI_Add(int, int)') {
        return (a, b) => a + b;
      }
      throw new Error(`Unexpected signature: ${signature}`);
    },
  };

  return {
    calls,
    load(dllPath) {
      calls.push(`load:${dllPath}`);
      return fakeLibrary;
    },
  };
}

test('runBackendSmoke loads the DLL and calls exported functions', () => {
  const fakeKoffi = createFakeKoffi();
  const output = [];

  const result = runBackendSmoke({
    dllPath: 'C:\\backend\\UnrealPackageInsightBackend.dll',
    koffi: fakeKoffi,
    log: (line) => output.push(line),
  });

  assert.deepEqual(fakeKoffi.calls, [
    'load:C:\\backend\\UnrealPackageInsightBackend.dll',
    'str UPI_GetBackendInfo()',
    'int UPI_Add(int, int)',
  ]);
  assert.deepEqual(output, [
    'Backend info: UnrealPackageInsightBackend/0.1 UE-DLL-Spike',
    'UPI_Add(20, 22): 42',
  ]);
  assert.equal(result.backendInfo, 'UnrealPackageInsightBackend/0.1 UE-DLL-Spike');
  assert.equal(result.addResult, 42);
});
```

- [ ] **Step 2: Run tests to verify they fail because the runner module does not exist**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: test run fails with an error containing `Cannot find module '../src/backend-runner'`.

- [ ] **Step 3: Implement the backend runner**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\backend-runner.js`:

```js
function runBackendSmoke({ dllPath, koffi, log = console.log }) {
  const library = koffi.load(dllPath);
  const getBackendInfo = library.func('str UPI_GetBackendInfo()');
  const add = library.func('int UPI_Add(int, int)');

  const backendInfo = getBackendInfo();
  const addResult = add(20, 22);

  log(`Backend info: ${backendInfo}`);
  log(`UPI_Add(20, 22): ${addResult}`);

  return {
    backendInfo,
    addResult,
  };
}

module.exports = {
  runBackendSmoke,
};
```

- [ ] **Step 4: Implement the CLI entry point**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\node-shell\src\index.js`:

```js
const koffi = require('koffi');

const {
  DEFAULT_ENGINE_ROOT,
  buildDllSearchPath,
  resolveDllPath,
} = require('./dll-paths');
const { runBackendSmoke } = require('./backend-runner');

function main(argv = process.argv) {
  const dllPath = resolveDllPath(argv[2]);
  const engineRoot = process.env.UPI_ENGINE_ROOT || DEFAULT_ENGINE_ROOT;

  process.env.PATH = buildDllSearchPath({
    dllPath,
    engineRoot,
    existingPath: process.env.PATH || '',
  });

  runBackendSmoke({
    dllPath,
    koffi,
    log: console.log,
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

module.exports = {
  main,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: all tests in `dll-paths.test.js` and `backend-runner.test.js` pass.

- [ ] **Step 6: Install Node dependencies**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd install
```

Expected: `koffi@3.0.2` installs and `package-lock.json` is created.

- [ ] **Step 7: Run tests with installed dependencies**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: all tests pass after dependency installation.

- [ ] **Step 8: Commit Node FFI runner**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git add node-shell\package.json node-shell\package-lock.json node-shell\src\backend-runner.js node-shell\src\index.js node-shell\test\backend-runner.test.js
git commit -m "Add Node backend FFI runner"
```

## Task 3: UE Backend Program DLL Source

**Files:**
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Target.cs`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Build.cs`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Public\UnrealPackageInsightBackend.h`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Private\UnrealPackageInsightBackend.cpp`

- [ ] **Step 1: Create the UE Program target**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Target.cs`:

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

- [ ] **Step 2: Create the UE module rules**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\UnrealPackageInsightBackend.Build.cs`:

```csharp
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
	}
}
```

- [ ] **Step 3: Create the exported C ABI header**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Public\UnrealPackageInsightBackend.h`:

```cpp
#pragma once

#if defined(_WIN32)
#define UPI_BACKEND_API extern "C" __declspec(dllexport)
#else
#define UPI_BACKEND_API extern "C" __attribute__((visibility("default")))
#endif

UPI_BACKEND_API const char* UPI_GetBackendInfo();
UPI_BACKEND_API int UPI_Add(int A, int B);
```

- [ ] **Step 4: Create the exported C ABI implementation**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Private\UnrealPackageInsightBackend.cpp`:

```cpp
#include "UnrealPackageInsightBackend.h"

const char* UPI_GetBackendInfo()
{
	return "UnrealPackageInsightBackend/0.1 UE-DLL-Spike";
}

int UPI_Add(int A, int B)
{
	return A + B;
}
```

- [ ] **Step 5: Commit UE backend source**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git add ue-backend\UnrealPackageInsightBackend
git commit -m "Add UE Program DLL backend source"
```

## Task 4: Staging and Build Scripts

**Files:**
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\stage-ue-backend.ps1`
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\build-ue-backend.ps1`

- [ ] **Step 1: Create the staging script**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\stage-ue-backend.ps1`:

```powershell
param(
	[string]$EngineRoot = "C:\WORKSPACE_UE\UnrealEngine"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$SourceDir = Join-Path $RepoRoot "ue-backend\UnrealPackageInsightBackend"
$ProgramsDir = Join-Path $EngineRoot "Engine\Source\Programs"
$DestDir = Join-Path $ProgramsDir "UnrealPackageInsightBackend"
$BuildBat = Join-Path $EngineRoot "Engine\Build\BatchFiles\Build.bat"

if (!(Test-Path -LiteralPath $BuildBat)) {
	throw "Build.bat not found: $BuildBat"
}

if (!(Test-Path -LiteralPath $SourceDir)) {
	throw "Backend source not found: $SourceDir"
}

$ResolvedProgramsDir = [System.IO.Path]::GetFullPath($ProgramsDir)
$ResolvedDestDir = [System.IO.Path]::GetFullPath($DestDir)

if (!$ResolvedDestDir.StartsWith($ResolvedProgramsDir, [System.StringComparison]::OrdinalIgnoreCase)) {
	throw "Refusing to stage outside Engine Source Programs: $ResolvedDestDir"
}

if ((Split-Path -Leaf $ResolvedDestDir) -ne "UnrealPackageInsightBackend") {
	throw "Refusing to remove unexpected staging directory: $ResolvedDestDir"
}

if (Test-Path -LiteralPath $DestDir) {
	Remove-Item -LiteralPath $DestDir -Recurse -Force
}

Copy-Item -LiteralPath $SourceDir -Destination $DestDir -Recurse
Write-Output "[OK] Staged UE backend to $DestDir"
```

- [ ] **Step 2: Create the build script**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\scripts\build-ue-backend.ps1`:

```powershell
param(
	[string]$EngineRoot = "C:\WORKSPACE_UE\UnrealEngine",
	[string]$Configuration = "Development"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BuildBat = Join-Path $EngineRoot "Engine\Build\BatchFiles\Build.bat"
$ExpectedDll = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
$BinariesDir = Join-Path $EngineRoot "Engine\Binaries\Win64"

if (!(Test-Path -LiteralPath $BuildBat)) {
	throw "Build.bat not found: $BuildBat"
}

& $BuildBat UnrealPackageInsightBackend Win64 $Configuration -WaitMutex

if ($LASTEXITCODE -ne 0) {
	throw "UBT build failed with exit code $LASTEXITCODE"
}

if (Test-Path -LiteralPath $ExpectedDll) {
	Write-Output "UPI_BACKEND_DLL=$ExpectedDll"
	exit 0
}

$DiscoveredDll = Get-ChildItem -LiteralPath $BinariesDir -Recurse -Filter "UnrealPackageInsightBackend.dll" -ErrorAction SilentlyContinue | Select-Object -First 1

if (!$DiscoveredDll) {
	throw "Build succeeded but UnrealPackageInsightBackend.dll was not found under $BinariesDir"
}

Write-Output "UPI_BACKEND_DLL=$($DiscoveredDll.FullName)"
```

- [ ] **Step 3: Run PowerShell parser checks**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -LiteralPath .\scripts\stage-ue-backend.ps1 -Raw), [ref]$null)
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -LiteralPath .\scripts\build-ue-backend.ps1 -Raw), [ref]$null)
```

Expected: commands complete without parser errors.

- [ ] **Step 4: Commit staging and build scripts**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git add scripts\stage-ue-backend.ps1 scripts\build-ue-backend.ps1
git commit -m "Add UE backend staging and build scripts"
```

## Task 5: Ignore Local Generated Artifacts

**Files:**
- Modify: `C:\WORKSPACE_UE\UnrealPackageInsight\.gitignore`

- [ ] **Step 1: Append local spike ignore rules**

Append these lines to `C:\WORKSPACE_UE\UnrealPackageInsight\.gitignore`:

```gitignore

# Node shell dependencies
node-shell/node_modules/

# Local brainstorming companion state
.superpowers/

# Local spike logs and copied binary outputs
artifacts/
```

- [ ] **Step 2: Verify ignore rules**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git check-ignore -v node-shell\node_modules\koffi\package.json
git check-ignore -v .superpowers\brainstorm\session\content\screen.html
git check-ignore -v artifacts\ue-dll-backend\build.log
```

Expected: each command prints the matching `.gitignore` rule.

- [ ] **Step 3: Commit ignore rules**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git add .gitignore
git commit -m "Ignore local spike artifacts"
```

## Task 6: Stage and Build the UE DLL

**Files:**
- Writes outside repository during execution: `C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Programs\UnrealPackageInsightBackend`
- Produces outside repository during execution: `C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll`

- [ ] **Step 1: Stage backend source into the UE source tree**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
.\scripts\stage-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine
```

Expected output contains:

```text
[OK] Staged UE backend to C:\WORKSPACE_UE\UnrealEngine\Engine\Source\Programs\UnrealPackageInsightBackend
```

- [ ] **Step 2: Build the Program DLL**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
New-Item -ItemType Directory -Force -Path .\artifacts\ue-dll-backend | Out-Null
.\scripts\build-ue-backend.ps1 -EngineRoot C:\WORKSPACE_UE\UnrealEngine -Configuration Development 2>&1 | Tee-Object -FilePath .\artifacts\ue-dll-backend\build-output.txt
```

Expected output contains:

```text
UPI_BACKEND_DLL=C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

- [ ] **Step 3: Save the DLL path for the Node smoke**

Run:

```powershell
$env:UPI_BACKEND_DLL = "C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
Test-Path -LiteralPath $env:UPI_BACKEND_DLL
```

Expected output:

```text
True
```

## Task 7: Verify Exports and Call the DLL from Node

**Files:**
- Reads: `C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll`
- May create during execution: `C:\WORKSPACE_UE\UnrealPackageInsight\artifacts\ue-dll-backend\exports.txt`

- [ ] **Step 1: Try to inspect DLL exports with dumpbin**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
New-Item -ItemType Directory -Force -Path .\artifacts\ue-dll-backend | Out-Null
$Dumpbin = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
if ($Dumpbin) {
	& $Dumpbin.Source /exports $env:UPI_BACKEND_DLL | Tee-Object -FilePath .\artifacts\ue-dll-backend\exports.txt
} else {
	"[WARN] dumpbin.exe not found; Node FFI symbol resolution will verify exports." | Tee-Object -FilePath .\artifacts\ue-dll-backend\exports.txt
}
```

Expected: either `exports.txt` contains `UPI_GetBackendInfo` and `UPI_Add`, or it contains the explicit `dumpbin.exe not found` warning.

- [ ] **Step 2: Call the DLL from Node**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
$env:UPI_ENGINE_ROOT = "C:\WORKSPACE_UE\UnrealEngine"
npm.cmd run call-backend -- $env:UPI_BACKEND_DLL 2>&1 | Tee-Object -FilePath ..\artifacts\ue-dll-backend\node-output.txt
```

Expected output:

```text
Backend info: UnrealPackageInsightBackend/0.1 UE-DLL-Spike
UPI_Add(20, 22): 42
```

- [ ] **Step 3: Record a failing DLL load precisely when the Node call fails**

If Step 2 fails, run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
$env:UPI_ENGINE_ROOT = "C:\WORKSPACE_UE\UnrealEngine"
npm.cmd run call-backend -- $env:UPI_BACKEND_DLL 2>&1 | Tee-Object -FilePath ..\artifacts\ue-dll-backend\node-load-failure.txt
```

Expected: `C:\WORKSPACE_UE\UnrealPackageInsight\artifacts\ue-dll-backend\node-load-failure.txt` contains the exact loader, dependency, or symbol resolution error.

## Task 8: Write the Spike Report

**Files:**
- Create: `C:\WORKSPACE_UE\UnrealPackageInsight\docs\spikes\ue-dll-backend-spike.md`

- [ ] **Step 1: Read captured outputs**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
Get-Content -LiteralPath .\artifacts\ue-dll-backend\build-output.txt
Get-Content -LiteralPath .\artifacts\ue-dll-backend\exports.txt
if (Test-Path -LiteralPath .\artifacts\ue-dll-backend\node-output.txt) {
	Get-Content -LiteralPath .\artifacts\ue-dll-backend\node-output.txt
}
if (Test-Path -LiteralPath .\artifacts\ue-dll-backend\node-load-failure.txt) {
	Get-Content -LiteralPath .\artifacts\ue-dll-backend\node-load-failure.txt
}
```

Expected: the command output includes the actual build result, export result, and either the successful Node output or the exact Node failure.

- [ ] **Step 2: Create the report with actual observed results**

Create `C:\WORKSPACE_UE\UnrealPackageInsight\docs\spikes\ue-dll-backend-spike.md` after reading the captured output. The final report must use the real observed lines from Task 8 Step 1 and must not include instruction text.

```markdown
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

## Observed Build Result

Include the final UBT success or failure line and the exact `UPI_BACKEND_DLL=...` line from `artifacts\ue-dll-backend\build-output.txt`.

## Observed Export Result

Include the exact export check result from `artifacts\ue-dll-backend\exports.txt`, including whether `dumpbin.exe` was available and whether `UPI_GetBackendInfo` and `UPI_Add` were visible.

## Observed Node Result

Include the exact Node output from `artifacts\ue-dll-backend\node-output.txt`, or the exact failure message from `artifacts\ue-dll-backend\node-load-failure.txt`.

## Decision

Use exactly one of these decision labels, followed by one sentence explaining the evidence:

- `Success`
- `Failed at build`
- `Failed at load`
- `Failed at symbol resolution`
- `Failed at call`

## Next Step

State the next architecture step based on the decision. If the result is `Success`, recommend a second spike that touches a tiny UE API surface. If the result is a failure, recommend whether to keep investigating DLL loading or switch the default backend architecture to an external process.
```

- [ ] **Step 3: Verify the report contains observed data**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
Select-String -Path .\docs\spikes\ue-dll-backend-spike.md -Pattern "Include the exact","State the next","Use exactly one" -SimpleMatch
```

Expected: no matches. The report contains observed data and a concrete decision.

- [ ] **Step 4: Commit the spike report**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git add docs\spikes\ue-dll-backend-spike.md
git commit -m "Document UE DLL backend spike result"
```

## Task 9: Final Verification

**Files:**
- Reads all created files.

- [ ] **Step 1: Run Node tests**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: all Node tests pass.

- [ ] **Step 2: Run Node backend smoke if the DLL was built**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
$env:UPI_ENGINE_ROOT = "C:\WORKSPACE_UE\UnrealEngine"
npm.cmd run call-backend -- C:\WORKSPACE_UE\UnrealEngine\Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll
```

Expected output:

```text
Backend info: UnrealPackageInsightBackend/0.1 UE-DLL-Spike
UPI_Add(20, 22): 42
```

If the spike failed before this point, verify the report records the exact failure output instead.

- [ ] **Step 3: Check repository state**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
git status --short
```

Expected: no uncommitted changes except intentionally ignored local artifacts under `artifacts/` or `node-shell/node_modules/`.

## Plan Self-Review

- Spec coverage: This plan covers the UE Program DLL source, local engine path, staging into `C:\WORKSPACE_UE\UnrealEngine`, Build.bat invocation, DLL discovery, export verification, Node/koffi loading, expected function calls, and the spike report.
- Placeholder scan: The report task includes verification that instruction text is removed before commit.
- Type consistency: The exported symbols are consistently named `UPI_GetBackendInfo` and `UPI_Add`; Node uses `str UPI_GetBackendInfo()` and `int UPI_Add(int, int)`; C++ returns `const char*` and `int`.
- Scope check: The plan does not parse pak, utoc, ucas, asset registry, cooked packages, or any production artifact.
