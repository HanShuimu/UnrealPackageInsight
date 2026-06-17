const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererDir = path.join(__dirname, '..', 'renderer');

function readRendererFile(fileName) {
  return fs.readFileSync(path.join(rendererDir, fileName), 'utf8');
}

test('renderer shell includes required app regions and assets', () => {
  const html = readRendererFile('index.html');

  assert.match(html, /<link[^>]+href="styles\.css"/);
  assert.match(html, /<script[^>]+src="renderer\.js"/);
  assert.match(html, /id="open-directory"/);
  assert.match(html, /id="backend-info"/);
  assert.match(html, /id="selected-file"/);
  assert.match(html, /id="tree"/);
  assert.match(html, /id="tabs"/);
  assert.match(html, /id="content"/);
  assert.match(html, /<dialog[^>]+id="aes-dialog"/);
  assert.match(html, /id="aes-key"/);
  assert.match(html, /id="aes-submit"/);
  assert.match(html, /id="aes-cancel"/);
});

test('renderer script uses the preload API and safe DOM text APIs', () => {
  const script = readRendererFile('renderer.js');

  assert.match(script, /window\.upi\.getBackendInfo\(/);
  assert.match(script, /window\.upi\.openPackageDirectory\(/);
  assert.match(script, /window\.upi\.analyze\(/);
  assert.match(script, /window\.upi\.submitAesKeyAndRetry\(/);
  assert.match(script, /\.endsWith\('\.aes_key_required'\)/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});
