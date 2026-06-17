const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const protocolRoot = path.join(repoRoot, 'node-shell', 'packages', 'protocol');
const generatedRoot = path.join(protocolRoot, 'generated');
const programCppGeneratedRoot = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'Generated',
  'Protocol',
);
const oldCppGeneratedRoot = path.join(generatedRoot, 'cpp');

test('commits generated FlatBuffers C++ headers in the Unreal Program and CommonJS modules', () => {
  const expectedCppFiles = [
    path.join(programCppGeneratedRoot, 'upi_backend_info_generated.h'),
    path.join(programCppGeneratedRoot, 'upi_common_generated.h'),
    path.join(programCppGeneratedRoot, 'upi_pak_analysis_generated.h'),
    path.join(programCppGeneratedRoot, 'upi_iostore_analysis_generated.h'),
  ];
  const expectedJsFiles = [
    path.join(generatedRoot, 'js', 'upi', 'v1.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'backend-info-response.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'pak-analysis-response.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'io-store-analysis-response.js'),
  ];
  const expectedTsFiles = [
    path.join(generatedRoot, 'ts', 'upi', 'v1.ts'),
    path.join(generatedRoot, 'ts', 'upi', 'v1', 'backend-info-response.ts'),
    path.join(generatedRoot, 'ts', 'upi', 'v1', 'pak-analysis-response.ts'),
    path.join(generatedRoot, 'ts', 'upi', 'v1', 'io-store-analysis-response.ts'),
  ];

  assert.equal(fs.existsSync(oldCppGeneratedRoot), false, `remove duplicate generated C++ path: ${oldCppGeneratedRoot}`);

  for (const filePath of [...expectedCppFiles, ...expectedJsFiles, ...expectedTsFiles]) {
    assert.equal(fs.existsSync(filePath), true, `missing generated file: ${filePath}`);
  }
});

test('generated CommonJS barrel exports all root response modules', () => {
  const entrypoint = require('../generated/js/upi/v1.js');
  const rootModules = [
    {
      name: 'BackendInfoResponse',
      directModule: require('../generated/js/upi/v1/backend-info-response.js'),
      lowerCamelAccessors: ['schemaVersion', 'backendName'],
    },
    {
      name: 'PakAnalysisResponse',
      directModule: require('../generated/js/upi/v1/pak-analysis-response.js'),
      lowerCamelAccessors: ['compressedBlocksLength'],
    },
    {
      name: 'IoStoreAnalysisResponse',
      directModule: require('../generated/js/upi/v1/io-store-analysis-response.js'),
      lowerCamelAccessors: ['compressedBlocksLength'],
    },
  ];

  for (const { name, directModule, lowerCamelAccessors } of rootModules) {
    const RootClass = directModule[name];
    assert.equal(entrypoint[name], RootClass);
    assert.equal(typeof RootClass.bufferHasIdentifier, 'function');
    assert.equal(typeof RootClass[`getRootAs${name}`], 'function');
    for (const accessor of lowerCamelAccessors) {
      assert.equal(typeof RootClass.prototype[accessor], 'function');
    }
  }

  const tableExports = [
    'Issue',
    'IoStoreChunkEntry',
    'IoStoreCompressedBlockEntry',
    'IoStoreOverview',
    'IoStorePackageEntry',
    'IoStorePartition',
    'PakCompressedBlockEntry',
    'PakOverview',
    'PakPackageEntry',
  ];
  for (const name of tableExports) {
    assert.equal(typeof entrypoint[name], 'function');
  }

  assert.equal(typeof entrypoint.ResponseStatus, 'object');
  assert.equal(typeof entrypoint.IssueSeverity, 'object');
});
