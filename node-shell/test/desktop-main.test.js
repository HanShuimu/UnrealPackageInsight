const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
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
    fsModule: { existsSync: () => true },
    spawnProcess: (...args) => {
      spawns.push(args);
      return child;
    },
    processController: processState,
  });

  assert.equal(spawns.length, 1);
  assert.deepEqual(spawns[0][1], [path.join(__dirname, '..', 'apps', 'desktop', 'main.js')]);
  assert.equal(Object.hasOwn(spawns[0][2].env, 'UPI_BACKEND_DLL'), false);
  assert.equal(Object.hasOwn(spawns[0][2].env, 'UPI_ENGINE_ROOT'), false);
});

test('GUI launcher builds the renderer before spawning Electron when dist is missing', () => {
  const child = new EventEmitter();
  const buildCalls = [];
  const spawns = [];
  const processState = {};
  let rendererBuilt = false;

  runGuiLauncher({
    env: { PATH: 'C:\\Windows\\System32' },
    electronPath: 'C:\\tools\\electron.cmd',
    fsModule: {
      existsSync(filePath) {
        assert.match(filePath, /renderer-dist[\\/]index\.html$/);
        return rendererBuilt;
      },
    },
    spawnSyncProcess: (...args) => {
      buildCalls.push(args);
      rendererBuilt = true;
      return { status: 0 };
    },
    spawnProcess: (...args) => {
      spawns.push(args);
      return child;
    },
    processController: processState,
  });

  assert.equal(buildCalls.length, 1);
  assert.deepEqual(buildCalls[0][1], ['run', 'build:renderer']);
  assert.equal(buildCalls[0][2].cwd, path.join(__dirname, '..'));
  assert.equal(buildCalls[0][2].stdio, 'inherit');
  assert.equal(spawns.length, 1);
});

test('GUI launcher does not spawn Electron when renderer build succeeds without producing index', () => {
  const buildCalls = [];
  const errors = [];
  const spawns = [];
  const processState = {};

  runGuiLauncher({
    env: { PATH: 'C:\\Windows\\System32' },
    electronPath: 'C:\\tools\\electron.cmd',
    fsModule: { existsSync: () => false },
    spawnSyncProcess: (...args) => {
      buildCalls.push(args);
      return { status: 0 };
    },
    spawnProcess: (...args) => {
      spawns.push(args);
      return new EventEmitter();
    },
    reportError: (message) => errors.push(message),
    processController: processState,
  });

  assert.equal(buildCalls.length, 1);
  assert.equal(spawns.length, 0);
  assert.deepEqual(errors, ['Renderer build completed, but renderer-dist/index.html was not created.']);
  assert.equal(processState.exitCode, 1);
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
    fsModule: { existsSync: () => true },
    spawnProcess: () => child,
    reportError: (message) => errors.push(message),
    processController: processState,
  });

  assert.doesNotThrow(() => child.emit('error', new Error('spawn ENOENT')));
  child.emit('exit', 0);

  assert.deepEqual(errors, ['Failed to start Electron: spawn ENOENT']);
  assert.equal(processState.exitCode, 1);
});
