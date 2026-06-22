const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const electronPath = require('electron');

const DEVTOOLS_PORT = 9333;
const nodeShellRoot = path.resolve(__dirname, '../../..');
const mainPath = path.join(nodeShellRoot, 'apps', 'desktop', 'main.js');

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

function readJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from ${url}: ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(1000, () => {
      const error = new Error(`Timed out requesting ${url}`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
  });
}

function isPortUnavailableError(error) {
  return error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET';
}

async function assertDevToolsPortAvailable() {
  try {
    const targets = await readJson(`http://127.0.0.1:${DEVTOOLS_PORT}/json`);
    const targetSummary = Array.isArray(targets)
      ? targets.map((target) => target.title || target.url || target.type).filter(Boolean).join(', ')
      : 'unknown response';
    throw new Error(
      `DevTools port ${DEVTOOLS_PORT} is already serving targets (${targetSummary}). `
      + 'Stop the existing process before running the Electron GUI smoke test.',
    );
  } catch (error) {
    if (isPortUnavailableError(error)) {
      return;
    }

    throw error;
  }
}

async function findRendererTarget({ stderr, deadlineMs = 15000 }) {
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${DEVTOOLS_PORT}/json`);
      const target = targets.find((entry) => (
        entry.type === 'page'
        && typeof entry.webSocketDebuggerUrl === 'string'
        && entry.webSocketDebuggerUrl.length > 0
      ));

      if (target) {
        return target;
      }
    } catch {
      // Electron may not have opened the DevTools endpoint yet.
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for Electron renderer CDP target.\nElectron stderr:\n${stderr()}`);
}

function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  function rejectPending(error) {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  }

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);

      if (message.error) {
        reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
      } else {
        resolve(message.result);
      }
      return;
    }

    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) {
        listener(message.params || {});
      }
    }
  });

  socket.addEventListener('error', (event) => {
    rejectPending(event.error || new Error('CDP WebSocket error'));
  });

  socket.addEventListener('close', () => {
    rejectPending(new Error('CDP WebSocket closed'));
  });

  function send(method, params = {}) {
    if (socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}; CDP WebSocket is not open`));
    }

    const id = nextId;
    nextId += 1;

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function on(method, listener) {
    const methodListeners = listeners.get(method) || new Set();
    methodListeners.add(listener);
    listeners.set(method, methodListeners);
  }

  return {
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
    on,
    send,
    waitForOpen() {
      if (socket.readyState === WebSocket.OPEN) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(`Evaluation failed: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

async function waitFor(client, expression, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  const lastErrorText = lastError ? `\nLast evaluation error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for expression: ${expression}${lastErrorText}`);
}

function createProcessCloseWaiter(childProcess) {
  let closed = false;
  childProcess.once('close', () => {
    closed = true;
  });

  return function waitForProcessClose(timeoutMs) {
    if (closed || childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        childProcess.off('close', onClose);
        reject(new Error(`Timed out waiting for Electron process ${childProcess.pid} to close`));
      }, timeoutMs);

      function onClose() {
        clearTimeout(timer);
        closed = true;
        resolve();
      }

      childProcess.once('close', onClose);
    });
  };
}

test('Electron GUI launches, mounts the renderer, and exposes preload API', async (t) => {
  await assertDevToolsPortAvailable();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-electron-smoke-'));
  const stderrChunks = [];
  const electronProcess = spawn(electronPath, [
    `--remote-debugging-port=${DEVTOOLS_PORT}`,
    `--user-data-dir=${userDataDir}`,
    mainPath,
  ], {
    cwd: nodeShellRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let client = null;
  const waitForElectronClose = createProcessCloseWaiter(electronProcess);

  const stderr = () => stderrChunks.join('').slice(-8000);

  electronProcess.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk.toString('utf8'));
  });

  t.after(async () => {
    if (client) {
      try {
        await withTimeout(
          client.send('Browser.close'),
          1000,
          'Timed out requesting Electron shutdown through CDP',
        );
      } catch {
        // The renderer may already be gone; process termination below is the fallback.
      }
      client.close();
    }

    try {
      await waitForElectronClose(3000);
    } catch {
      electronProcess.kill();
      try {
        await waitForElectronClose(3000);
      } catch {
        // Let the test failure surface while still attempting temp-dir cleanup.
      }
    }

    fs.rmSync(userDataDir, { force: true, recursive: true });
  });

  electronProcess.once('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      stderrChunks.push(`\nElectron exited early with code ${code} and signal ${signal || 'none'}.\n`);
    }
  });

  const target = await findRendererTarget({ stderr });
  client = createCdpClient(target.webSocketDebuggerUrl);
  const exceptions = [];

  await client.waitForOpen();
  client.on('Runtime.exceptionThrown', (params) => {
    exceptions.push(params.exceptionDetails?.text || 'Runtime.exceptionThrown');
  });
  await client.send('Runtime.enable');
  await client.send('Page.enable');

  await evaluate(client, 'window.__UPI_SMOKE_RELOAD_MARKER__ = true');
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, (
    'window.__UPI_SMOKE_RELOAD_MARKER__ === undefined'
    + ' && document.readyState === "complete"'
    + ' && document.querySelector("#root")?.textContent?.trim().length > 0'
  ));

  const visibleText = await evaluate(client, 'document.body.innerText');
  for (const expectedText of ['Overview', 'Packages', 'Issues', 'Opened containers', 'Details']) {
    assert.match(visibleText, new RegExp(expectedText));
  }

  assert.equal(await evaluate(client, 'typeof window.upi === "object" && window.upi !== null'), true);
  assert.deepEqual(exceptions, []);
});
