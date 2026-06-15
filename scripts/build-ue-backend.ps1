param(
	[string]$EngineRoot = "C:\WORKSPACE_UE\UnrealEngine",
	[string]$Configuration = "Development"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BuildBat = Join-Path $EngineRoot "Engine\Build\BatchFiles\Build.bat"
$ExpectedDll = Join-Path $EngineRoot "Engine\Binaries\Win64\UnrealPackageInsightBackend\UnrealPackageInsightBackend.dll"
$BinariesDir = Join-Path $EngineRoot "Engine\Binaries\Win64"
$ExpectedDllDir = Join-Path $BinariesDir "UnrealPackageInsightBackend"

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

$NewestTargetDll = Get-ChildItem -LiteralPath $ExpectedDllDir -Recurse -Filter "UnrealPackageInsightBackend.dll" -ErrorAction SilentlyContinue | Sort-Object -Property LastWriteTimeUtc -Descending | Select-Object -First 1

if ($NewestTargetDll) {
	Write-Output "UPI_BACKEND_DLL=$($NewestTargetDll.FullName)"
	exit 0
}

$NewestDiscoveredDll = Get-ChildItem -LiteralPath $BinariesDir -Recurse -Filter "UnrealPackageInsightBackend.dll" -ErrorAction SilentlyContinue | Sort-Object -Property LastWriteTimeUtc -Descending | Select-Object -First 1

if (!$NewestDiscoveredDll) {
	throw "Build succeeded but UnrealPackageInsightBackend.dll was not found under $BinariesDir"
}

Write-Output "UPI_BACKEND_DLL=$($NewestDiscoveredDll.FullName)"
