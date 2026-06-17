const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopDir = path.join(__dirname, '..');

function readDesktopFile(fileName) {
  return fs.readFileSync(path.join(desktopDir, fileName), 'utf8');
}

test('renderer build config points at the React TypeScript entry and dist output', () => {
  const config = readDesktopFile('rsbuild.config.ts');

  assert.match(config, /renderer-src\/src\/main\.tsx/);
  assert.match(config, /renderer-dist/);
  assert.match(config, /pluginReact/);
  assert.match(config, /assetPrefix:\s*'\.\/'/);
});

test('React renderer source uses preload API through typed ipc client', () => {
  const client = fs.readFileSync(path.join(desktopDir, 'renderer-src', 'src', 'ipc', 'upiClient.ts'), 'utf8');

  assert.match(client, /window\.upi/);
  assert.match(client, /UPI preload API is unavailable/);
});
