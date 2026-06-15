param(
	[string]$Flatc = $env:UPI_FLATC
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$NodeShellDir = Join-Path $RepoRoot "node-shell"
$ProtocolDir = Join-Path $RepoRoot "node-shell\packages\protocol"
$CppOut = Join-Path $ProtocolDir "generated\cpp"
$TsOut = Join-Path $ProtocolDir "generated\ts"
$JsOut = Join-Path $ProtocolDir "generated\js"
$GeneratedOut = Join-Path $ProtocolDir "generated"

function ConvertTo-LfLineEndings {
	param(
		[string]$Root
	)

	$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
	$GeneratedFiles = @(Get-ChildItem -Path $Root -Recurse -File)
	foreach ($File in $GeneratedFiles) {
		$Bytes = [System.IO.File]::ReadAllBytes($File.FullName)
		$Text = $Utf8NoBom.GetString($Bytes)
		$Normalized = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
		if ($Normalized -ne $Text) {
			[System.IO.File]::WriteAllText($File.FullName, $Normalized, $Utf8NoBom)
		}
	}
}

if ([string]::IsNullOrWhiteSpace($Flatc)) {
	$Command = Get-Command flatc -ErrorAction SilentlyContinue
	if ($Command) {
		$Flatc = $Command.Source
	}
}

if ([string]::IsNullOrWhiteSpace($Flatc) -or !(Test-Path -LiteralPath $Flatc)) {
	throw "flatc not found. Install the FlatBuffers compiler or set UPI_FLATC to flatc.exe."
}

$Tsc = Join-Path $NodeShellDir "node_modules\.bin\tsc.cmd"
if (!(Test-Path -LiteralPath $Tsc)) {
	throw "TypeScript compiler not found at $Tsc. Run npm install from node-shell before generating protocol bindings."
}

foreach ($OutDir in @($CppOut, $TsOut, $JsOut)) {
	if (Test-Path -LiteralPath $OutDir) {
		Remove-Item -LiteralPath $OutDir -Recurse -Force
	}
	New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

$Schemas = @(
	"upi_backend_info.fbs",
	"upi_pak_analysis.fbs",
	"upi_iostore_analysis.fbs"
)

$SchemaPaths = foreach ($Schema in $Schemas) {
	Join-Path $ProtocolDir $Schema
}

$CommonSchemaPath = Join-Path $ProtocolDir "upi_common.fbs"
$AllSchemaPaths = @($CommonSchemaPath) + $SchemaPaths

& $Flatc --warnings-as-errors --cpp --filename-suffix "_generated" -o $CppOut -I $ProtocolDir @AllSchemaPaths
if ($LASTEXITCODE -ne 0) {
	throw "flatc C++ generation failed."
}

& $Flatc --warnings-as-errors --ts -o $TsOut -I $ProtocolDir @AllSchemaPaths
if ($LASTEXITCODE -ne 0) {
	throw "flatc TypeScript generation failed."
}

$TsFiles = @(Get-ChildItem -Path $TsOut -Recurse -Filter "*.ts" | Select-Object -ExpandProperty FullName)
if (!$TsFiles -or $TsFiles.Count -eq 0) {
	throw "flatc TypeScript generation produced no .ts files in $TsOut."
}

$TscArgs = @(
	"--target", "ES2020",
	"--module", "commonjs",
	"--moduleResolution", "node",
	"--rootDir", $TsOut,
	"--outDir", $JsOut,
	"--skipLibCheck",
	"--noEmitOnError"
) + $TsFiles

& $Tsc @TscArgs
if ($LASTEXITCODE -ne 0) {
	throw "TypeScript compilation failed for generated protocol bindings."
}

ConvertTo-LfLineEndings -Root $GeneratedOut

Write-Output "[OK] Generated FlatBuffers bindings in $ProtocolDir\generated"
