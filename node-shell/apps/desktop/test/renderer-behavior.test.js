const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererPath = path.join(__dirname, '..', 'renderer', 'renderer.js');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.eventListeners = new Map();
    this.parentNode = null;
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = value;
      },
    };
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.open = false;
    this.closeCalls = [];
    this.showModalCalls = 0;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  set className(value) {
    this.attributes.set('class', value);
    this.classList = new FakeClassList();
    for (const className of String(value).split(/\s+/).filter(Boolean)) {
      this.classList.add(className);
    }
  }

  get className() {
    return this.attributes.get('class') || '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'open') {
      this.open = true;
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, handler) {
    if (!this.eventListeners.has(name)) {
      this.eventListeners.set(name, new Set());
    }
    this.eventListeners.get(name).add(handler);
  }

  removeEventListener(name, handler) {
    this.eventListeners.get(name)?.delete(handler);
  }

  dispatchEvent(event) {
    event.target = this;
    for (const handler of this.eventListeners.get(event.type) || []) {
      handler(event);
    }
    return !event.defaultPrevented;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  querySelector(selector) {
    const matches = (element) => {
      if (selector === 'input[name="backend"]') {
        return element.tagName === 'INPUT' && element.name === 'backend';
      }
      if (selector === 'input[name="backend"]:checked') {
        return element.tagName === 'INPUT' && element.name === 'backend' && element.checked;
      }
      return false;
    };
    const visit = (element) => {
      if (matches(element)) {
        return element;
      }
      for (const child of element.children) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return visit(this);
  }

  showModal() {
    this.open = true;
    this.showModalCalls += 1;
  }

  close(reason = '') {
    this.open = false;
    this.closeCalls.push(reason);
    this.dispatchEvent({ type: 'close' });
  }

  focus() {
    this.focused = true;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.elements = new Map();
    for (const id of [
      'open-directory',
      'status',
      'backend-info',
      'selected-file',
      'tree',
      'tabs',
      'content',
      'aes-dialog',
      'aes-form',
      'aes-key',
      'aes-message',
      'aes-submit',
      'aes-cancel',
      'backend-dialog',
      'backend-form',
      'backend-message',
      'backend-options',
      'backend-cancel',
      'backend-submit',
    ]) {
      this.elements.set(id, new FakeElement(id.endsWith('-dialog') ? 'dialog' : 'div'));
    }
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  getElementById(id) {
    return this.elements.get(id);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createDocumentFragment() {
    return new FakeElement('fragment');
  }

  dispatchReady() {
    this.listeners.get('DOMContentLoaded')();
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushMacrotask() {
  await new Promise((resolve) => setImmediate(resolve));
}

function collectText(node) {
  if (!node) {
    return '';
  }
  return [
    node.textContent || '',
    ...node.children.map((child) => collectText(child)),
  ].join(' ');
}

async function loadRenderer(upiOverrides = {}) {
  const document = new FakeDocument();
  const context = {
    document,
    window: {
      upi: {
        getBackendInfo: async () => ({ status: 'OK', backendName: 'TestBackend' }),
        openPackageDirectory: async () => null,
        analyze: async () => ({ status: 'OK', overview: {} }),
        submitAesKeyAndRetry: async () => ({ status: 'OK', overview: {} }),
        chooseBackend: async () => '',
        ...upiOverrides,
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(rendererPath, 'utf8'), context, { filename: rendererPath });
  document.dispatchReady();
  await flushPromises();
  return { context, document };
}

function pakResult(label) {
  return {
    status: 'OK',
    overview: { selected: label },
    packages: [],
    compressedBlocks: [],
    issues: [],
  };
}

function aesRequiredResult() {
  return {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'pak.aes_key_required',
      message: 'AES key required',
    }],
  };
}

function backendSelectionResult(filePath = 'C:\\Paks\\A.pak') {
  return {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'backend.multiple_candidates',
      message: 'Multiple compatible backends found.',
    }],
    backendSelection: {
      filePath,
      candidates: [{
        id: 'ue-5.7.4-win32-x64-development',
        label: 'UE 5.7.4 Development',
      }],
    },
  };
}

test('stale analysis results do not overwrite the current selected file panel', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const { context, document } = await loadRenderer({
    analyze: (filePath) => {
      calls.push(filePath);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });

  const firstAnalysis = context.analyzeFile('C:\\Paks\\A.pak');
  const secondAnalysis = context.analyzeFile('C:\\Paks\\B.pak');
  second.resolve(pakResult('B'));
  await flushPromises();
  first.resolve(pakResult('A'));
  await Promise.all([firstAnalysis, secondAnalysis]);

  assert.equal(document.getElementById('selected-file').textContent, 'C:\\Paks\\B.pak');
  const contentText = collectText(document.getElementById('content'));
  assert.match(contentText, /B/);
  assert.doesNotMatch(contentText, /A/);
});

test('stale AES-required analysis results do not prompt for an old file', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const { context, document } = await loadRenderer({
    analyze: (filePath) => {
      calls.push(filePath);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });

  const firstAnalysis = context.analyzeFile('C:\\Paks\\A.pak');
  const secondAnalysis = context.analyzeFile('C:\\Paks\\B.pak');
  second.resolve(pakResult('B'));
  await flushPromises();
  first.resolve(aesRequiredResult());
  await Promise.all([firstAnalysis, secondAnalysis]);

  assert.equal(document.getElementById('aes-dialog').open, false);
  assert.equal(document.getElementById('selected-file').textContent, 'C:\\Paks\\B.pak');
  const contentText = collectText(document.getElementById('content'));
  assert.match(contentText, /B/);
  assert.doesNotMatch(contentText, /AES key required/);
});

test('stale analysis errors do not overwrite the current selected file panel', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const { context, document } = await loadRenderer({
    analyze: (filePath) => {
      calls.push(filePath);
      return calls.length === 1 ? first.promise : second.promise;
    },
  });

  const firstAnalysis = context.analyzeFile('C:\\Paks\\A.pak');
  const secondAnalysis = context.analyzeFile('C:\\Paks\\B.pak');
  second.resolve(pakResult('B'));
  await flushPromises();
  first.reject(new Error('A failed late'));
  await Promise.all([firstAnalysis, secondAnalysis]);

  assert.equal(document.getElementById('selected-file').textContent, 'C:\\Paks\\B.pak');
  const contentText = collectText(document.getElementById('content'));
  assert.match(contentText, /B/);
  assert.doesNotMatch(contentText, /A failed late/);
});

test('invalid AES key retry keeps the dialog open with the validation issue', async () => {
  const { context, document } = await loadRenderer({
    analyze: async () => ({
      status: 'Error',
      issues: [{
        severity: 'error',
        code: 'pak.aes_key_required',
        message: 'AES key required',
      }],
    }),
    submitAesKeyAndRetry: async () => ({
      status: 'Error',
      issues: [{
        severity: 'error',
        code: 'aes.invalid_key',
        message: 'AES key must be 32 or 64 hex characters',
      }],
    }),
  });
  const dialog = document.getElementById('aes-dialog');
  const message = document.getElementById('aes-message');
  const submit = document.getElementById('aes-submit');
  await context.analyzeFile('C:\\Paks\\A.pak');
  document.getElementById('aes-key').value = 'bad-key';

  await context.handleAesSubmit({ preventDefault() {} });

  assert.equal(dialog.open, true);
  assert.deepEqual(dialog.closeCalls, []);
  assert.equal(submit.disabled, false);
  assert.equal(message.textContent, 'AES key must be 32 or 64 hex characters');
});

test('backend Pak AES initial analysis failure prompts for another key', async () => {
  const { context, document } = await loadRenderer({
    analyze: async () => ({
      status: 'Error',
      issues: [{
        severity: 'error',
        code: 'pak.aes_key_invalid',
        message: 'Pak analysis failed with the provided AES key.',
      }],
    }),
  });
  const dialog = document.getElementById('aes-dialog');
  const message = document.getElementById('aes-message');

  await context.analyzeFile('C:\\Paks\\A.pak');

  assert.equal(dialog.open, true);
  assert.equal(message.textContent, 'Pak analysis failed with the provided AES key.');
  assert.equal(document.getElementById('status').textContent, 'AES key invalid');
  const contentText = collectText(document.getElementById('content'));
  assert.match(contentText, /pak\.aes_key_invalid/);
  assert.doesNotMatch(contentText, /Analysis ready/);
});

test('backend Pak AES retry failure keeps the dialog open with the backend issue', async () => {
  const { context, document } = await loadRenderer({
    analyze: async () => aesRequiredResult(),
    submitAesKeyAndRetry: async () => ({
      status: 'Error',
      issues: [{
        severity: 'error',
        code: 'pak.aes_key_invalid',
        message: 'Pak analysis failed with the provided AES key.',
      }],
    }),
  });
  const dialog = document.getElementById('aes-dialog');
  const message = document.getElementById('aes-message');
  await context.analyzeFile('C:\\Paks\\A.pak');
  document.getElementById('aes-key').value = 'abcdefabcdefabcdefabcdefabcdefab';

  await context.handleAesSubmit({ preventDefault() {} });

  assert.equal(dialog.open, true);
  assert.deepEqual(dialog.closeCalls, []);
  assert.equal(message.textContent, 'Pak analysis failed with the provided AES key.');
  assert.equal(document.getElementById('status').textContent, 'AES key invalid');
  const contentText = collectText(document.getElementById('content'));
  assert.match(contentText, /pak\.aes_key_invalid/);
  assert.doesNotMatch(contentText, /Analysis ready/);
});

test('backend IoStore AES retry requirement keeps the dialog open with the backend issue', async () => {
  const { context, document } = await loadRenderer({
    analyze: async () => ({
      status: 'Error',
      issues: [{
        severity: 'error',
        code: 'iostore.aes_key_required',
        message: 'IoStore container is encrypted and requires an AES key.',
      }],
    }),
    submitAesKeyAndRetry: async () => ({
      status: 'Error',
      issues: [{
        severity: 'error',
        code: 'iostore.aes_key_required',
        message: 'IoStore container still requires an AES key.',
      }],
    }),
  });
  const dialog = document.getElementById('aes-dialog');
  const message = document.getElementById('aes-message');
  await context.analyzeFile('C:\\Paks\\global.utoc');
  document.getElementById('aes-key').value = 'abcdefabcdefabcdefabcdefabcdefab';

  await context.handleAesSubmit({ preventDefault() {} });

  assert.equal(dialog.open, true);
  assert.deepEqual(dialog.closeCalls, []);
  assert.equal(message.textContent, 'IoStore container still requires an AES key.');
  assert.equal(document.getElementById('status').textContent, 'AES key required');
});

test('AES retry result does not overwrite the panel after selecting another file', async () => {
  const retry = deferred();
  const calls = [];
  const { context, document } = await loadRenderer({
    analyze: async (filePath) => {
      calls.push(filePath);
      return calls.length === 1 ? aesRequiredResult() : pakResult('B');
    },
    submitAesKeyAndRetry: () => retry.promise,
  });

  await context.analyzeFile('C:\\Paks\\A.pak');
  const retryAnalysis = context.handleAesSubmit({ preventDefault() {} });
  await context.analyzeFile('C:\\Paks\\B.pak');
  retry.resolve(pakResult('A with key'));
  await retryAnalysis;

  assert.equal(document.getElementById('selected-file').textContent, 'C:\\Paks\\B.pak');
  const contentText = collectText(document.getElementById('content'));
  assert.match(contentText, /B/);
  assert.doesNotMatch(contentText, /A with key/);
});

test('native backend dialog close resolves selection as canceled', async () => {
  const chooseRequests = [];
  const { context, document } = await loadRenderer({
    analyze: async (filePath) => backendSelectionResult(filePath),
    chooseBackend: async (request) => {
      chooseRequests.push(request);
      return request.selectedId;
    },
  });

  const analysis = context.analyzeFile('C:\\Paks\\A.pak');
  const dialog = document.getElementById('backend-dialog');
  for (let attempt = 0; attempt < 5 && !dialog.open; attempt += 1) {
    await flushMacrotask();
  }
  assert.equal(dialog.open, true);

  dialog.close('cancel');
  await flushMacrotask();
  const outcome = await Promise.race([
    analysis.then(() => 'resolved'),
    new Promise((resolve) => { setTimeout(() => resolve('pending'), 25); }),
  ]);

  assert.equal(outcome, 'resolved');
  assert.deepEqual(JSON.parse(JSON.stringify(chooseRequests)), [{
    ...backendSelectionResult('C:\\Paks\\A.pak').backendSelection,
    selectedId: '',
  }]);
  assert.equal(document.getElementById('status').textContent, 'Backend selection canceled');
});
