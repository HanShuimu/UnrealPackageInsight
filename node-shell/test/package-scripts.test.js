const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('node-shell generate-protocol uses JavaScript script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['generate-protocol'], 'node ../scripts/generate-protocol.js');
});

test('project scripts do not contain PowerShell files', () => {
  const scriptFiles = fs.readdirSync(path.resolve(__dirname, '..', '..', 'scripts'));
  assert.deepEqual(scriptFiles.filter((file) => file.endsWith('.ps1')), []);
});
