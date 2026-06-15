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
