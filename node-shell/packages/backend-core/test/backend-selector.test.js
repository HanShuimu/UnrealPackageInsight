const assert = require('node:assert/strict');
const test = require('node:test');

const { selectBackendCandidates, sortBackendCandidates } = require('../src/backend-selector.js');

const manifests = [
  {
    id: 'ue-5.7.4-win32-x64-shipping',
    engineVersion: '5.7.4',
    configuration: 'Shipping',
    protocolVersion: 1,
    supports: { pak: { versionMin: 1, versionMax: 12 } },
  },
  {
    id: 'ue-5.7.4-win32-x64-development',
    engineVersion: '5.7.4',
    configuration: 'Development',
    protocolVersion: 1,
    supports: { pak: { versionMin: 1, versionMax: 12 } },
  },
  {
    id: 'ue-5.6.0-win32-x64-development',
    engineVersion: '5.6.0',
    configuration: 'Development',
    protocolVersion: 1,
    supports: { iostore: { tocVersionMin: 1, tocVersionMax: 8 } },
  },
];

test('selectBackendCandidates filters by container format version', () => {
  assert.deepEqual(
    selectBackendCandidates({ probe: { containerType: 'pak', pakFormatVersion: 12 }, manifests })
      .map((manifest) => manifest.id),
    [
      'ue-5.7.4-win32-x64-development',
      'ue-5.7.4-win32-x64-shipping',
    ],
  );
});

test('selectBackendCandidates rejects protocol version mismatches', () => {
  assert.deepEqual(
    selectBackendCandidates({
      probe: { containerType: 'pak', pakFormatVersion: 12 },
      manifests: [{
        ...manifests[0],
        protocolVersion: 2,
      }],
    }),
    [],
  );
});

test('selectBackendCandidates filters IoStore candidates by toc format version', () => {
  assert.deepEqual(
    selectBackendCandidates({ probe: { containerType: 'iostore', tocFormatVersion: 8 }, manifests })
      .map((manifest) => manifest.id),
    ['ue-5.6.0-win32-x64-development'],
  );
});

test('selectBackendCandidates returns no IoStore candidates outside toc range', () => {
  assert.deepEqual(
    selectBackendCandidates({ probe: { containerType: 'iostore', tocFormatVersion: 9 }, manifests }),
    [],
  );
});

test('selectBackendCandidates returns no Pak candidates outside pak range', () => {
  assert.deepEqual(
    selectBackendCandidates({ probe: { containerType: 'pak', pakFormatVersion: 13 }, manifests }),
    [],
  );
});

test('sortBackendCandidates prefers Development then newer engine version', () => {
  assert.deepEqual(
    sortBackendCandidates([...manifests]).map((manifest) => manifest.id),
    [
      'ue-5.7.4-win32-x64-development',
      'ue-5.6.0-win32-x64-development',
      'ue-5.7.4-win32-x64-shipping',
    ],
  );
});

test('sortBackendCandidates does not mutate the caller array', () => {
  const candidates = [...manifests];

  assert.notEqual(sortBackendCandidates(candidates), candidates);
  assert.deepEqual(candidates.map((manifest) => manifest.id), manifests.map((manifest) => manifest.id));
});
