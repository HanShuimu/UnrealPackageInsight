const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIoStorePairs,
  getContainerKind,
  resolveIoStoreSelection,
  stripIoStorePartitionSuffix,
} = require('../src/container-pairing.js');

test('classifies supported container kinds by lowercase extension', () => {
  assert.equal(getContainerKind('C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak'), 'pak');
  assert.equal(getContainerKind('C:\\Game\\Content\\Paks\\global.utoc'), 'utoc');
  assert.equal(getContainerKind('C:\\Game\\Content\\Paks\\global.ucas'), 'ucas');
  assert.equal(getContainerKind('C:\\Game\\Game.exe'), 'unsupported');
});

test('strips IoStore UCAS partition suffixes case-insensitively', () => {
  assert.equal(stripIoStorePartitionSuffix('global_s1'), 'global');
  assert.equal(stripIoStorePartitionSuffix('global_S12'), 'global');
  assert.equal(stripIoStorePartitionSuffix('global_sidecar'), 'global_sidecar');
});

test('resolves a selected UCAS file back to its matching UTOC file', () => {
  const utocPath = 'C:\\Game\\Content\\Paks\\global.utoc';
  const ucasPath = 'C:\\Game\\Content\\Paks\\global.ucas';

  assert.deepEqual(resolveIoStoreSelection(ucasPath, [utocPath, ucasPath]), {
    ok: true,
    utocPath,
    ucasPath,
    ucasPaths: [ucasPath],
  });
});

test('resolves a selected UTOC file to its matching UCAS file', () => {
  const utocPath = 'C:\\Game\\Content\\Paks\\global.utoc';
  const ucasPath = 'C:\\Game\\Content\\Paks\\global.ucas';

  assert.deepEqual(resolveIoStoreSelection(utocPath, [ucasPath, utocPath]), {
    ok: true,
    utocPath,
    ucasPath,
    ucasPaths: [ucasPath],
  });
});

test('groups partitioned UCAS files with their base UTOC file', () => {
  const utocPath = 'C:\\Game\\Content\\Paks\\global.utoc';
  const ucasPath = 'C:\\Game\\Content\\Paks\\global_s1.ucas';

  const pairs = buildIoStorePairs([ucasPath, utocPath]);
  const pair = pairs.get('c:\\game\\content\\paks|global');

  assert.deepEqual(pair, {
    utocPath,
    ucasPaths: [ucasPath],
  });
  assert.deepEqual(resolveIoStoreSelection(ucasPath, [ucasPath, utocPath]), {
    ok: true,
    utocPath,
    ucasPath,
    ucasPaths: [ucasPath],
  });
});

test('returns a pair missing issue when one side of an IoStore pair is absent', () => {
  assert.deepEqual(resolveIoStoreSelection('C:\\Game\\Content\\Paks\\global.utoc', [
    'C:\\Game\\Content\\Paks\\global.utoc',
  ]), {
    ok: false,
    issue: {
      severity: 'error',
      code: 'iostore.pair_missing',
      message: 'Selected IoStore file is missing its matching .utoc or .ucas file.',
    },
  });
});

test('returns null for pak and unsupported selections', () => {
  assert.equal(resolveIoStoreSelection('C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak', []), null);
  assert.equal(resolveIoStoreSelection('C:\\Game\\Content\\Paks\\readme.txt', []), null);
});
