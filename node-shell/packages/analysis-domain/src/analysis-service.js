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

function fileStamp(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
}

function hasAesRequiredIssue(response) {
  return Boolean(response?.issues?.some((issue) => String(issue.code || '').endsWith('.aes_key_required')));
}

class AnalysisService {
  constructor({
    backendClient,
    filePaths,
    aesSession = new AesKeySession(),
    cache = new AnalysisCache(),
  }) {
    this.backendClient = backendClient;
    this.filePaths = filePaths || [];
    this.aesSession = aesSession;
    this.cache = cache;
  }

  async analyze(filePath) {
    const kind = getContainerKind(filePath);
    if (kind === 'pak') {
      return this.analyzePak(filePath);
    }
    if (kind === 'utoc' || kind === 'ucas') {
      return this.analyzeIoStore(filePath);
    }
    return {
      status: UNSUPPORTED_CONTAINER_RESPONSE.status,
      issues: UNSUPPORTED_CONTAINER_RESPONSE.issues.map((issue) => ({ ...issue })),
    };
  }

  async analyzePak(pakPath) {
    const aesKey = this.aesSession.getKey();
    const cacheKey = this.cache.makeKey({
      analysisType: 'pak',
      paths: [pakPath],
      fileStamp: fileStamp(pakPath),
      aesKey,
    });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.backendClient.analyzePak({ pakPath, aesKey });
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

    const { utocPath, ucasPath } = selection;
    const aesKey = this.aesSession.getKey();
    const cacheKey = this.cache.makeKey({
      analysisType: 'iostore',
      paths: [utocPath, ucasPath],
      fileStamp: `${fileStamp(utocPath)}|${fileStamp(ucasPath)}`,
      aesKey,
    });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = await this.backendClient.analyzeIoStore({ utocPath, ucasPath, aesKey });
    this.cache.set(cacheKey, result);
    return result;
  }
}

module.exports = { AnalysisService, fileStamp, hasAesRequiredIssue };
