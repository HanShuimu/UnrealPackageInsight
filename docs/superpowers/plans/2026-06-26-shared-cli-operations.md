# Shared CLI Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a simple CLI for analyze, extract, and packages CSV export while keeping CLI and GUI behavior on shared backend/domain modules.

**Architecture:** Add a shared `container-operations.js` module under `analysis-domain` for operation setup and high-level analyze/extract/export flows. Refactor the CLI entrypoint to parse command-line arguments and delegate to this shared module. Existing GUI behavior remains intact and continues to use shared domain modules rather than CLI-specific code.

**Tech Stack:** Node.js CommonJS, Node `node:test`, `koffi`, existing `backend-core`, existing `analysis-domain`, existing FlatBuffer decoders, existing packages CSV export module.

---

## File Structure

- Create `node-shell/packages/analysis-domain/src/container-operations.js`
  Shared high-level operations for CLI and GUI-adjacent flows: sibling container discovery, AES session setup, backend provider setup, analyze, extract, and CSV export.

- Create `node-shell/packages/analysis-domain/test/container-operations.test.js`
  Node tests for shared operation setup, AES behavior, backend id selection, extract dispatch, CSV serialization, empty CSV refusal, and path normalization.

- Modify `node-shell/src/index.js`
  Keep the CLI shell here: argv parsing, usage strings, stdout JSON formatting, exit codes, and command dispatch into `container-operations.js`.

- Modify `node-shell/test/cli-routing.test.js`
  Extend CLI tests for `--help`, `-h`, `help`, command-specific help, `--aes-key`, `--pretty`, `extract`, `export-csv`, required option validation, dependency injection, and no duplicated backend dispatch.

The existing command remains `npm --prefix node-shell run cli -- <command>`. This plan does not add a root `cli` script.

---

### Task 1: Shared Container Operations Module

**Files:**
- Create: `node-shell/packages/analysis-domain/src/container-operations.js`
- Create: `node-shell/packages/analysis-domain/test/container-operations.test.js`

- [ ] **Step 1: Write failing tests for operation context and sibling discovery**

Create `node-shell/packages/analysis-domain/test/container-operations.test.js` with these initial tests:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createContainerOperationContext,
  listSiblingContainerFiles,
} = require('../src/container-operations.js');

function createFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('listSiblingContainerFiles returns sibling container files only', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-cli-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'A.pak');
  const utocPath = path.join(root, 'global.utoc');
  const ucasPath = path.join(root, 'global.ucas');
  createFile(pakPath, 'pak');
  createFile(utocPath, 'utoc');
  createFile(ucasPath, 'ucas');
  createFile(path.join(root, 'readme.txt'), 'ignore');

  assert.deepEqual(
    listSiblingContainerFiles(pakPath).map((filePath) => path.win32.basename(filePath)).sort(),
    ['A.pak', 'global.ucas', 'global.utoc'],
  );
});

test('createContainerOperationContext wires AnalysisService with AES and backend selection', async () => {
  const calls = [];
  const serviceOptions = [];
  class FakeAnalysisService {
    constructor(options) {
      serviceOptions.push(options);
    }
  }

  const context = await createContainerOperationContext({
    filePath: 'C:\\Paks\\A.pak',
    aesKey: '0xABCDEFABCDEFABCDEFABCDEFABCDEFAB',
    backendId: 'ue-5.8.0-win32-x64-development',
    filePaths: ['C:\\Paks\\A.pak'],
    AnalysisService: FakeAnalysisService,
    loadBackendManifests: () => [{
      id: 'ue-5.8.0-win32-x64-development',
      dllPath: 'C:\\Backend\\dev.dll',
      engineVersion: '5.8.0',
      configuration: 'Development',
      protocolVersion: 1,
      supports: { pak: { versionMin: 1, versionMax: 12 } },
    }],
    providerFactory(options) {
      calls.push({ type: 'providerFactory', options });
      return {
        setSelection(filePath, backendId) {
          calls.push({ type: 'setSelection', filePath, backendId });
        },
        resolveForFile() {
          throw new Error('resolveForFile is not called while creating context');
        },
      };
    },
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    koffi: { fake: true },
  });

  assert.equal(context.filePath, 'C:\\Paks\\A.pak');
  assert.deepEqual(context.filePaths, ['C:\\Paks\\A.pak']);
  assert.equal(context.aesSession.getKey(), 'abcdefabcdefabcdefabcdefabcdefab');
  assert.equal(context.service instanceof FakeAnalysisService, true);
  assert.deepEqual(calls.map((call) => call.type), ['providerFactory', 'setSelection']);
  assert.equal(calls[1].filePath, 'C:\\Paks\\A.pak');
  assert.equal(calls[1].backendId, 'ue-5.8.0-win32-x64-development');
  assert.equal(serviceOptions[0].filePaths, context.filePaths);
  assert.equal(serviceOptions[0].aesSession, context.aesSession);
  assert.ok(serviceOptions[0].backendClientProvider);
});
```

- [ ] **Step 2: Run the shared tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/container-operations.test.js
```

Expected: FAIL with `Cannot find module '../src/container-operations.js'`.

- [ ] **Step 3: Implement context creation and sibling discovery**

Create `node-shell/packages/analysis-domain/src/container-operations.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const koffi = require('koffi');

const { createBackendClientProvider } = require('../../backend-core/src/backend-client-provider.js');
const { loadBackendManifests } = require('../../backend-core/src/backend-registry.js');
const { AnalysisService } = require('./analysis-service.js');
const { AesKeySession } = require('./aes-key-session.js');
const { getContainerKind } = require('./container-pairing.js');
const { probeContainerFile } = require('./container-probe.js');

function listSiblingContainerFiles(filePath, fsModule = fs) {
  const directory = path.win32.dirname(filePath);
  return fsModule.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.win32.join(directory, entry.name))
    .filter((candidatePath) => getContainerKind(candidatePath) !== 'unsupported');
}

async function createContainerOperationContext({
  filePath,
  aesKey = '',
  backendId = '',
  filePaths,
  fsModule = fs,
  koffiModule = koffi,
  loadBackendManifests: loadBackendManifestsFn = loadBackendManifests,
  providerFactory = createBackendClientProvider,
  probeContainerFile: probeContainerFileFn = probeContainerFile,
  AnalysisService: AnalysisServiceClass = AnalysisService,
} = {}) {
  if (!filePath || String(filePath).trim() === '') {
    throw new Error('Container file path is required.');
  }

  const resolvedFilePaths = Array.isArray(filePaths)
    ? filePaths
    : listSiblingContainerFiles(filePath, fsModule);
  const manifests = loadBackendManifestsFn();
  const selectionStore = new Map();
  const backendClientProvider = providerFactory({
    manifests,
    koffi: koffiModule,
    probeContainerFile: probeContainerFileFn,
    selectionStore,
  });
  const aesSession = new AesKeySession();
  if (aesKey) {
    aesSession.setKey(aesKey);
  }
  if (backendId) {
    const targetPath = filePath;
    selectionStore.set(targetPath, backendId);
    if (backendClientProvider && typeof backendClientProvider.setSelection === 'function') {
      backendClientProvider.setSelection(targetPath, backendId);
    }
  }

  const service = new AnalysisServiceClass({
    backendClientProvider,
    filePaths: resolvedFilePaths,
    aesSession,
  });

  return {
    aesSession,
    backendClientProvider,
    filePath,
    filePaths: resolvedFilePaths,
    manifests,
    service,
  };
}

module.exports = {
  createContainerOperationContext,
  listSiblingContainerFiles,
};
```

- [ ] **Step 4: Run the shared tests and verify they pass**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/container-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the context module**

Run:

```powershell
git add node-shell/packages/analysis-domain/src/container-operations.js node-shell/packages/analysis-domain/test/container-operations.test.js
git commit -m "Add shared container operation context"
```

---

### Task 2: Shared Analyze And Extract Operations

**Files:**
- Modify: `node-shell/packages/analysis-domain/src/container-operations.js`
- Modify: `node-shell/packages/analysis-domain/test/container-operations.test.js`

- [ ] **Step 1: Add failing analyze and extract tests**

Append these tests to `node-shell/packages/analysis-domain/test/container-operations.test.js`:

```js
const {
  analyzeContainer,
  extractContainer,
} = require('../src/container-operations.js');

test('analyzeContainer delegates to AnalysisService analyze with injected context', async () => {
  const calls = [];
  const result = await analyzeContainer({
    filePath: 'C:\\Paks\\A.pak',
    createContext: async () => ({
      service: {
        async analyze(filePath) {
          calls.push(filePath);
          return { status: 'OK', backendId: 'ue-5.8.0-win32-x64-development' };
        },
      },
    }),
  });

  assert.deepEqual(calls, ['C:\\Paks\\A.pak']);
  assert.deepEqual(result, { status: 'OK', backendId: 'ue-5.8.0-win32-x64-development' });
});

test('extractContainer requires an output directory and delegates to AnalysisService extract', async () => {
  const calls = [];
  const result = await extractContainer({
    filePath: 'C:\\Paks\\A.pak',
    outputDirectory: 'D:\\Out',
    createContext: async () => ({
      service: {
        async extract(filePath, outputDirectory) {
          calls.push({ filePath, outputDirectory });
          return { status: 'OK', outputDirectory };
        },
      },
    }),
  });

  assert.deepEqual(calls, [{ filePath: 'C:\\Paks\\A.pak', outputDirectory: 'D:\\Out' }]);
  assert.deepEqual(result, { status: 'OK', outputDirectory: 'D:\\Out' });
  await assert.rejects(
    () => extractContainer({
      filePath: 'C:\\Paks\\A.pak',
      outputDirectory: '',
      createContext: async () => {
        throw new Error('context should not be created');
      },
    }),
    /Output directory is required/,
  );
});
```

- [ ] **Step 2: Run the shared tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/container-operations.test.js
```

Expected: FAIL because `analyzeContainer` and `extractContainer` are not exported.

- [ ] **Step 3: Implement analyze and extract operations**

Update `node-shell/packages/analysis-domain/src/container-operations.js`:

```js
async function analyzeContainer({
  createContext = createContainerOperationContext,
  ...options
} = {}) {
  const context = await createContext(options);
  return context.service.analyze(context.filePath || options.filePath);
}

async function extractContainer({
  outputDirectory,
  createContext = createContainerOperationContext,
  ...options
} = {}) {
  if (!outputDirectory || String(outputDirectory).trim() === '') {
    throw new Error('Output directory is required.');
  }
  const context = await createContext(options);
  return context.service.extract(context.filePath || options.filePath, outputDirectory);
}

module.exports = {
  analyzeContainer,
  createContainerOperationContext,
  extractContainer,
  listSiblingContainerFiles,
};
```

- [ ] **Step 4: Run the shared tests and verify they pass**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/container-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit analyze and extract operations**

Run:

```powershell
git add node-shell/packages/analysis-domain/src/container-operations.js node-shell/packages/analysis-domain/test/container-operations.test.js
git commit -m "Share analyze and extract container operations"
```

---

### Task 3: Shared Packages CSV Operation

**Files:**
- Modify: `node-shell/packages/analysis-domain/src/container-operations.js`
- Modify: `node-shell/packages/analysis-domain/test/container-operations.test.js`

- [ ] **Step 1: Add failing CSV operation tests**

Append these tests to `node-shell/packages/analysis-domain/test/container-operations.test.js`:

```js
const {
  exportPackagesCsv,
  normalizeCsvOutputPath,
} = require('../src/container-operations.js');

test('normalizeCsvOutputPath appends csv extension and preserves existing csv extension', () => {
  assert.equal(normalizeCsvOutputPath('D:\\Exports\\A.pak.packages'), 'D:\\Exports\\A.pak.packages.csv');
  assert.equal(normalizeCsvOutputPath('D:\\Exports\\A.pak.packages.CSV'), 'D:\\Exports\\A.pak.packages.CSV');
});

test('exportPackagesCsv analyzes, serializes package rows, writes csv, and reports counts', async () => {
  const writes = [];
  const result = await exportPackagesCsv({
    filePath: 'C:\\Paks\\A.pak',
    outputPath: 'D:\\Exports\\A.pak.packages',
    createContext: async () => ({
      service: {
        async analyze() {
          return {
            status: 'OK',
            backendId: 'ue-5.8.0-win32-x64-development',
            packages: [
              { packagePath: '../../../Game/B.uasset', size: 20, compressedSize: 10, order: 2 },
              { packagePath: '../../../Game/A.uasset', size: 30, compressedSize: 15, order: 1 },
            ],
          };
        },
      },
    }),
    writeFile: async (filePath, content, encoding) => {
      writes.push({ filePath, content, encoding });
    },
  });

  assert.deepEqual(writes, [{
    filePath: 'D:\\Exports\\A.pak.packages.csv',
    content: '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/A.uasset,30,15,1\r\n../../../Game/B.uasset,20,10,2\r\n',
    encoding: 'utf8',
  }]);
  assert.deepEqual(result, {
    status: 'OK',
    filePath: 'D:\\Exports\\A.pak.packages.csv',
    packageCount: 2,
    byteCount: Buffer.byteLength(writes[0].content, 'utf8'),
    backendId: 'ue-5.8.0-win32-x64-development',
  });
});

test('exportPackagesCsv refuses to write an empty packages csv', async () => {
  const writes = [];
  await assert.rejects(
    () => exportPackagesCsv({
      filePath: 'C:\\Paks\\A.pak',
      outputPath: 'D:\\Exports\\A.csv',
      createContext: async () => ({
        service: {
          async analyze() {
            return { status: 'OK', packages: [] };
          },
        },
      }),
      writeFile: async (filePath, content, encoding) => {
        writes.push({ filePath, content, encoding });
      },
    }),
    /No packages to export/,
  );
  assert.deepEqual(writes, []);
});
```

- [ ] **Step 2: Run the shared tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/container-operations.test.js
```

Expected: FAIL because `exportPackagesCsv` and `normalizeCsvOutputPath` are not exported.

- [ ] **Step 3: Implement CSV operation**

Update `node-shell/packages/analysis-domain/src/container-operations.js`:

```js
const {
  buildPackageRows,
  serializePackagesCsv,
  sortPackageRows,
} = require('./packages-table-export.js');

function normalizeCsvOutputPath(filePath) {
  const outputPath = String(filePath || '');
  return path.extname(outputPath).toLowerCase() === '.csv' ? outputPath : `${outputPath}.csv`;
}

async function exportPackagesCsv({
  outputPath,
  createContext = createContainerOperationContext,
  writeFile = fs.promises.writeFile,
  ...options
} = {}) {
  if (!outputPath || String(outputPath).trim() === '') {
    throw new Error('CSV output path is required.');
  }

  const context = await createContext(options);
  const analysis = await context.service.analyze(context.filePath || options.filePath);
  const rows = sortPackageRows(buildPackageRows(analysis));
  if (rows.length === 0) {
    throw new Error('No packages to export.');
  }

  const filePath = normalizeCsvOutputPath(outputPath);
  const csvText = serializePackagesCsv(rows);
  await writeFile(filePath, csvText, 'utf8');
  return {
    status: 'OK',
    filePath,
    packageCount: rows.length,
    byteCount: Buffer.byteLength(csvText, 'utf8'),
    backendId: analysis.backendId,
  };
}

module.exports = {
  analyzeContainer,
  createContainerOperationContext,
  exportPackagesCsv,
  extractContainer,
  listSiblingContainerFiles,
  normalizeCsvOutputPath,
};
```

- [ ] **Step 4: Run the shared tests and verify they pass**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test packages/analysis-domain/test/container-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit CSV operation**

Run:

```powershell
git add node-shell/packages/analysis-domain/src/container-operations.js node-shell/packages/analysis-domain/test/container-operations.test.js
git commit -m "Share packages CSV container operation"
```

---

### Task 4: CLI Parser And Usage Contract

**Files:**
- Modify: `node-shell/src/index.js`
- Modify: `node-shell/test/cli-routing.test.js`

- [ ] **Step 1: Add failing parser tests**

Append these tests to `node-shell/test/cli-routing.test.js`:

```js
const { parseCli } = require('../src/index.js');

test('parseCli parses analyze options', () => {
  assert.deepEqual(parseCli([
    'node',
    'index.js',
    'analyze',
    'C:\\Paks\\A.pak',
    '--backend-id',
    'ue-5.8.0-win32-x64-development',
    '--aes-key',
    'abcdefabcdefabcdefabcdefabcdefab',
    '--pretty',
  ]), {
    command: 'analyze',
    filePath: 'C:\\Paks\\A.pak',
    backendId: 'ue-5.8.0-win32-x64-development',
    aesKey: 'abcdefabcdefabcdefabcdefabcdefab',
    pretty: true,
  });
});

test('parseCli parses extract and export-csv commands', () => {
  assert.deepEqual(parseCli([
    'node',
    'index.js',
    'extract',
    'C:\\Paks\\A.pak',
    '--out-dir',
    'D:\\Out',
    '--aes-key',
    'abc',
  ]), {
    command: 'extract',
    filePath: 'C:\\Paks\\A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc',
  });

  assert.deepEqual(parseCli([
    'node',
    'index.js',
    'export-csv',
    'C:\\Paks\\A.pak',
    '--out',
    'D:\\Exports\\A.csv',
    '--backend-id',
    'dev',
  ]), {
    command: 'export-csv',
    filePath: 'C:\\Paks\\A.pak',
    outputPath: 'D:\\Exports\\A.csv',
    backendId: 'dev',
  });
});

test('parseCli rejects missing required CLI output paths', () => {
  assert.throws(
    () => parseCli(['node', 'index.js', 'extract', 'C:\\Paks\\A.pak']),
    /Usage: node src\/index.js extract <file> --out-dir <directory>/,
  );
  assert.throws(
    () => parseCli(['node', 'index.js', 'export-csv', 'C:\\Paks\\A.pak']),
    /Usage: node src\/index.js export-csv <file> --out <file.csv>/,
  );
});

test('parseCli parses top-level and command-specific help', () => {
  assert.deepEqual(parseCli(['node', 'index.js', '--help']), {
    command: 'help',
    topic: '',
  });
  assert.deepEqual(parseCli(['node', 'index.js', '-h']), {
    command: 'help',
    topic: '',
  });
  assert.deepEqual(parseCli(['node', 'index.js', 'help']), {
    command: 'help',
    topic: '',
  });
  assert.deepEqual(parseCli(['node', 'index.js', 'help', 'extract']), {
    command: 'help',
    topic: 'extract',
  });
});
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test test/cli-routing.test.js
```

Expected: FAIL because `help`, `extract`, `export-csv`, `--aes-key`, and `--pretty` are not parsed.

- [ ] **Step 3: Refactor parser**

Update the parser section of `node-shell/src/index.js`:

```js
const USAGE = [
  'Usage:',
  '  node src/index.js --help',
  '  node src/index.js help [command]',
  '  node src/index.js list-backends',
  '  node src/index.js probe <file>',
  '  node src/index.js analyze <file> [--backend-id <id>] [--aes-key <key>] [--pretty]',
  '  node src/index.js extract <file> --out-dir <directory> [--backend-id <id>] [--aes-key <key>]',
  '  node src/index.js export-csv <file> --out <file.csv> [--backend-id <id>] [--aes-key <key>]',
].join('\n');

const HELP_TOPICS = {
  '': USAGE,
  'list-backends': 'Usage: node src/index.js list-backends',
  probe: 'Usage: node src/index.js probe <file>',
  analyze: 'Usage: node src/index.js analyze <file> [--backend-id <id>] [--aes-key <key>] [--pretty]',
  extract: 'Usage: node src/index.js extract <file> --out-dir <directory> [--backend-id <id>] [--aes-key <key>]',
  'export-csv': 'Usage: node src/index.js export-csv <file> --out <file.csv> [--backend-id <id>] [--aes-key <key>]',
};

function readOption(args, index, usage) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(usage);
  }
  return value;
}

function parseCommonOptions(args, startIndex, usage, allowedOptions) {
  const parsed = {};
  for (let index = startIndex; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--pretty' && allowedOptions.has('--pretty')) {
      parsed.pretty = true;
      continue;
    }
    if (option === '--backend-id' && allowedOptions.has('--backend-id')) {
      parsed.backendId = readOption(args, index, usage);
      index += 1;
      continue;
    }
    if (option === '--aes-key' && allowedOptions.has('--aes-key')) {
      parsed.aesKey = readOption(args, index, usage);
      index += 1;
      continue;
    }
    if (option === '--out-dir' && allowedOptions.has('--out-dir')) {
      parsed.outputDirectory = readOption(args, index, usage);
      index += 1;
      continue;
    }
    if (option === '--out' && allowedOptions.has('--out')) {
      parsed.outputPath = readOption(args, index, usage);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return parsed;
}

function parseCli(argv = process.argv) {
  const args = argv.slice(2);
  const [command] = args;

  if (command === '--help' || command === '-h' || command === 'help') {
    return {
      command: 'help',
      topic: command === 'help' ? (args[1] || '') : '',
    };
  }

  if (command === 'list-backends') {
    return { command };
  }

  if (command === 'probe') {
    const filePath = args[1];
    if (!filePath) {
      throw new Error('Usage: node src/index.js probe <file>');
    }
    return { command, filePath };
  }

  if (command === 'analyze') {
    const usage = 'Usage: node src/index.js analyze <file> [--backend-id <id>] [--aes-key <key>] [--pretty]';
    const filePath = args[1];
    if (!filePath) {
      throw new Error(usage);
    }
    return {
      command,
      filePath,
      ...parseCommonOptions(args, 2, usage, new Set(['--backend-id', '--aes-key', '--pretty'])),
    };
  }

  if (command === 'extract') {
    const usage = 'Usage: node src/index.js extract <file> --out-dir <directory> [--backend-id <id>] [--aes-key <key>]';
    const filePath = args[1];
    if (!filePath) {
      throw new Error(usage);
    }
    const parsed = parseCommonOptions(args, 2, usage, new Set(['--backend-id', '--aes-key', '--out-dir']));
    if (!parsed.outputDirectory) {
      throw new Error('Usage: node src/index.js extract <file> --out-dir <directory>');
    }
    return { command, filePath, ...parsed };
  }

  if (command === 'export-csv') {
    const usage = 'Usage: node src/index.js export-csv <file> --out <file.csv> [--backend-id <id>] [--aes-key <key>]';
    const filePath = args[1];
    if (!filePath) {
      throw new Error(usage);
    }
    const parsed = parseCommonOptions(args, 2, usage, new Set(['--backend-id', '--aes-key', '--out']));
    if (!parsed.outputPath) {
      throw new Error('Usage: node src/index.js export-csv <file> --out <file.csv>');
    }
    return { command, filePath, ...parsed };
  }

  throw new Error(USAGE);
}
```

- [ ] **Step 4: Run CLI tests and verify parser tests pass**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test test/cli-routing.test.js
```

Expected: existing tests may still fail because command execution has not been refactored, but the new parser tests pass.

- [ ] **Step 5: Commit parser changes**

Run:

```powershell
git add node-shell/src/index.js node-shell/test/cli-routing.test.js
git commit -m "Parse shared container CLI commands"
```

---

### Task 5: CLI Command Dispatch Through Shared Operations

**Files:**
- Modify: `node-shell/src/index.js`
- Modify: `node-shell/test/cli-routing.test.js`

- [ ] **Step 1: Add failing command dispatch tests**

Append these tests to `node-shell/test/cli-routing.test.js`:

```js
test('analyze delegates to shared analyzeContainer and prints compact JSON', async () => {
  const output = [];
  const exitState = {};
  const calls = [];

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\A.pak', '--aes-key', 'abc'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async analyzeContainer(options) {
        calls.push(options);
        return { status: 'OK', backendId: 'dev', packageCount: 1 };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(calls, [{
    filePath: 'C:\\Paks\\A.pak',
    aesKey: 'abc',
    backendId: undefined,
  }]);
  assert.equal(output[0], '{"status":"OK","backendId":"dev","packageCount":1}');
});

test('analyze --pretty prints indented JSON', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\A.pak', '--pretty'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async analyzeContainer() {
        return { status: 'OK', nested: { value: 1 } };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.match(output[0], /\{\n  "status": "OK"/);
});

test('extract and export-csv delegate to shared operations', async () => {
  const output = [];
  const exitState = {};
  const calls = [];

  await main({
    argv: ['node', 'index.js', 'extract', 'C:\\Paks\\A.pak', '--out-dir', 'D:\\Out', '--backend-id', 'dev'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async extractContainer(options) {
        calls.push({ command: 'extract', options });
        return { status: 'OK', outputDirectory: options.outputDirectory };
      },
    },
  });

  await main({
    argv: ['node', 'index.js', 'export-csv', 'C:\\Paks\\A.pak', '--out', 'D:\\A.csv', '--aes-key', 'abc'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async exportPackagesCsv(options) {
        calls.push({ command: 'export-csv', options });
        return { status: 'OK', filePath: options.outputPath, packageCount: 1, byteCount: 42 };
      },
    },
  });

  assert.deepEqual(calls, [
    {
      command: 'extract',
      options: {
        filePath: 'C:\\Paks\\A.pak',
        outputDirectory: 'D:\\Out',
        aesKey: undefined,
        backendId: 'dev',
      },
    },
    {
      command: 'export-csv',
      options: {
        filePath: 'C:\\Paks\\A.pak',
        outputPath: 'D:\\A.csv',
        aesKey: 'abc',
        backendId: undefined,
      },
    },
  ]);
  assert.equal(JSON.parse(output[0]).status, 'OK');
  assert.equal(JSON.parse(output[1]).status, 'OK');
});

test('help prints usage, exits zero, and does not call shared operations', async () => {
  const output = [];
  const exitState = {};
  let operationCallCount = 0;

  await main({
    argv: ['node', 'index.js', '--help'],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests: () => {
      throw new Error('help should not load backend manifests');
    },
    operations: {
      async analyzeContainer() {
        operationCallCount += 1;
      },
      async extractContainer() {
        operationCallCount += 1;
      },
      async exportPackagesCsv() {
        operationCallCount += 1;
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.equal(operationCallCount, 0);
  assert.match(output.join('\n'), /Usage:/);
  assert.match(output.join('\n'), /export-csv/);
});

test('help extract prints command-specific usage', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'help', 'extract'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {},
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(output, [
    'Usage: node src/index.js extract <file> --out-dir <directory> [--backend-id <id>] [--aes-key <key>]',
  ]);
});

test('unknown help topic exits one with a readable message', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'help', 'missing'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {},
  });

  assert.equal(exitState.exitCode, 1);
  assert.match(output.join('\n'), /Unknown help topic: missing/);
  assert.match(output.join('\n'), /Usage:/);
});
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test test/cli-routing.test.js
```

Expected: FAIL because `main` does not accept `operations` and command dispatch still uses old manual analysis.

- [ ] **Step 3: Refactor CLI dispatch**

Update `node-shell/src/index.js` imports:

```js
const defaultOperations = require('../packages/analysis-domain/src/container-operations.js');
```

Keep `loadBackendManifests` and `manifestLabel` for `list-backends`, and keep `probeContainerFile` for `probe`. Remove the old manual `analyzeContainer`, `resolveAnalysisTarget`, `defaultListContainerFiles`, and `selectBackendCandidates` path after tests are green.

Update JSON formatting:

```js
function jsonStringify(value, { pretty = false } = {}) {
  return JSON.stringify(value, (key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ), pretty ? 2 : 0);
}
```

In `main`, add:

```js
const operations = Array.isArray(options)
  ? defaultOperations
  : options.operations || defaultOperations;
```

Replace the analyze command branch with:

```js
if (parsed.command === 'analyze') {
  const result = await operations.analyzeContainer({
    filePath: parsed.filePath,
    aesKey: parsed.aesKey,
    backendId: parsed.backendId,
  });
  log(jsonStringify(result, { pretty: parsed.pretty }));
  processController.exitCode = 0;
  return 0;
}
```

Add extract:

```js
if (parsed.command === 'extract') {
  const result = await operations.extractContainer({
    filePath: parsed.filePath,
    outputDirectory: parsed.outputDirectory,
    aesKey: parsed.aesKey,
    backendId: parsed.backendId,
  });
  log(jsonStringify(result));
  processController.exitCode = 0;
  return 0;
}
```

Add CSV:

```js
if (parsed.command === 'export-csv') {
  const result = await operations.exportPackagesCsv({
    filePath: parsed.filePath,
    outputPath: parsed.outputPath,
    aesKey: parsed.aesKey,
    backendId: parsed.backendId,
  });
  log(jsonStringify(result));
  processController.exitCode = 0;
  return 0;
}
```

Add help before command operations:

```js
function helpText(topic = '') {
  return HELP_TOPICS[topic] || null;
}

if (parsed.command === 'help') {
  const text = helpText(parsed.topic);
  if (!text) {
    log(`Unknown help topic: ${parsed.topic}`);
    log(USAGE);
    processController.exitCode = 1;
    return 1;
  }
  log(text);
  processController.exitCode = 0;
  return 0;
}
```

- [ ] **Step 4: Update old CLI tests to match shared provider behavior**

In `node-shell/test/cli-routing.test.js`, replace old tests that expected multiple candidates to fail. The provider now owns candidate ordering and default selection. Keep one test proving `--backend-id` is passed through options instead of manually validated in CLI.

Use this replacement test:

```js
test('analyze passes explicit backend id to shared operations without local validation', async () => {
  const calls = [];
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\A.pak', '--backend-id', 'missing'],
    log: (line) => output.push(line),
    processController: exitState,
    operations: {
      async analyzeContainer(options) {
        calls.push(options);
        return { status: 'OK', selectedBackendId: options.backendId };
      },
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.equal(calls[0].backendId, 'missing');
  assert.deepEqual(JSON.parse(output[0]), { status: 'OK', selectedBackendId: 'missing' });
});
```

- [ ] **Step 5: Run CLI tests and verify they pass**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test test/cli-routing.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit CLI dispatch**

Run:

```powershell
git add node-shell/src/index.js node-shell/test/cli-routing.test.js
git commit -m "Route CLI through shared container operations"
```

---

### Task 6: Verification

**Files:**
- No required source edits.

- [ ] **Step 1: Run focused Node tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test test/cli-routing.test.js packages/analysis-domain/test/container-operations.test.js packages/analysis-domain/test/packages-table-export.test.js packages/backend-core/test/backend-client-provider.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full node-shell test suite**

Run:

```powershell
npm.cmd --prefix node-shell test
```

Expected: PASS.

- [ ] **Step 3: Run real-asset smoke commands when local assets exist**

If local packaged demo assets exist at `C:\WORKSPACE_Omni\AssetUpdate\Dist\Windows\AssetUpdateDemo\Content\Paks`, run:

```powershell
$assetDir = 'C:\WORKSPACE_Omni\AssetUpdate\Dist\Windows\AssetUpdateDemo\Content\Paks'
npm.cmd --prefix node-shell run cli -- analyze "$assetDir\AssetUpdateDemo-Windows.pak"
npm.cmd --prefix node-shell run cli -- analyze "$assetDir\AssetUpdateDemo-Windows.utoc"
npm.cmd --prefix node-shell run cli -- export-csv "$assetDir\AssetUpdateDemo-Windows.pak" --out "$env:TEMP\AssetUpdateDemo-Windows.pak.packages.csv"
```

Expected:

- each command exits `0`,
- analyze prints JSON with `status` and package data,
- CSV file exists,
- CSV starts with `Full Path,Size,Compressed,Order` after the UTF-8 BOM,
- CSV has CRLF row endings.

- [ ] **Step 4: Review git status**

Run:

```powershell
git status --short
```

Expected: only files changed by this CLI feature are present. Do not stage unrelated existing changes under `node-shell/native/**`, `node-shell/package.json`, `node-shell/package-lock.json`, or `node-shell/Engine/` unless the implementing user explicitly asks to include them.

---

## Self-Review Notes

- Spec coverage: the tasks cover shared operation boundaries, CLI commands, AES, backend id selection, extract, packages CSV export, JSON output, tests, and avoidance of GUI-only duplication.
- Placeholder scan: the plan uses concrete files, commands, expected results, and code snippets. It contains no placeholder work items.
- Type consistency: command option names are `backendId`, `aesKey`, `outputDirectory`, and `outputPath` throughout the shared module and CLI tests.
