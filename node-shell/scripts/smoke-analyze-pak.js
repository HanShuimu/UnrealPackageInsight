#!/usr/bin/env node

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeFile(filePath, contents) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function unrealPakPath(engineRoot) {
  return path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealPak.exe');
}

function createTemporaryPak({ repoRoot, unrealPak }) {
  const smokeRoot = path.join(repoRoot, 'artifacts', 'tmp', 'pak-smoke');
  const inputRoot = path.join(smokeRoot, 'input');
  const pakPath = path.join(smokeRoot, 'pak-smoke-Windows.pak');
  const responsePath = path.join(smokeRoot, 'pak-response.txt');
  const files = [
    {
      source: path.join(inputRoot, 'Content', 'Smoke', 'Alpha.txt'),
      destination: '../../../PakSmoke/Content/Smoke/Alpha.txt',
      contents: 'alpha\n',
    },
    {
      source: path.join(inputRoot, 'Content', 'Smoke', 'Beta.txt'),
      destination: '../../../PakSmoke/Content/Smoke/Beta.txt',
      contents: 'beta\n',
    },
  ];

  ensureDirectory(smokeRoot);
  for (const file of files) {
    writeFile(file.source, file.contents);
  }

  const response = files.map((file) => `"${file.source}" "${file.destination}"`).join('\n');
  writeFile(responsePath, `${response}\n`);

  if (fs.existsSync(pakPath)) {
    fs.rmSync(pakPath, { force: true });
  }

  execFileSync(unrealPak, [pakPath, `-Create=${responsePath}`], { stdio: 'pipe' });

  return { pakPath, expectedPaths: files.map((file) => file.destination) };
}

function parseUnrealPakList(output) {
  const entries = [];
  for (const line of output.split(/\r?\n/)) {
    if (!/\boffset:\s*\d+/i.test(line)) {
      continue;
    }

    const quoted = line.match(/"([^"]+)"/);
    if (quoted && quoted[1] && !quoted[1].endsWith('.pak')) {
      entries.push(quoted[1]);
    }
  }
  return entries;
}

function listPak({ unrealPak, pakPath }) {
  const output = execFileSync(unrealPak, [pakPath, '-List'], { encoding: 'utf8' });
  const entries = parseUnrealPakList(output);
  if (entries.length === 0) {
    throw new Error(`Unable to parse UnrealPak -List output:\n${output}`);
  }

  return entries;
}

function prependPath(directory) {
  process.env.PATH = `${directory}${path.delimiter}${process.env.PATH || ''}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromScript();
  const engineRoot = args['engine-root'] || 'C:\\WORKSPACE_UE\\UnrealEngine';
  const dllPath = args.dll;
  if (!dllPath) {
    throw new Error('Usage: smoke-analyze-pak.js --dll <UnrealPackageInsightBackend.dll> [--engine-root <EngineRoot>] [--pak <PakPath>]');
  }

  const unrealPak = unrealPakPath(engineRoot);
  assert.equal(fs.existsSync(unrealPak), true, `UnrealPak.exe not found: ${unrealPak}`);
  assert.equal(fs.existsSync(dllPath), true, `Backend DLL not found: ${dllPath}`);

  const manualPak = args.pak || path.join(repoRoot, 'artifacts', 'manual-test', 'pakchunk0-Windows.pak');
  const pak = fs.existsSync(manualPak)
    ? { pakPath: manualPak, expectedPaths: null }
    : createTemporaryPak({ repoRoot, unrealPak });

  prependPath(path.dirname(dllPath));
  prependPath(path.join(engineRoot, 'Engine', 'Binaries', 'Win64'));

  const koffi = require('koffi');
  const { createBackendClient } = require('../packages/backend-core/src/backend-client.js');
  const client = createBackendClient({ dllPath, koffi });
  const response = client.analyzePak({ pakPath: pak.pakPath, aesKey: '' });
  const listedPaths = listPak({ unrealPak, pakPath: pak.pakPath });

  assert.equal(response.status, 0, JSON.stringify(response.issues));
  assert.equal(response.overview.pakPath, pak.pakPath);
  assert.equal(response.overview.packageCount, listedPaths.length);
  assert.equal(response.packages.length, listedPaths.length);
  assert.notEqual(response.packages[0]?.packagePath, '/Game/Stub/Asset.uasset');
  assert.deepEqual(
    response.packages.map((entry) => Number(entry.order)),
    response.packages.map((_, index) => index)
  );

  if (pak.expectedPaths) {
    for (const expectedPath of pak.expectedPaths) {
      assert.equal(
        response.packages.some((entry) => entry.packagePath.endsWith(expectedPath.replace(/\\/g, '/'))),
        true,
        `Expected package path not found in backend response: ${expectedPath}`
      );
    }
  }

  console.log(JSON.stringify({
    pakPath: pak.pakPath,
    packageCount: response.overview.packageCount,
    samplePackages: response.packages.slice(0, 5).map((entry) => entry.packagePath),
    unrealPakSample: listedPaths.slice(0, 5),
  }, null, 2));
}

main();
