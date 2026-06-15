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
$ResolvedDestParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $ResolvedDestDir))

if (![System.String]::Equals($ResolvedDestParent, $ResolvedProgramsDir, [System.StringComparison]::OrdinalIgnoreCase)) {
	throw "Refusing to stage outside Engine Source Programs: $ResolvedDestDir"
}

if ((Split-Path -Leaf $ResolvedDestDir) -ne "UnrealPackageInsightBackend") {
	throw "Refusing to remove unexpected staging directory: $ResolvedDestDir"
}

if (Test-Path -LiteralPath $ResolvedDestDir) {
	Remove-Item -LiteralPath $ResolvedDestDir -Recurse -Force
}

Copy-Item -LiteralPath $SourceDir -Destination $ResolvedDestDir -Recurse
Write-Output "[OK] Staged UE backend to $ResolvedDestDir"
