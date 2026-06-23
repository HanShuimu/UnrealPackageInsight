const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

const {
  buildFlatcCommands,
  getConfiguredFlatc,
  getProtocolOutputPaths,
  getProtocolToolsConfigPath,
  getTypescriptCompiler,
  normalizeLineEndings,
  parseArgs,
  removeLegacyCppOutput,
  resolveFlatcPath,
  setGeneratedTypescriptBarrel,
} = require('../../scripts/generate-protocol.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'upi-generate-protocol-'));
}

test('parseArgs accepts flatc path and allow-different-flatc-version flag', () => {
  assert.deepEqual(parseArgs([
    '--flatc',
    'C:\\Tools\\flatc.exe',
    '--tools-config',
    'tools\\protocol-tools.json',
    '--allow-different-flatc-version',
  ]), {
    allowDifferentFlatcVersion: true,
    flatc: 'C:\\Tools\\flatc.exe',
    toolsConfig: 'tools\\protocol-tools.json',
  });
});

test('parseArgs rejects unexpected args', () => {
  assert.throws(() => parseArgs(['--unexpected']), /Unexpected argument: --unexpected/);
});

test('parseArgs rejects missing flatc values', () => {
  assert.throws(() => parseArgs(['--flatc']), /Missing value for --flatc/);
  assert.throws(() => parseArgs(['--flatc', '--allow-different-flatc-version']), /Missing value for --flatc/);
});

test('parseArgs rejects missing tools config values', () => {
  assert.throws(() => parseArgs(['--tools-config']), /Missing value for --tools-config/);
  assert.throws(() => parseArgs(['--tools-config', '--flatc']), /Missing value for --tools-config/);
});

test('getProtocolToolsConfigPath routes to the repository tools config by default', () => {
  const repoRoot = path.join(path.sep, 'repo', 'UnrealPackageInsight');

  assert.equal(
    getProtocolToolsConfigPath(repoRoot),
    path.join(repoRoot, 'tools', 'protocol-tools.json'),
  );
});

test('getConfiguredFlatc resolves repository-relative flatc path and platform download', () => {
  const tempDir = makeTempDir();
  try {
    const configPath = path.join(tempDir, 'tools.json');
    fs.writeFileSync(configPath, JSON.stringify({
      flatc: {
        version: '24.3.25',
        path: 'node-shell/.cache/flatc/24.3.25/win32-x64/flatc.exe',
        downloads: {
          'win32-x64': {
            url: 'https://example.test/flatc.zip',
            sha256: 'abc123',
          },
        },
      },
    }));

    assert.deepEqual(getConfiguredFlatc({
      repoRoot: tempDir,
      configPath,
      platform: 'win32',
      arch: 'x64',
    }), {
      version: '24.3.25',
      executable: path.join(tempDir, 'node-shell', '.cache', 'flatc', '24.3.25', 'win32-x64', 'flatc.exe'),
      download: {
        url: 'https://example.test/flatc.zip',
        sha256: 'abc123',
      },
      platformKey: 'win32-x64',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveFlatcPath prefers explicit argument and otherwise uses tools config', () => {
  const tempDir = makeTempDir();
  try {
    const configPath = path.join(tempDir, 'tools.json');
    fs.writeFileSync(configPath, JSON.stringify({
      flatc: {
        version: '24.3.25',
        path: 'tools/flatc.exe',
        downloads: {},
      },
    }));

    assert.equal(
      resolveFlatcPath({ repoRoot: tempDir, explicitFlatc: 'C:\\Tools\\flatc.exe', configPath }),
      'C:\\Tools\\flatc.exe',
    );
    assert.equal(
      resolveFlatcPath({ repoRoot: tempDir, configPath }),
      path.join(tempDir, 'tools', 'flatc.exe'),
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generate-protocol script does not read workflow variables from environment variables', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'generate-protocol.js'), 'utf8');

  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /UPI_FLATC/);
});

test('getProtocolOutputPaths routes C++ to the Unreal Program and JS/TS to the Node protocol package', () => {
  const repoRoot = path.join(path.sep, 'repo', 'UnrealPackageInsight');

  assert.deepEqual(getProtocolOutputPaths(repoRoot), {
    repoRoot,
    nodeShellDir: path.join(repoRoot, 'node-shell'),
    protocolDir: path.join(repoRoot, 'node-shell', 'packages', 'protocol'),
    cppOut: path.join(
      repoRoot,
      'ue-backend',
      'UnrealPackageInsightBackend',
      'Source',
      'UnrealPackageInsightBackend',
      'Generated',
      'Protocol',
    ),
    tsOut: path.join(repoRoot, 'node-shell', 'packages', 'protocol', 'generated', 'ts'),
    jsOut: path.join(repoRoot, 'node-shell', 'packages', 'protocol', 'generated', 'js'),
    nodeGeneratedDir: path.join(repoRoot, 'node-shell', 'packages', 'protocol', 'generated'),
  });
});

test('removeLegacyCppOutput removes stale Node protocol C++ output only', () => {
  const tempDir = makeTempDir();
  try {
    const paths = getProtocolOutputPaths(tempDir);
    const legacyCppDir = path.join(paths.nodeGeneratedDir, 'cpp');
    const tsDir = path.join(paths.nodeGeneratedDir, 'ts');
    fs.mkdirSync(path.join(legacyCppDir, 'nested'), { recursive: true });
    fs.mkdirSync(tsDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCppDir, 'nested', 'stale_generated.h'), 'stale');
    fs.writeFileSync(path.join(tsDir, 'keep.ts'), 'keep');

    removeLegacyCppOutput(paths);

    assert.equal(fs.existsSync(legacyCppDir), false);
    assert.equal(fs.existsSync(path.join(tsDir, 'keep.ts')), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildFlatcCommands builds cpp and ts commands with common schema first', () => {
  const commands = buildFlatcCommands({
    flatc: 'flatc-bin',
    protocolDir: 'protocol',
    cppOut: 'cpp-out',
    tsOut: 'ts-out',
  });

  assert.deepEqual(commands, [
    {
      executable: 'flatc-bin',
      label: 'C++',
      args: [
        '--warnings-as-errors',
        '--cpp',
        '--filename-suffix',
        '_generated',
        '-o',
        'cpp-out',
        '-I',
        'protocol',
        path.join('protocol', 'upi_common.fbs'),
        path.join('protocol', 'upi_backend_info.fbs'),
        path.join('protocol', 'upi_pak_analysis.fbs'),
        path.join('protocol', 'upi_iostore_analysis.fbs'),
        path.join('protocol', 'upi_extract_response.fbs'),
      ],
    },
    {
      executable: 'flatc-bin',
      label: 'TypeScript',
      args: [
        '--warnings-as-errors',
        '--ts',
        '-o',
        'ts-out',
        '-I',
        'protocol',
        path.join('protocol', 'upi_common.fbs'),
        path.join('protocol', 'upi_backend_info.fbs'),
        path.join('protocol', 'upi_pak_analysis.fbs'),
        path.join('protocol', 'upi_iostore_analysis.fbs'),
        path.join('protocol', 'upi_extract_response.fbs'),
      ],
    },
  ]);

  const repoRoot = path.join(path.sep, 'repo', 'UnrealPackageInsight');
  const outputs = getProtocolOutputPaths(repoRoot);
  const routedCommands = buildFlatcCommands({
    flatc: 'flatc-bin',
    protocolDir: outputs.protocolDir,
    cppOut: outputs.cppOut,
    tsOut: outputs.tsOut,
  });
  assert.equal(
    routedCommands[0].args[routedCommands[0].args.indexOf('-o') + 1],
    outputs.cppOut,
  );
  assert.equal(
    routedCommands[1].args[routedCommands[1].args.indexOf('-o') + 1],
    outputs.tsOut,
  );
});

test('setGeneratedTypescriptBarrel writes explicit barrel exports', () => {
  const tempDir = makeTempDir();
  try {
    const barrelPath = path.join(tempDir, 'v1.ts');
    setGeneratedTypescriptBarrel(barrelPath);

    assert.equal(fs.readFileSync(barrelPath, 'utf8'), [
      '// automatically generated by the FlatBuffers compiler, do not modify',
      '',
      '/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */',
      '',
      "export { BackendInfoResponse } from './v1/backend-info-response.js';",
      "export { ExtractResponse } from './v1/extract-response.js';",
      "export { IoStoreAnalysisResponse } from './v1/io-store-analysis-response.js';",
      "export { IoStoreChunkEntry } from './v1/io-store-chunk-entry.js';",
      "export { IoStoreCompressedBlockEntry } from './v1/io-store-compressed-block-entry.js';",
      "export { IoStoreOverview } from './v1/io-store-overview.js';",
      "export { IoStorePackageEntry } from './v1/io-store-package-entry.js';",
      "export { IoStorePartition } from './v1/io-store-partition.js';",
      "export { Issue } from './v1/issue.js';",
      "export { IssueSeverity } from './v1/issue-severity.js';",
      "export { PakAnalysisResponse } from './v1/pak-analysis-response.js';",
      "export { PakCompressedBlockEntry } from './v1/pak-compressed-block-entry.js';",
      "export { PakOverview } from './v1/pak-overview.js';",
      "export { PakPackageEntry } from './v1/pak-package-entry.js';",
      "export { ResponseStatus } from './v1/response-status.js';",
      '',
    ].join('\n'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('normalizeLineEndings converts nested generated files to LF', () => {
  const tempDir = makeTempDir();
  try {
    const nestedDir = path.join(tempDir, 'nested');
    fs.mkdirSync(nestedDir);
    const crlfPath = path.join(tempDir, 'crlf.txt');
    const crPath = path.join(nestedDir, 'cr.txt');
    fs.writeFileSync(crlfPath, 'a\r\nb\r\n');
    fs.writeFileSync(crPath, 'c\rd\r');

    normalizeLineEndings(tempDir);

    assert.equal(fs.readFileSync(crlfPath, 'utf8'), 'a\nb\n');
    assert.equal(fs.readFileSync(crPath, 'utf8'), 'c\nd\n');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getTypescriptCompiler returns local compiler path for each platform', () => {
  const tempDir = makeTempDir();
  try {
    const binDir = path.join(tempDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const winTsc = path.join(binDir, 'tsc.cmd');
    const posixTsc = path.join(binDir, 'tsc');
    fs.writeFileSync(winTsc, '');
    fs.writeFileSync(posixTsc, '');

    assert.equal(getTypescriptCompiler(tempDir, 'win32'), winTsc);
    assert.equal(getTypescriptCompiler(tempDir, 'linux'), posixTsc);
    assert.equal(getTypescriptCompiler(tempDir, 'darwin'), posixTsc);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getTypescriptCompiler rejects missing or non-file compiler paths', () => {
  const missingDir = makeTempDir();
  const directoryCompilerDir = makeTempDir();
  try {
    assert.throws(
      () => getTypescriptCompiler(missingDir, 'linux'),
      /TypeScript compiler not found at .*node_modules.*\.bin.*tsc/,
    );

    const binDir = path.join(directoryCompilerDir, 'node_modules', '.bin');
    fs.mkdirSync(path.join(binDir, 'tsc'), { recursive: true });
    assert.throws(
      () => getTypescriptCompiler(directoryCompilerDir, 'linux'),
      /TypeScript compiler not found at .*node_modules.*\.bin.*tsc/,
    );
  } finally {
    fs.rmSync(missingDir, { recursive: true, force: true });
    fs.rmSync(directoryCompilerDir, { recursive: true, force: true });
  }
});
