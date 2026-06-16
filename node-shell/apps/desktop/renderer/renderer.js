'use strict';

const state = {
  activeTabId: '',
  analysisRequestId: 0,
  backendInfo: null,
  pendingAesFilePath: '',
  selectedFilePath: '',
  selectedTreeButton: null,
  tabs: [],
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  bindElements();
  bindEvents();
  loadBackendInfo();
});

function bindElements() {
  elements.openDirectory = document.getElementById('open-directory');
  elements.status = document.getElementById('status');
  elements.backendInfo = document.getElementById('backend-info');
  elements.selectedFile = document.getElementById('selected-file');
  elements.tree = document.getElementById('tree');
  elements.tabs = document.getElementById('tabs');
  elements.content = document.getElementById('content');
  elements.aesDialog = document.getElementById('aes-dialog');
  elements.aesForm = document.getElementById('aes-form');
  elements.aesKey = document.getElementById('aes-key');
  elements.aesMessage = document.getElementById('aes-message');
  elements.aesSubmit = document.getElementById('aes-submit');
  elements.aesCancel = document.getElementById('aes-cancel');
}

function bindEvents() {
  elements.openDirectory.addEventListener('click', openPackageDirectory);
  elements.aesForm.addEventListener('submit', handleAesSubmit);
  elements.aesCancel.addEventListener('click', () => {
    state.pendingAesFilePath = '';
    elements.aesDialog.close('cancel');
  });
}

async function loadBackendInfo() {
  setStatus('Loading backend...');
  try {
    const info = await window.upi.getBackendInfo();
    setBackendInfo(info);
    if (hasIssues(info)) {
      renderAnalysis(info);
      setStatus('Backend issue');
      return;
    }
    setStatus('Ready');
  } catch (error) {
    const issueResult = createErrorResult('renderer.backend_info_failed', error);
    setBackendInfo(issueResult);
    renderAnalysis(issueResult);
    setStatus('Backend error');
  }
}

function setStatus(text) {
  elements.status.textContent = text;
}

function setBackendInfo(info) {
  state.backendInfo = info;
  if (!info) {
    elements.backendInfo.textContent = 'Unavailable';
    return;
  }

  const details = [
    info.backendName,
    info.backendVersion ? `v${info.backendVersion}` : '',
    info.unrealVersion ? `UE ${info.unrealVersion}` : '',
    info.protocolVersion ? `protocol ${info.protocolVersion}` : '',
  ].filter(Boolean);
  if (details.length > 0) {
    elements.backendInfo.textContent = details.join(' | ');
    return;
  }

  elements.backendInfo.textContent = hasIssues(info) ? 'Issue reported' : 'Ready';
}

async function openPackageDirectory() {
  setStatus('Opening...');
  elements.openDirectory.disabled = true;
  try {
    const scan = await window.upi.openPackageDirectory();
    if (!scan) {
      setStatus('Open canceled');
      return;
    }

    renderTree(scan);
    clearSelectedFile();
    clearTabs();
    renderEmpty('Select a supported package file from the tree.');
    setStatus(formatScanStatus(scan));
  } catch (error) {
    renderAnalysis(createErrorResult('renderer.open_failed', error));
    setStatus('Open failed');
  } finally {
    elements.openDirectory.disabled = false;
  }
}

function formatScanStatus(scan) {
  const count = Array.isArray(scan?.files) ? scan.files.length : 0;
  return count === 1 ? '1 file found' : `${count} files found`;
}

function renderTree(scan) {
  replaceChildren(elements.tree);

  if (!scan?.tree || !Array.isArray(scan.tree.children) || scan.tree.children.length === 0) {
    elements.tree.appendChild(createEmptyState('No supported package files found.'));
    return;
  }

  elements.tree.appendChild(renderTreeNode(scan.tree, 0));
}

function renderTreeNode(node, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';

  const row = document.createElement('div');
  row.className = `tree-row ${node.kind === 'directory' ? 'directory' : 'file'}`;
  row.style.setProperty('--depth', String(depth));

  if (isSupportedFile(node)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-button';
    button.textContent = node.name || node.path || 'Unnamed file';
    button.title = node.relativePath || node.path || '';
    button.dataset.path = node.path || '';
    button.addEventListener('click', () => {
      selectTreeButton(button);
      analyzeFile(node.path);
    });
    row.appendChild(button);
  } else {
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name || node.path || 'Directory';
    label.title = node.path || '';
    row.appendChild(label);
  }

  wrapper.appendChild(row);

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      wrapper.appendChild(renderTreeNode(child, depth + 1));
    }
  }

  return wrapper;
}

function isSupportedFile(node) {
  return node?.kind === 'pak' || node?.kind === 'utoc' || node?.kind === 'ucas';
}

function selectTreeButton(button) {
  if (state.selectedTreeButton) {
    state.selectedTreeButton.classList.remove('selected');
    state.selectedTreeButton.removeAttribute('aria-current');
  }
  state.selectedTreeButton = button;
  button.classList.add('selected');
  button.setAttribute('aria-current', 'true');
}

function clearSelectedFile() {
  state.selectedFilePath = '';
  state.selectedTreeButton = null;
  elements.selectedFile.textContent = 'None';
}

async function analyzeFile(filePath) {
  const requestId = ++state.analysisRequestId;
  if (state.pendingAesFilePath && state.pendingAesFilePath !== filePath) {
    closeAesDialog('stale');
  }

  state.selectedFilePath = filePath;
  elements.selectedFile.textContent = filePath || 'None';
  clearTabs();
  renderEmpty('Analyzing...');
  setStatus('Analyzing...');

  try {
    const result = await window.upi.analyze(filePath);
    if (!isCurrentAnalysis(filePath, requestId)) {
      return;
    }

    if (needsAesKey(result)) {
      renderAnalysis(result);
      promptForAesKey(filePath);
      setStatus('AES key required');
      return;
    }

    renderAnalysis(result);
    setStatus('Analysis ready');
  } catch (error) {
    if (!isCurrentAnalysis(filePath, requestId)) {
      return;
    }

    renderAnalysis(createErrorResult('renderer.analysis_failed', error));
    setStatus('Analysis failed');
  }
}

function isCurrentAnalysis(filePath, requestId) {
  return state.selectedFilePath === filePath && state.analysisRequestId === requestId;
}

function needsAesKey(result) {
  return Boolean(result?.issues?.some((issue) => (
    String(issue?.code || '').endsWith('.aes_key_required')
  )));
}

function hasAesKeyInvalidIssue(result) {
  return Boolean(result?.issues?.some((issue) => (
    String(issue?.code || '').endsWith('.aes_key_invalid')
  )));
}

function hasAesRetryIssue(result) {
  return hasIssueCode(result, 'aes.invalid_key') || hasAesKeyInvalidIssue(result) || needsAesKey(result);
}

function hasIssueCode(result, code) {
  return Boolean(result?.issues?.some((issue) => String(issue?.code || '') === code));
}

function getFirstIssueMessage(result, fallback) {
  const issue = Array.isArray(result?.issues) ? result.issues[0] : null;
  return issue?.message || fallback;
}

function promptForAesKey(filePath) {
  state.pendingAesFilePath = filePath;
  elements.aesKey.value = '';
  elements.aesMessage.textContent = 'Enter the key for this container and analyze again.';
  elements.aesSubmit.disabled = false;

  if (typeof elements.aesDialog.showModal === 'function') {
    elements.aesDialog.showModal();
  } else {
    elements.aesDialog.setAttribute('open', '');
  }
  elements.aesKey.focus();
}

function closeAesDialog(reason) {
  state.pendingAesFilePath = '';
  if (elements.aesDialog.open) {
    elements.aesDialog.close(reason);
  }
}

function keepAesDialogOpenForIssue(filePath, result) {
  state.pendingAesFilePath = filePath;
  elements.aesMessage.textContent = getFirstIssueMessage(result, 'Invalid AES key.');

  if (!elements.aesDialog.open) {
    if (typeof elements.aesDialog.showModal === 'function') {
      elements.aesDialog.showModal();
    } else {
      elements.aesDialog.setAttribute('open', '');
    }
  }

  if (needsAesKey(result)) {
    setStatus('AES key required');
    return;
  }
  setStatus('AES key invalid');
}

async function handleAesSubmit(event) {
  event.preventDefault();
  const filePath = state.pendingAesFilePath;
  if (!filePath) {
    elements.aesDialog.close();
    return;
  }

  const aesKey = elements.aesKey.value.trim();
  elements.aesSubmit.disabled = true;
  elements.aesMessage.textContent = 'Analyzing with AES key...';
  setStatus('Retrying analysis...');

  try {
    const result = await window.upi.submitAesKeyAndRetry(filePath, aesKey);
    if (state.selectedFilePath !== filePath) {
      return;
    }

    if (hasAesRetryIssue(result)) {
      renderAnalysis(result);
      keepAesDialogOpenForIssue(filePath, result);
      return;
    }

    closeAesDialog('submit');
    renderAnalysis(result);
    if (needsAesKey(result)) {
      promptForAesKey(filePath);
      setStatus('AES key required');
    } else {
      setStatus('Analysis ready');
    }
  } catch (error) {
    if (state.selectedFilePath !== filePath) {
      return;
    }

    closeAesDialog('error');
    renderAnalysis(createErrorResult('renderer.aes_retry_failed', error));
    setStatus('AES retry failed');
  } finally {
    elements.aesSubmit.disabled = false;
  }
}

function renderAnalysis(result) {
  state.tabs = buildTabs(result);
  state.activeTabId = state.tabs[0]?.id || '';
  renderTabs();
  renderActiveTab();
}

function buildTabs(result) {
  if (!result || typeof result !== 'object') {
    return [{
      id: 'overview',
      label: 'Overview',
      render: () => renderValue({ status: 'No result returned.' }),
    }];
  }

  const tabs = [];
  const isIoStore = Array.isArray(result.chunks);
  const isPak = !isIoStore && Array.isArray(result.packages) && Array.isArray(result.compressedBlocks);

  if (isIoStore) {
    tabs.push({ id: 'overview', label: 'Overview', render: () => renderOverview(result) });
    tabs.push({ id: 'packages', label: 'Packages', render: () => createTable(result.packages || []) });
    tabs.push({ id: 'chunks', label: 'Chunks', render: () => createTable(result.chunks || []) });
    tabs.push({ id: 'blocks', label: 'Blocks', render: () => createTable(result.compressedBlocks || []) });
    tabs.push({ id: 'issues', label: 'Issues', render: () => renderIssues(result.issues || []) });
    return tabs;
  }

  if (isPak) {
    tabs.push({ id: 'overview', label: 'Overview', render: () => renderOverview(result) });
    tabs.push({ id: 'packages', label: 'Packages', render: () => createTable(result.packages || []) });
    tabs.push({ id: 'blocks', label: 'Blocks', render: () => createTable(result.compressedBlocks || []) });
    tabs.push({ id: 'issues', label: 'Issues', render: () => renderIssues(result.issues || []) });
    return tabs;
  }

  if (hasIssues(result)) {
    tabs.push({ id: 'issues', label: 'Issues', render: () => renderIssues(result.issues || []) });
  }
  if (result.overview || Object.keys(result).some((key) => key !== 'issues')) {
    tabs.push({ id: 'overview', label: 'Overview', render: () => renderOverview(result) });
  }
  if (tabs.length === 0) {
    tabs.push({ id: 'overview', label: 'Overview', render: () => renderValue(result) });
  }
  return tabs;
}

function renderTabs() {
  replaceChildren(elements.tabs);

  for (const tab of state.tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-button';
    button.textContent = tab.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === state.activeTabId));
    if (tab.id === state.activeTabId) {
      button.classList.add('active');
    }
    button.addEventListener('click', () => {
      state.activeTabId = tab.id;
      renderTabs();
      renderActiveTab();
    });
    elements.tabs.appendChild(button);
  }
}

function renderActiveTab() {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
  replaceChildren(elements.content);
  if (!tab) {
    elements.content.appendChild(createEmptyState('No analysis data available.'));
    return;
  }

  elements.content.appendChild(tab.render());
}

function renderOverview(result) {
  const fragment = document.createDocumentFragment();
  const summary = {};

  for (const [key, value] of Object.entries(result)) {
    if (key === 'issues' || key === 'packages' || key === 'chunks' || key === 'compressedBlocks' || key === 'partitions') {
      continue;
    }
    summary[key] = value;
  }

  fragment.appendChild(createSection('Summary', renderValue(summary)));

  if (Array.isArray(result.partitions)) {
    fragment.appendChild(createSection('Partitions', createTable(result.partitions)));
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'section-stack';
  wrapper.appendChild(fragment);
  return wrapper;
}

function renderValue(value) {
  if (Array.isArray(value)) {
    return createTable(value);
  }
  if (value && typeof value === 'object') {
    return createObjectTable(value);
  }

  const paragraph = document.createElement('p');
  paragraph.className = 'empty-state';
  paragraph.textContent = formatValue(value);
  return paragraph;
}

function createSection(title, content) {
  const section = document.createElement('section');
  section.className = 'data-section';

  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);
  section.appendChild(content);
  return section;
}

function createObjectTable(object) {
  const rows = Object.entries(object || {}).map(([field, value]) => ({ field, value }));
  return createTable(rows);
}

function createTable(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (normalizedRows.length === 0) {
    return createEmptyState('No rows to show.');
  }

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-wrapper';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const columns = getColumns(normalizedRows);

  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = formatLabel(column);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of normalizedRows) {
    const rowObject = normalizeRow(row);
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      td.textContent = formatValue(rowObject[column]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  tableWrapper.appendChild(table);
  return tableWrapper;
}

function getColumns(rows) {
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(normalizeRow(row))) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }
  return columns.length > 0 ? columns : ['value'];
}

function normalizeRow(row) {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return row;
  }
  return { value: row };
}

function renderIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return createEmptyState('No issues reported.');
  }

  const normalizedIssues = issues.map((issue) => ({
    severity: issue?.severity || '',
    code: issue?.code || '',
    message: issue?.message || String(issue || ''),
  }));
  return createTable(normalizedIssues);
}

function hasIssues(result) {
  return Array.isArray(result?.issues) && result.issues.length > 0;
}

function createErrorResult(code, error) {
  return {
    status: 'Error',
    issues: [{
      severity: 'error',
      code,
      message: error?.message || String(error || 'Unknown error'),
    }],
  };
}

function formatLabel(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value) {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, nestedValue) => (
        typeof nestedValue === 'bigint' ? String(nestedValue) : nestedValue
      ));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function clearTabs() {
  state.tabs = [];
  state.activeTabId = '';
  replaceChildren(elements.tabs);
}

function renderEmpty(text) {
  replaceChildren(elements.content);
  elements.content.appendChild(createEmptyState(text));
}

function createEmptyState(text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'empty-state';
  paragraph.textContent = text;
  return paragraph;
}

function replaceChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
