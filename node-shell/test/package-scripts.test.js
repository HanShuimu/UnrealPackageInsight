const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('node-shell generate-protocol uses JavaScript script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['generate-protocol'], 'node ../scripts/generate-protocol.js');
});

test('root package exposes protocol tool acquisition and generation scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['ensure-flatc'], 'node scripts/ensure-flatc.js');
  assert.equal(pkg.scripts['generate-protocol'], 'node scripts/generate-protocol.js');
});

test('node-shell exposes renderer build and renderer test scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['test:node'], 'node --test "test/*.test.js" "packages/protocol/test/*.test.js" "packages/backend-core/test/*.test.js" "packages/analysis-domain/test/*.test.js" "apps/desktop/test/*.test.js"');
  assert.equal(pkg.scripts['typecheck:renderer'], 'tsc --noEmit -p apps/desktop/renderer-src/tsconfig.json');
  assert.equal(pkg.scripts['test:renderer'], 'npm run typecheck:renderer && vitest run --config apps/desktop/vitest.config.ts');
  assert.equal(pkg.scripts.test, 'npm run build:renderer && npm run test:node && npm run test:renderer');
  assert.equal(pkg.scripts['build:renderer'], 'rsbuild build --config apps/desktop/rsbuild.config.ts');
  assert.equal(pkg.scripts.gui, 'npm run build:renderer && node bin/upi-gui.js');
});

test('project scripts do not contain PowerShell files', () => {
  const scriptFiles = fs.readdirSync(path.resolve(__dirname, '..', '..', 'scripts'));
  assert.deepEqual(scriptFiles.filter((file) => file.endsWith('.ps1')), []);
});
