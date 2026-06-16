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

function stripUcasPartitionSuffix(baseName) {
  return baseName.replace(/_s\d+$/i, '');
}

function inferPair(selectedPath) {
  const parsed = path.parse(selectedPath);
  const extension = parsed.ext.toLowerCase();
  if (extension === '.utoc') {
    const basePath = path.join(parsed.dir, parsed.name);
    return {
      utocPath: selectedPath,
      ucasPath: `${basePath}.ucas`,
    };
  }

  if (extension === '.ucas') {
    const baseName = stripUcasPartitionSuffix(parsed.name);
    const basePath = path.join(parsed.dir, baseName);
    return {
      utocPath: `${basePath}.utoc`,
      ucasPath: selectedPath,
    };
  }

  throw new Error(`Expected .utoc or .ucas path, got: ${selectedPath}`);
}

function prependPath(directory) {
  process.env.PATH = `${directory}${path.delimiter}${process.env.PATH || ''}`;
}

function summarize(response) {
  return {
    status: response.status,
    issues: response.issues,
    overview: response.overview,
    partitions: response.partitions.length,
    packages: response.packages.length,
    chunks: response.chunks.length,
    compressedBlocks: response.compressedBlocks.length,
  };
}

function stringifyWithBigInts(value) {
  return JSON.stringify(value, (_key, innerValue) => (
    typeof innerValue === 'bigint' ? innerValue.toString() : innerValue
  ), 2);
}

function assertSuccessfulListing(response, label) {
  assert.equal(response.status, 0, `${label}: ${JSON.stringify(response.issues)}`);
  assert.ok(Number(response.overview.tocEntryCount) > 0, `${label}: expected tocEntryCount > 0`);
  assert.ok(response.chunks.length > 0, `${label}: expected chunk rows`);
  assert.notEqual(response.chunks[0]?.chunkId, '00000000000000000000000000000000', `${label}: still returned stub chunk`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dllPath = args.dll;
  const selectedPath = args.iostore;
  const aesKey = args['aes-key'] || '';
  const engineRoot = args['engine-root'] || 'C:\\WORKSPACE_UE\\UnrealEngine';
  if (!dllPath || !selectedPath) {
    throw new Error('Usage: smoke-analyze-iostore.js --dll <UnrealPackageInsightBackend.dll> --iostore <Path.utoc|Path.ucas> [--engine-root <EngineRoot>] [--aes-key <hex>]');
  }

  assert.equal(fs.existsSync(dllPath), true, `Backend DLL not found: ${dllPath}`);
  assert.equal(fs.existsSync(selectedPath), true, `IoStore file not found: ${selectedPath}`);

  const pair = inferPair(selectedPath);
  assert.equal(fs.existsSync(pair.utocPath), true, `Matching .utoc not found: ${pair.utocPath}`);
  assert.equal(fs.existsSync(pair.ucasPath), true, `Matching .ucas not found: ${pair.ucasPath}`);

  prependPath(path.dirname(dllPath));
  prependPath(path.join(engineRoot, 'Engine', 'Binaries', 'Win64'));

  const koffi = require('koffi');
  const { createBackendClient } = require('../packages/backend-core/src/backend-client.js');
  const client = createBackendClient({ dllPath, koffi });

  const fromUtoc = client.analyzeIoStore({ utocPath: pair.utocPath, ucasPath: '', aesKey });
  const fromUcas = client.analyzeIoStore({ utocPath: '', ucasPath: pair.ucasPath, aesKey });

  assertSuccessfulListing(fromUtoc, 'utoc selection');
  assertSuccessfulListing(fromUcas, 'ucas selection');
  assert.equal(fromUtoc.overview.containerBasePath, fromUcas.overview.containerBasePath);
  assert.equal(fromUtoc.overview.tocEntryCount, fromUcas.overview.tocEntryCount);
  assert.equal(fromUtoc.chunks.length, fromUcas.chunks.length);

  console.log(stringifyWithBigInts({
    utoc: summarize(fromUtoc),
    ucas: summarize(fromUcas),
    sampleChunks: fromUtoc.chunks.slice(0, 5).map((entry) => ({
      tocEntryIndex: entry.tocEntryIndex,
      packagePath: entry.packagePath,
      chunkType: entry.chunkType,
      offset: entry.offset.toString(),
      size: entry.size.toString(),
    })),
  }));
}

main();
