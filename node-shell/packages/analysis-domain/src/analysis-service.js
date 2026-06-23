const fs = require('node:fs');

const { getContainerKind, resolveIoStoreSelection } = require('./container-pairing.js');
const { AnalysisCache } = require('./analysis-cache.js');
const { AesKeySession } = require('./aes-key-session.js');

const UNSUPPORTED_CONTAINER_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'container.unsupported',
    message: 'Unsupported container file type.',
  }],
};

const FILE_UNAVAILABLE_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'container.file_unavailable',
    message: 'Selected container file is unavailable.',
  }],
};

function cloneErrorResponse(response) {
  return {
    status: response.status,
    issues: response.issues.map((issue) => ({ ...issue })),
  };
}

function isBigIntStatUnsupported(error) {
  return error instanceof TypeError || error?.code === 'ERR_INVALID_ARG_TYPE';
}

function formatStatStamp(stat) {
  const mtime = stat.mtimeNs !== undefined ? stat.mtimeNs : stat.mtimeMs;
  const ctime = stat.ctimeNs !== undefined ? stat.ctimeNs : stat.ctimeMs;
  return `${stat.size}:${mtime}:${ctime}`;
}

async function fileStamp(filePath) {
  try {
    return formatStatStamp(await fs.promises.stat(filePath, { bigint: true }));
  } catch (error) {
    if (!isBigIntStatUnsupported(error)) {
      throw error;
    }
    return formatStatStamp(await fs.promises.stat(filePath));
  }
}

function hasAesRequiredIssue(response) {
  return Boolean(response?.issues?.some((issue) => String(issue.code || '').endsWith('.aes_key_required')));
}

function attachBackendId(result, backendId) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  return {
    ...result,
    backendId,
  };
}

function resolveBackendSelectionTarget(filePath, filePaths) {
  const kind = getContainerKind(filePath);
  if (kind === 'pak') {
    return { ok: true, probePath: filePath };
  }

  if (kind === 'utoc' || kind === 'ucas') {
    const selection = resolveIoStoreSelection(filePath, filePaths);
    if (!selection?.ok) {
      return { ok: false };
    }

    return { ok: true, probePath: selection.utocPath };
  }

  return { ok: false };
}

class AnalysisService {
  constructor({
    backendClient,
    backendClientProvider = null,
    filePaths,
    aesSession = new AesKeySession(),
    cache = new AnalysisCache(),
  }) {
    this.backendClient = backendClient;
    this.backendClientProvider = backendClientProvider;
    this.filePaths = filePaths || [];
    this.aesSession = aesSession;
    this.cache = cache;
  }

  async resolveBackend(filePath) {
    if (this.backendClientProvider) {
      return this.backendClientProvider.resolveForFile(filePath, this.filePaths);
    }
    return { backendId: 'legacy', client: this.backendClient };
  }

  getBackendSelection(filePath) {
    if (!this.backendClientProvider || typeof this.backendClientProvider.getCandidateSelection !== 'function') {
      return null;
    }

    const target = resolveBackendSelectionTarget(filePath, this.filePaths);
    if (!target.ok) {
      return null;
    }

    return {
      ...this.backendClientProvider.getCandidateSelection(target.probePath, this.filePaths),
      analysisFilePath: filePath,
    };
  }

  async analyze(filePath) {
    const kind = getContainerKind(filePath);
    if (kind === 'pak') {
      return this.analyzePak(filePath);
    }
    if (kind === 'utoc' || kind === 'ucas') {
      return this.analyzeIoStore(filePath);
    }
    return cloneErrorResponse(UNSUPPORTED_CONTAINER_RESPONSE);
  }

  async analyzePak(pakPath) {
    const aesKey = this.aesSession.getKey();
    let stamp;
    try {
      stamp = await fileStamp(pakPath);
    } catch {
      return cloneErrorResponse(FILE_UNAVAILABLE_RESPONSE);
    }

    const { backendId, client } = await this.resolveBackend(pakPath);
    const cacheKey = this.cache.makeKey({
      analysisType: 'pak',
      paths: [pakPath],
      fileStamp: stamp,
      aesKey,
      backendId,
    });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = attachBackendId(await client.analyzePak({ pakPath, aesKey }), backendId);
    this.cache.set(cacheKey, result);
    return result;
  }

  async analyzeIoStore(selectedPath) {
    const selection = resolveIoStoreSelection(selectedPath, this.filePaths);
    if (!selection?.ok) {
      return {
        status: 'Error',
        issues: [{ ...selection.issue }],
      };
    }

    const { utocPath, ucasPath, ucasPaths } = selection;
    const cachePaths = [utocPath, ...ucasPaths];
    const aesKey = this.aesSession.getKey();
    let stamps;
    try {
      stamps = await Promise.all(cachePaths.map((containerPath) => fileStamp(containerPath)));
    } catch {
      return cloneErrorResponse(FILE_UNAVAILABLE_RESPONSE);
    }

    const { backendId, client } = await this.resolveBackend(utocPath);
    const cacheKey = this.cache.makeKey({
      analysisType: 'iostore',
      paths: cachePaths,
      fileStamp: stamps.join('|'),
      aesKey,
      backendId,
    });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = attachBackendId(await client.analyzeIoStore({ utocPath, ucasPath, aesKey }), backendId);
    this.cache.set(cacheKey, result);
    return result;
  }
}

module.exports = { AnalysisService, fileStamp, hasAesRequiredIssue };
