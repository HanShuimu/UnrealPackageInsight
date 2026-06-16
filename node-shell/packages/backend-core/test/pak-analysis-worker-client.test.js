const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { analyzePakInWorker } = require('../src/pak-analysis-worker-client.js');

function createCorruptPakFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-corrupt-pak-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const pakPath = path.join(directory, 'corrupt.pak');
  fs.writeFileSync(pakPath, Buffer.from('not a valid pak file'));
  return pakPath;
}

test('analyzePakInWorker reports an error when a corrupt pak terminates the worker', (t) => {
  const pakPath = createCorruptPakFixture(t);
  const aesKey = 'super-secret-aes-key';
  const spawnCalls = [];

  const response = analyzePakInWorker({
    dllPath: 'backend.dll',
    pakPath,
    aesKey,
    nodePath: 'node.exe',
    workerPath: 'worker.js',
    spawnSync(command, args, options) {
      spawnCalls.push({ command, args, options });
      return {
        status: 777006,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  });

  assert.equal(response.status, 1);
  assert.equal(response.overview.pakPath, pakPath);
  assert.equal(response.overview.packageCount, 0);
  assert.deepEqual(response.packages, []);
  assert.deepEqual(response.compressedBlocks, []);
  assert.equal(response.issues[0].severity, 2);
  assert.equal(response.issues[0].code, 'pak.worker_failed');
  assert.match(response.issues[0].message, /777006/);

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, 'node.exe');
  assert.deepEqual(spawnCalls[0].args, ['worker.js']);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /super-secret-aes-key/);
  assert.equal(spawnCalls[0].options.encoding, 'utf8');
  assert.equal(spawnCalls[0].options.windowsHide, true);

  const payload = JSON.parse(spawnCalls[0].options.input);
  assert.deepEqual(payload, {
    dllPath: 'backend.dll',
    pakPath,
    aesKey,
  });
});
