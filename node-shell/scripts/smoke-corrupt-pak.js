#!/usr/bin/env node

const assert = require('node:assert/strict');
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

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function prependPath(directory) {
  process.env.PATH = `${directory}${path.delimiter}${process.env.PATH || ''}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dllPath = args.dll;
  if (!dllPath) {
    throw new Error('Usage: smoke-corrupt-pak.js --dll <UnrealPackageInsightBackend.dll> [--engine-root <EngineRoot>]');
  }

  const engineRoot = args['engine-root'] || 'C:\\WORKSPACE_UE\\UnrealEngine';
  assert.equal(fs.existsSync(dllPath), true, `Backend DLL not found: ${dllPath}`);

  const corruptRoot = path.join(repoRootFromScript(), 'artifacts', 'tmp', 'pak-corrupt-smoke');
  ensureDirectory(corruptRoot);
  const pakPath = path.join(corruptRoot, 'corrupt-Windows.pak');
  fs.writeFileSync(pakPath, Buffer.from('not a valid pak file'));

  prependPath(path.dirname(dllPath));
  prependPath(path.join(engineRoot, 'Engine', 'Binaries', 'Win64'));

  const koffi = require('koffi');
  const { createBackendClient } = require('../packages/backend-core/src/backend-client.js');
  const client = createBackendClient({ dllPath, koffi });
  const response = client.analyzePak({ pakPath, aesKey: '' });

  assert.equal(response.status, 1);
  assert.equal(response.overview.pakPath, pakPath);
  assert.equal(response.packages.length, 0);
  assert.equal(response.compressedBlocks.length, 0);
  assert.equal(response.issues.length > 0, true);
  assert.match(response.issues[0].code, /^pak\./);

  console.log(JSON.stringify({
    pakPath,
    status: response.status,
    issues: response.issues,
  }, null, 2));
}

main();
