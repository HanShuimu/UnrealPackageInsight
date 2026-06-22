const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { URL } = require('node:url');

const electronPath = require('electron');

const DEVTOOLS_PORT = 9333;
const CDP_COMMAND_TIMEOUT_MS = 5000;
const SMOKE_DISABLE_HARDWARE_ACCELERATION_ARG = '--upi-smoke-disable-hardware-acceleration';
const INNER_SMOKE_ENV = 'UPI_ELECTRON_SMOKE_INNER';
const nodeShellRoot = path.resolve(__dirname, '../../..');
const mainPath = path.join(nodeShellRoot, 'apps', 'desktop', 'main.js');

function shouldDelegateToNpmExecNode() {
  const major = Number(process.versions.node.split('.')[0]);
  return major < 26 && process.env[INNER_SMOKE_ENV] !== '1';
}

function runDelegatedSmoke() {
  return new Promise((resolve, reject) => {
    const delegateArgs = [
      '--prefix',
      '.',
      'exec',
      '--',
      'node',
      '--test',
      'apps/desktop/test/electron-gui-smoke.test.js',
    ];
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm.cmd ${delegateArgs.join(' ')}`]
      : delegateArgs;
    const child = spawn(command, args, {
      cwd: nodeShellRoot,
      env: {
        ...process.env,
        [INNER_SMOKE_ENV]: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `Delegated Electron smoke failed with code ${code}, signal ${signal || 'none'}.\n`
        + `stdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`,
      ));
    });
  });
}

class CdpWebSocket {
  static CONNECTING = 0;

  static OPEN = 1;

  static CLOSING = 2;

  static CLOSED = 3;

  constructor(webSocketUrl) {
    this.readyState = CdpWebSocket.CONNECTING;
    this.listeners = new Map();
    this.frameBuffer = Buffer.alloc(0);
    this.handshakeBuffer = Buffer.alloc(0);
    this.handshakeComplete = false;

    const url = new URL(webSocketUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const port = Number(url.port || 80);
    const host = url.hostname;
    const requestPath = `${url.pathname}${url.search}`;

    this.socket = net.createConnection({ host, port }, () => {
      this.socket.write([
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });

    this.socket.on('data', (chunk) => {
      this.handleData(chunk);
    });
    this.socket.on('error', (error) => {
      this.readyState = CdpWebSocket.CLOSED;
      this.dispatch('error', { error });
    });
    this.socket.on('close', () => {
      this.readyState = CdpWebSocket.CLOSED;
      this.dispatch('close', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || new Set();
    const wrapped = options.once
      ? (event) => {
        this.removeEventListener(type, wrapped);
        listener(event);
      }
      : listener;
    listeners.add(wrapped);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }

  handleData(chunk) {
    if (!this.handshakeComplete) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
      const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = this.handshakeBuffer.subarray(0, headerEnd).toString('utf8');
      if (!header.startsWith('HTTP/1.1 101')) {
        this.socket.destroy(new Error(`CDP WebSocket upgrade failed: ${header.split('\r\n')[0]}`));
        return;
      }

      this.handshakeComplete = true;
      this.readyState = CdpWebSocket.OPEN;
      const remaining = this.handshakeBuffer.subarray(headerEnd + 4);
      this.handshakeBuffer = Buffer.alloc(0);
      this.dispatch('open', {});
      if (remaining.length === 0) {
        return;
      }
      this.frameBuffer = Buffer.concat([this.frameBuffer, remaining]);
    } else {
      this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    }

    this.readFrames();
  }

  readFrames() {
    while (this.frameBuffer.length >= 2) {
      const firstByte = this.frameBuffer[0];
      const secondByte = this.frameBuffer[1];
      const opcode = firstByte & 0x0f;
      const masked = Boolean(secondByte & 0x80);
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.frameBuffer.length < offset + 2) {
          return;
        }
        payloadLength = this.frameBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.frameBuffer.length < offset + 8) {
          return;
        }
        const high = this.frameBuffer.readUInt32BE(offset);
        const low = this.frameBuffer.readUInt32BE(offset + 4);
        payloadLength = high * 2 ** 32 + low;
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      if (this.frameBuffer.length < offset + maskLength + payloadLength) {
        return;
      }

      let payload = this.frameBuffer.subarray(offset + maskLength, offset + maskLength + payloadLength);
      if (masked) {
        const mask = this.frameBuffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.frameBuffer = this.frameBuffer.subarray(offset + maskLength + payloadLength);

      if (opcode === 0x1) {
        this.dispatch('message', { data: payload.toString('utf8') });
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.sendFrame(payload, 0xA);
      }
    }
  }

  send(data) {
    this.sendFrame(Buffer.from(data, 'utf8'), 0x1);
  }

  sendFrame(payload, opcode) {
    if (this.readyState !== CdpWebSocket.OPEN) {
      throw new Error('CDP WebSocket is not open');
    }

    let lengthHeader;
    if (payload.length < 126) {
      lengthHeader = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      lengthHeader = Buffer.alloc(4);
      lengthHeader[0] = 0x80 | opcode;
      lengthHeader[1] = 0x80 | 126;
      lengthHeader.writeUInt16BE(payload.length, 2);
    } else {
      lengthHeader = Buffer.alloc(10);
      lengthHeader[0] = 0x80 | opcode;
      lengthHeader[1] = 0x80 | 127;
      lengthHeader.writeUInt32BE(0, 2);
      lengthHeader.writeUInt32BE(payload.length, 6);
    }

    const mask = crypto.randomBytes(4);
    const maskedPayload = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      maskedPayload[index] = payload[index] ^ mask[index % 4];
    }
    this.socket.write(Buffer.concat([lengthHeader, mask, maskedPayload]));
  }

  close() {
    if (this.readyState === CdpWebSocket.CLOSED || this.readyState === CdpWebSocket.CLOSING) {
      return;
    }

    this.readyState = CdpWebSocket.CLOSING;
    if (this.handshakeComplete) {
      try {
        this.sendFrame(Buffer.alloc(0), 0x8);
      } catch {
        // Socket shutdown below is the fallback.
      }
    }
    this.socket.end();
  }
}

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

async function findRendererTarget({ stderr, deadlineMs = 15000 }) {
  const deadline = Date.now() + deadlineMs;
  let lastTargets = null;

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
        return target;
      }
    } catch {
      // Electron may not have opened the DevTools endpoint yet.
    }

    await delay(100);
  }

  const targetSummary = JSON.stringify(lastTargets, null, 2);
  throw new Error(
    `Timed out waiting for Electron renderer CDP target.\nLast CDP targets:\n${targetSummary}\n`
    + `Electron stderr:\n${stderr()}`,
  );
}

async function findRendererTargetViaCdp(client, { stderr, deadlineMs = 15000 }) {
  const deadline = Date.now() + deadlineMs;
  let lastTargets = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const { targetInfos } = await client.send('Target.getTargets');
      lastTargets = targetInfos;
      const target = targetInfos.find((entry) => entry.type === 'page');

      if (target) {
        return { id: target.targetId };
      }
    } catch (error) {
      lastError = error;
      // Electron may still be creating the renderer target.
    }

    await delay(100);
  }

  const targetSummary = JSON.stringify(lastTargets, null, 2);
  throw new Error(
    `Timed out waiting for Electron renderer CDP target.\nLast CDP targets:\n${targetSummary}\n`
    + `Last Target.getTargets error: ${lastError?.message || 'none'}\n`
    + `Electron stderr:\n${stderr()}`,
  );
}

async function findBrowserWebSocketUrl({ stderr, processSummary, deadlineMs = 15000 }) {
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    try {
      const version = await readJson(`http://127.0.0.1:${DEVTOOLS_PORT}/json/version`);
      if (typeof version.webSocketDebuggerUrl === 'string' && version.webSocketDebuggerUrl.length > 0) {
        return version.webSocketDebuggerUrl;
      }
    } catch {
      // Electron may not have opened the browser DevTools endpoint yet.
    }

    await delay(100);
  }

  throw new Error(
    `Timed out waiting for Electron browser CDP endpoint.\n${processSummary()}\nElectron stderr:\n${stderr()}`,
  );
}

function createCdpClient(webSocketDebuggerUrl, { stderr = () => '' } = {}) {
  const socket = new CdpWebSocket(webSocketDebuggerUrl);
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
    if (socket.readyState !== CdpWebSocket.OPEN) {
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
    }), CDP_COMMAND_TIMEOUT_MS, `Timed out waiting for CDP ${method}\nElectron stderr:\n${stderr()}`);
  }

  function on(method, listener) {
    const methodListeners = listeners.get(method) || new Set();
    methodListeners.add(listener);
    listeners.set(method, methodListeners);
  }

  return {
    close() {
      if (socket.readyState === CdpWebSocket.OPEN || socket.readyState === CdpWebSocket.CONNECTING) {
        socket.close();
      }
    },
    on,
    send,
    waitForOpen() {
      if (socket.readyState === CdpWebSocket.OPEN) {
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
        if (socket.readyState === CdpWebSocket.OPEN) {
          handleOpen();
        }
      }), CDP_COMMAND_TIMEOUT_MS, `Timed out opening CDP WebSocket\nElectron stderr:\n${stderr()}`);
    },
  };
}

async function evaluate(client, expression, sessionId = null) {
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

async function waitFor(client, expression, { sessionId = null, timeoutMs = 10000, intervalMs = 100 } = {}) {
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

if (shouldDelegateToNpmExecNode()) {
  test('Electron GUI launches, mounts the renderer, and exposes preload API', async () => {
    await runDelegatedSmoke();
  });
} else {
  test('Electron GUI launches, mounts the renderer, and exposes preload API', async (t) => {
  await assertDevToolsPortAvailable();

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-electron-smoke-'));
  const stderrChunks = [];
  const electronProcess = spawn(electronPath, [
    `--remote-debugging-port=${DEVTOOLS_PORT}`,
    '--remote-allow-origins=*',
    '--disable-gpu',
    `--user-data-dir=${userDataDir}`,
    mainPath,
    SMOKE_DISABLE_HARDWARE_ACCELERATION_ARG,
  ], {
    cwd: nodeShellRoot,
    env: {
      ...process.env,
      PATH: [
        path.join(nodeShellRoot, 'node_modules', '.bin'),
        process.env.PATH || '',
      ].filter(Boolean).join(path.delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let client = null;
  const waitForElectronClose = createProcessCloseWaiter(electronProcess);

  let electronExit = null;
  const stdoutChunks = [];
  const stderr = () => stderrChunks.join('').slice(-8000);
  const stdout = () => stdoutChunks.join('').slice(-8000);
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

  electronProcess.once('exit', (code, signal) => {
    electronExit = { code, signal };
    if (code !== null && code !== 0) {
      stderrChunks.push(`\nElectron exited early with code ${code} and signal ${signal || 'none'}.\n`);
    }
  });

  const browserWebSocketUrl = await findBrowserWebSocketUrl({ stderr, processSummary });
  client = createCdpClient(browserWebSocketUrl, { stderr });
  const exceptions = [];

  await client.waitForOpen();
  await delay(1500);
  const target = await findRendererTargetViaCdp(client, { stderr });
  const { sessionId } = await client.send('Target.attachToTarget', {
    flatten: true,
    targetId: target.id,
  });
  client.on('Runtime.exceptionThrown', (params) => {
    exceptions.push(params.exceptionDetails?.text || 'Runtime.exceptionThrown');
  });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);

  await evaluate(client, 'window.__UPI_SMOKE_RELOAD_MARKER__ = true', sessionId);
  await client.send('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor(client, (
    'window.__UPI_SMOKE_RELOAD_MARKER__ === undefined'
    + ' && document.readyState === "complete"'
    + ' && document.querySelector("#root")?.textContent?.trim().length > 0'
  ), { sessionId });

  const visibleText = await evaluate(client, 'document.body.innerText', sessionId);
  for (const expectedText of ['Overview', 'Packages', 'Issues', 'Opened containers', 'Details']) {
    assert.match(visibleText, new RegExp(expectedText));
  }

  assert.equal(await evaluate(client, 'typeof window.upi === "object" && window.upi !== null', sessionId), true);
  assert.deepEqual(exceptions, []);
  });
}
