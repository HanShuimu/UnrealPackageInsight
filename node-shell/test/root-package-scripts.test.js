const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('root package exposes native build command matrix', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.equal(rootPackage.private, true);
  assert.equal(rootPackage.type, 'commonjs');
  assert.equal(rootPackage.scripts.build, 'node scripts/build-native-backend.js');
  assert.equal(rootPackage.scripts['build:native'], 'node scripts/build-native-backend.js');
  assert.equal(rootPackage.scripts['build:native:debug'], 'node scripts/build-native-backend.js --configuration Debug');
  assert.equal(rootPackage.scripts['build:native:development'], 'node scripts/build-native-backend.js --configuration Development');
  assert.equal(rootPackage.scripts['build:native:shipping'], 'node scripts/build-native-backend.js --configuration Shipping');
  assert.equal(rootPackage.scripts.test, 'npm --prefix node-shell test');
});
