const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { main: runGuiLauncher } = require('../bin/upi-gui.js');

test('GUI launcher starts Electron without a DLL argument or backend env injection', () => {
  const child = new EventEmitter();
  const spawns = [];
  const processState = {};

  runGuiLauncher({
    argv: ['node', 'upi-gui.js'],
    env: { PATH: 'C:\\Windows\\System32' },
    electronPath: 'C:\\tools\\electron.cmd',
    spawnProcess: (...args) => {
      spawns.push(args);
      return child;
    },
    processController: processState,
  });

  assert.equal(spawns.length, 1);
  assert.equal(Object.hasOwn(spawns[0][2].env, 'UPI_BACKEND_DLL'), false);
  assert.equal(Object.hasOwn(spawns[0][2].env, 'UPI_ENGINE_ROOT'), false);
});

test('GUI launcher reports Electron spawn errors without throwing unhandled error events', () => {
  const child = new EventEmitter();
  const errors = [];
  const processState = {};

  runGuiLauncher({
    argv: ['node', 'upi-gui.js', 'C:\\backend\\UnrealPackageInsightBackend.dll'],
    env: { PATH: 'C:\\Windows\\System32' },
    electronPath: 'C:\\tools\\electron.cmd',
    koffiModule: {},
    backendClientFactory: () => ({
      getBackendInfo() {
        return { status: 'Ok' };
      },
    }),
    spawnProcess: () => child,
    reportError: (message) => errors.push(message),
    processController: processState,
  });

  assert.doesNotThrow(() => child.emit('error', new Error('spawn ENOENT')));
  child.emit('exit', 0);

  assert.deepEqual(errors, ['Failed to start Electron: spawn ENOENT']);
  assert.equal(processState.exitCode, 1);
});
