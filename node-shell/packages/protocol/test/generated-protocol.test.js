const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const protocolRoot = path.join(__dirname, '..');
const generatedRoot = path.join(protocolRoot, 'generated');

test('commits generated FlatBuffers C++ headers and CommonJS modules', () => {
  const expectedFiles = [
    path.join(generatedRoot, 'cpp', 'upi_backend_info_generated.h'),
    path.join(generatedRoot, 'cpp', 'upi_common_generated.h'),
    path.join(generatedRoot, 'cpp', 'upi_pak_analysis_generated.h'),
    path.join(generatedRoot, 'cpp', 'upi_iostore_analysis_generated.h'),
    path.join(generatedRoot, 'js', 'upi', 'v1.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'backend-info-response.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'pak-analysis-response.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'io-store-analysis-response.js'),
  ];

  for (const filePath of expectedFiles) {
    assert.equal(fs.existsSync(filePath), true, `missing generated file: ${filePath}`);
  }
});

test('generated CommonJS modules expose lowerCamelCase accessors', () => {
  const { BackendInfoResponse } = require('../generated/js/upi/v1/backend-info-response.js');
  const { PakAnalysisResponse } = require('../generated/js/upi/v1/pak-analysis-response.js');
  const { IoStoreAnalysisResponse } = require('../generated/js/upi/v1/io-store-analysis-response.js');
  const entrypoint = require('../generated/js/upi/v1.js');

  assert.equal(typeof BackendInfoResponse.prototype.schemaVersion, 'function');
  assert.equal(typeof BackendInfoResponse.prototype.backendName, 'function');
  assert.equal(typeof PakAnalysisResponse.prototype.compressedBlocksLength, 'function');
  assert.equal(typeof IoStoreAnalysisResponse.prototype.compressedBlocksLength, 'function');
  assert.equal(entrypoint.IoStoreAnalysisResponse, IoStoreAnalysisResponse);
  assert.equal(typeof entrypoint.ResponseStatus, 'object');
});
