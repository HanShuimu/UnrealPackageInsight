const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const electronPath = require('electron');

const DEVTOOLS_PORT = 9333;
const CDP_TIMEOUT_MS = 10000;
const SMOKE_DISABLE_HARDWARE_ACCELERATION_ARG = '--upi-smoke-disable-hardware-acceleration';
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
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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
  return error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT';
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

async function findRendererWebSocketUrl({ stderr, processSummary, deadlineMs = 15000 }) {
  const deadline = Date.now() + deadlineMs;
  let lastTargets = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${DEVTOOLS_PORT}/json`);
      lastTargets = targets;
      const target = targets.find((entry) => (
        entry.type === 'page'
        && typeof entry.webSocketDebuggerUrl === 'string'
        && entry.webSocketDebuggerUrl.length > 0
      ));

      if (target) {
        return target.webSocketDebuggerUrl;
      }
    } catch (error) {
      lastError = error;
      // Electron may not have opened the DevTools endpoint yet.
    }

    await delay(100);
  }

  throw new Error(
    `Timed out waiting for Electron renderer CDP target.\n${processSummary()}\n`
    + `Last CDP targets:\n${JSON.stringify(lastTargets, null, 2)}\n`
    + `Last /json error: ${lastError?.message || 'none'}\n`
    + `Electron stderr:\n${stderr()}`,
  );
}

function createCdpClient(webSocketDebuggerUrl, { stderr = () => '' } = {}) {
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
      const { method, resolve, reject } = pending.get(message.id);
      pending.delete(message.id);

      if (message.error) {
        reject(new Error(
          `CDP ${method} failed: ${message.error.message}: ${message.error.data || ''}`
          + `\nElectron stderr:\n${stderr()}`,
        ));
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

  function send(method, params = {}, sessionId = null) {
    if (socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}; CDP WebSocket is not open`));
    }

    const id = nextId;
    nextId += 1;

    return withTimeout(new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }));
    }), CDP_TIMEOUT_MS, `Timed out waiting for CDP ${method}\nElectron stderr:\n${stderr()}`);
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

      return withTimeout(new Promise((resolve, reject) => {
        function handleOpen() {
          socket.removeEventListener('error', handleError);
          resolve();
        }

        function handleError(event) {
          socket.removeEventListener('open', handleOpen);
          reject(event.error || new Error('CDP WebSocket error before open'));
        }

        socket.addEventListener('open', handleOpen, { once: true });
        socket.addEventListener('error', handleError, { once: true });
        if (socket.readyState === WebSocket.OPEN) {
          handleOpen();
        }
      }), CDP_TIMEOUT_MS, `Timed out opening CDP WebSocket\nElectron stderr:\n${stderr()}`);
    },
  };
}

async function evaluate(client, expression, sessionId) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  }, sessionId);

  if (result.exceptionDetails) {
    throw new Error(`Evaluation failed: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

async function waitFor(client, expression, { sessionId, timeoutMs = 10000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression, sessionId)) {
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

test('Electron GUI launches, mounts the renderer, and exposes preload API', { retry: 2 }, async (t) => {
  await assertDevToolsPortAvailable();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-electron-smoke-'));
  const stdoutChunks = [];
  const stderrChunks = [];
  const electronProcess = spawn(electronPath, [
    `--remote-debugging-port=${DEVTOOLS_PORT}`,
    '--remote-allow-origins=*',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    `--user-data-dir=${userDataDir}`,
    mainPath,
    SMOKE_DISABLE_HARDWARE_ACCELERATION_ARG,
  ], {
    cwd: nodeShellRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let client = null;
  let electronExit = null;
  const waitForElectronClose = createProcessCloseWaiter(electronProcess);
  const stdout = () => stdoutChunks.join('').slice(-8000);
  const stderr = () => stderrChunks.join('').slice(-8000);
  const processSummary = () => (
    `Electron pid: ${electronProcess.pid || 'not started'}, `
    + `exit: ${electronExit ? `code ${electronExit.code}, signal ${electronExit.signal || 'none'}` : 'still running'}`
    + `\nElectron stdout:\n${stdout()}`
  );

  electronProcess.stdout.on('data', (chunk) => {
    stdoutChunks.push(chunk.toString('utf8'));
  });
  electronProcess.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk.toString('utf8'));
  });
  electronProcess.once('exit', (code, signal) => {
    electronExit = { code, signal };
    if (code !== null && code !== 0) {
      stderrChunks.push(`\nElectron exited early with code ${code} and signal ${signal || 'none'}.\n`);
    }
  });

  t.after(async () => {
    let cleanupError = null;

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
      } catch (error) {
        cleanupError = error;
      }
    }

    try {
      fs.rmSync(userDataDir, { force: true, recursive: true });
    } catch (error) {
      cleanupError ||= error;
    }

    if (cleanupError) {
      throw cleanupError;
    }
  });

  const rendererWebSocketUrl = await findRendererWebSocketUrl({ stderr, processSummary });
  client = createCdpClient(rendererWebSocketUrl, { stderr });
  await client.waitForOpen();

  const exceptions = [];
  client.on('Runtime.exceptionThrown', (params) => {
    exceptions.push(params.exceptionDetails?.text || 'Runtime.exceptionThrown');
  });

  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__UPI_SMOKE_RELOAD_MARKER__ = true;',
  });
  await client.send('Page.reload', { ignoreCache: true });

  await waitFor(client, (
    'window.__UPI_SMOKE_RELOAD_MARKER__ === true'
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
