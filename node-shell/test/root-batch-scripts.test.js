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
  assert.doesNotMatch(script, /RUN_GENERATE_PROTOCOL/);
  assert.doesNotMatch(script, /UPI_FLATC/);
  assert.match(script, /if "%ENGINE_ROOT%"=="" goto invalid_engine_root/);
  assert.match(script, /if not exist "%ENGINE_ROOT%\\Engine\\Build\\BatchFiles\\Build\.bat" goto invalid_engine_root/);
  assert.match(script, /Engine root not found or invalid: %ENGINE_ROOT%/);
  assert.match(script, /:invalid_engine_root[\s\S]*pause[\s\S]*exit \/b 1/);
  const stages = [
    '****** [1/5] Installing Node dependencies',
    '****** [2/5] Ensuring FlatBuffers compiler',
    '****** [3/5] Generating protocol bindings',
    '****** [4/5] Building native backend',
    '****** [5/5] Building renderer',
  ];
  let previousStageIndex = -1;
  for (const stage of stages) {
    const stageIndex = script.indexOf(`echo ${stage}`);
    assert.notEqual(stageIndex, -1, `${stage} is printed`);
    assert.ok(stageIndex > previousStageIndex, `${stage} is printed in order`);
    previousStageIndex = stageIndex;
  }
  assert.match(script, /call npm\.cmd --prefix node-shell install/);
  assert.match(script, /call npm\.cmd run ensure-flatc/);
  assert.match(script, /call npm\.cmd run generate-protocol/);
  assert.doesNotMatch(script, /Skipping protocol generation/);
  assert.match(script, /call npm\.cmd run build:native -- --engine-root "%ENGINE_ROOT%"/);
  assert.match(script, /--configuration "%BUILD_CONFIGURATION%"/);
  assert.match(script, /call npm\.cmd --prefix node-shell run build:renderer/);
  assert.match(script, /:fail[\s\S]*Build failed with exit code %UPI_EXIT%\.[\s\S]*pause[\s\S]*exit \/b %UPI_EXIT%/);
});

test('root GUI batch starts the Electron GUI through the node-shell npm script', () => {
  const script = readRootScript('start-gui.bat');

  assert.match(script, /pushd "%~dp0"/);
  assert.match(script, /call npm\.cmd --prefix node-shell run gui/);
});
