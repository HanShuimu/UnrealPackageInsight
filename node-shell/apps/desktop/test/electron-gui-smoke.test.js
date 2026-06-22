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
      request.destroy(new Error(`Timed out requesting ${url}`));
    });
  });
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
    for (const { reject } of pending.values()) {
      reject(event.error || new Error('CDP WebSocket error'));
    }
    pending.clear();
  });

  function send(method, params = {}) {
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
      socket.close();
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

  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) {
      return;
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for expression: ${expression}`);
}

test('Electron GUI launches, mounts the renderer, and exposes preload API', async (t) => {
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

  const stderr = () => stderrChunks.join('').slice(-8000);

  electronProcess.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk.toString('utf8'));
  });

  t.after(async () => {
    if (client) {
      client.close();
    }

    if (!electronProcess.killed) {
      electronProcess.kill();
    }

    await delay(250);
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

  await waitFor(client, 'document.querySelector("#root")?.textContent?.trim().length > 0');

  const visibleText = await evaluate(client, 'document.body.innerText');
  for (const expectedText of ['Overview', 'Packages', 'Issues', 'Opened containers', 'Details']) {
    assert.match(visibleText, new RegExp(expectedText));
  }

  assert.equal(await evaluate(client, 'typeof window.upi === "object" && window.upi !== null'), true);
  assert.deepEqual(exceptions, []);
});
