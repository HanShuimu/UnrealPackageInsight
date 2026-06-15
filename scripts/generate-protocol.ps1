param(
	[string]$Flatc = $env:UPI_FLATC
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ProtocolDir = Join-Path $RepoRoot "node-shell\packages\protocol"
$CppOut = Join-Path $ProtocolDir "generated\cpp"
$JsOut = Join-Path $ProtocolDir "generated\js"

if ([string]::IsNullOrWhiteSpace($Flatc)) {
	$Command = Get-Command flatc -ErrorAction SilentlyContinue
	if ($Command) {
		$Flatc = $Command.Source
	}
}

if ([string]::IsNullOrWhiteSpace($Flatc) -or !(Test-Path -LiteralPath $Flatc)) {
	throw "flatc not found. Install the FlatBuffers compiler or set UPI_FLATC to flatc.exe."
}

New-Item -ItemType Directory -Force -Path $CppOut, $JsOut | Out-Null

$Schemas = @(
	"upi_backend_info.fbs",
	"upi_pak_analysis.fbs",
	"upi_iostore_analysis.fbs"
)

foreach ($Schema in $Schemas) {
	$SchemaPath = Join-Path $ProtocolDir $Schema
	& $Flatc --cpp --filename-suffix "_generated" -o $CppOut -I $ProtocolDir $SchemaPath
	if ($LASTEXITCODE -ne 0) {
		throw "flatc C++ generation failed for $Schema"
	}
	& $Flatc --js --gen-onefile -o $JsOut -I $ProtocolDir $SchemaPath
	if ($LASTEXITCODE -ne 0) {
		throw "flatc JS generation failed for $Schema"
	}
}

Write-Output "[OK] Generated FlatBuffers bindings in $ProtocolDir\generated"
