const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function readRootScript(fileName) {
  return fs.readFileSync(path.join(repoRoot, fileName), 'utf8');
}

test('root build batch installs dependencies and builds native plus renderer through npm scripts', () => {
  const script = readRootScript('build-all.bat');

  assert.match(script, /set "ENGINE_ROOT=/);
  assert.match(script, /set "BUILD_CONFIGURATION=/);
  assert.match(script, /if "%ENGINE_ROOT%"=="" goto invalid_engine_root/);
  assert.match(script, /if not exist "%ENGINE_ROOT%\\Engine\\Build\\BatchFiles\\Build\.bat" goto invalid_engine_root/);
  assert.match(script, /Engine root not found or invalid: %ENGINE_ROOT%/);
  assert.match(script, /call npm\.cmd --prefix node-shell install/);
  assert.match(script, /call npm\.cmd --prefix node-shell run generate-protocol/);
  assert.match(script, /call npm\.cmd run build:native -- --engine-root "%ENGINE_ROOT%"/);
  assert.match(script, /--configuration "%BUILD_CONFIGURATION%"/);
  assert.match(script, /call npm\.cmd --prefix node-shell run build:renderer/);
});

test('root GUI batch starts the Electron GUI through the node-shell npm script', () => {
  const script = readRootScript('start-gui.bat');

  assert.match(script, /pushd "%~dp0"/);
  assert.match(script, /call npm\.cmd --prefix node-shell run gui/);
});
