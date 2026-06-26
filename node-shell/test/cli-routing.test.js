const assert = require('node:assert/strict');
const test = require('node:test');

const { main, parseCli } = require('../src/index.js');

test('parseCli recognizes help forms', () => {
  assert.deepEqual(parseCli(['node', 'index.js', '--help']), { command: 'help' });
  assert.deepEqual(parseCli(['node', 'index.js', '-h']), { command: 'help' });
  assert.deepEqual(parseCli(['node', 'index.js', 'help']), { command: 'help' });
  assert.deepEqual(parseCli(['node', 'index.js', 'help', 'analyze']), {
    command: 'help',
    topic: 'analyze',
  });
});

test('parseCli recognizes analyze, extract, and export-csv options', () => {
  assert.deepEqual(
    parseCli([
      'node',
      'index.js',
      'analyze',
      'C:\\Paks\\pakchunk0-Windows.pak',
      '--backend-id',
      'ue-5.7',
      '--aes-key',
      '0x1234',
      '--pretty',
    ]),
    {
      command: 'analyze',
      filePath: 'C:\\Paks\\pakchunk0-Windows.pak',
      backendId: 'ue-5.7',
      aesKey: '0x1234',
      pretty: true,
    },
  );

  assert.deepEqual(
    parseCli([
      'node',
      'index.js',
      'extract',
      'C:\\Paks\\pakchunk0-Windows.pak',
      '--out-dir',
      'C:\\Extracted',
      '--backend-id',
      'ue-5.7',
      '--aes-key',
      '0x1234',
    ]),
    {
      command: 'extract',
      filePath: 'C:\\Paks\\pakchunk0-Windows.pak',
      outputDirectory: 'C:\\Extracted',
      backendId: 'ue-5.7',
      aesKey: '0x1234',
    },
  );

  assert.deepEqual(
    parseCli([
      'node',
      'index.js',
      'export-csv',
      'C:\\Paks\\pakchunk0-Windows.pak',
      '--out',
      'C:\\Exports\\packages.csv',
    ]),
    {
      command: 'export-csv',
      filePath: 'C:\\Paks\\pakchunk0-Windows.pak',
      outputPath: 'C:\\Exports\\packages.csv',
    },
  );
});

test('help prints upi-cli usage without loading dependencies', async () => {
  const output = [];
  const exitState = {};
  const fail = () => {
    throw new Error('dependency should not be loaded for help');
  };

  await main({
    argv: ['node', 'index.js', 'help', 'extract'],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests: fail,
    probeContainerFile: fail,
    operations: {
      analyzeContainer: fail,
      extractContainer: fail,
      exportPackagesCsv: fail,
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.match(output.join('\n'), /Usage:\n  upi-cli extract <file> --out-dir <directory>/);
  assert.doesNotMatch(output.join('\n'), /node src\/index\.js/);
});

test('unknown help topic prints top-level usage and exits with failure', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'help', 'bogus'],
    log: (line) => output.push(line),
    processController: exitState,
  });

  assert.equal(exitState.exitCode, 1);
  assert.match(output.join('\n'), /^Unknown help topic: bogus\nUsage:/);
  assert.match(output.join('\n'), /upi-cli analyze <file>/);
});

test('list-backends prints manifest ids', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'list-backends'],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests: () => [
      { id: 'ue-5.7.4-win32-x64-development', engineVersion: '5.7.4', configuration: 'Development' },
    ],
  });

  assert.deepEqual(output, ['ue-5.7.4-win32-x64-development UE 5.7.4 Development']);
  assert.equal(exitState.exitCode ?? 0, 0);
});

test('probe prints container probe JSON', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'probe', 'C:\\Paks\\pakchunk0-Windows.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    probeContainerFile: (filePath) => ({
      containerType: 'pak',
      path: filePath,
      pakFormatVersion: 12,
    }),
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(JSON.parse(output[0]), {
    containerType: 'pak',
    path: 'C:\\Paks\\pakchunk0-Windows.pak',
    pakFormatVersion: 12,
  });
});

test('analyze dispatches to injected shared operation and prints JSON safely', async () => {
  const output = [];
  const exitState = {};
  const calls = [];
  const loadBackendManifests = () => [{ id: 'manifest' }];
  const probeContainerFile = () => ({ containerType: 'pak' });

  await main({
    argv: [
      'node',
      'index.js',
      'analyze',
      'C:\\Paks\\pakchunk0-Windows.pak',
      '--backend-id',
      'missing-is-still-passed-through',
      '--aes-key',
      '0x1234',
    ],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests,
    probeContainerFile,
    operations: {
      async analyzeContainer(options) {
        calls.push(options);
        return { status: 'OK', packageCount: 3n };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(calls, [{
    filePath: 'C:\\Paks\\pakchunk0-Windows.pak',
    backendId: 'missing-is-still-passed-through',
    aesKey: '0x1234',
    loadBackendManifests,
    probeContainerFile,
  }]);
  assert.deepEqual(JSON.parse(output[0]), { status: 'OK', packageCount: '3' });
});

test('analyze --pretty prints indented JSON', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\pakchunk0-Windows.pak', '--pretty'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async analyzeContainer() {
        return { status: 'OK', nested: { packageCount: 3 } };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.match(output[0], /\{\n  "status": "OK",\n  "nested": \{\n    "packageCount": 3\n  \}\n\}/);
});

test('extract dispatches to injected shared operation and prints JSON', async () => {
  const output = [];
  const exitState = {};
  const calls = [];

  await main({
    argv: [
      'node',
      'index.js',
      'extract',
      'C:\\Paks\\pakchunk0-Windows.pak',
      '--out-dir',
      'C:\\Extracted',
      '--backend-id',
      'ue-5.7',
      '--aes-key',
      '0x1234',
    ],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async extractContainer(options) {
        calls.push(options);
        return { status: 'OK', extractedCount: 2 };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.equal(calls[0].filePath, 'C:\\Paks\\pakchunk0-Windows.pak');
  assert.equal(calls[0].outputDirectory, 'C:\\Extracted');
  assert.equal(calls[0].backendId, 'ue-5.7');
  assert.equal(calls[0].aesKey, '0x1234');
  assert.deepEqual(JSON.parse(output[0]), { status: 'OK', extractedCount: 2 });
});

test('export-csv dispatches to injected shared operation and prints JSON', async () => {
  const output = [];
  const exitState = {};
  const calls = [];

  await main({
    argv: [
      'node',
      'index.js',
      'export-csv',
      'C:\\Paks\\pakchunk0-Windows.pak',
      '--out',
      'C:\\Exports\\packages.csv',
    ],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async exportPackagesCsv(options) {
        calls.push(options);
        return { status: 'OK', filePath: 'C:\\Exports\\packages.csv', packageCount: 2 };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.equal(calls[0].filePath, 'C:\\Paks\\pakchunk0-Windows.pak');
  assert.equal(calls[0].outputPath, 'C:\\Exports\\packages.csv');
  assert.deepEqual(JSON.parse(output[0]), {
    status: 'OK',
    filePath: 'C:\\Exports\\packages.csv',
    packageCount: 2,
  });
});

test('operation commands exit with failure for structured error results', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\missing.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async analyzeContainer() {
        return {
          status: 'Error',
          issues: [{
            severity: 'error',
            code: 'container.file_unavailable',
            message: 'Selected container file is unavailable.',
          }],
        };
      },
    },
  });

  assert.equal(exitState.exitCode, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'container.file_unavailable',
      message: 'Selected container file is unavailable.',
    }],
  });
});

test('operation commands exit with failure for native non-zero status results', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'extract', 'C:\\Paks\\Container.pak', '--out-dir', 'C:\\Out'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async extractContainer() {
        return { status: 1, errorCount: 1, issues: [] };
      },
    },
  });

  assert.equal(exitState.exitCode, 1);
  assert.deepEqual(JSON.parse(output[0]), { status: 1, errorCount: 1, issues: [] });
});

test('default analyze preserves structured file-unavailable errors for missing parent directories', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\DefinitelyMissing\\Nope\\Container.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests: () => [],
    probeContainerFile: () => {
      throw new Error('file-unavailable analysis should not probe missing files');
    },
  });

  assert.equal(exitState.exitCode, 1);
  assert.deepEqual(JSON.parse(output[0]), {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'container.file_unavailable',
      message: 'Selected container file is unavailable.',
    }],
  });
});

test('usage errors use upi-cli command names', () => {
  assert.throws(
    () => parseCli(['node', 'index.js', 'extract', 'C:\\Paks\\pakchunk0-Windows.pak']),
    /Usage:\n  upi-cli extract <file> --out-dir <directory>/,
  );
  assert.throws(
    () => parseCli(['node', 'index.js', 'wat']),
    /upi-cli list-backends/,
  );
});
