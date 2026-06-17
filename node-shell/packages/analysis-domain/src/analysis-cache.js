const crypto = require('node:crypto');

function aesKeyFingerprint(key) {
  if (!key) return 'none';
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

class AnalysisCache {
  constructor() {
    this.entries = new Map();
  }

  makeKey(parts) {
    return [
      parts.analysisType,
      parts.backendId || 'legacy',
      (parts.paths || []).join('|').toLowerCase(),
      parts.fileStamp,
      aesKeyFingerprint(parts.aesKey),
    ].join('::');
  }

  get(key) {
    return this.entries.get(key);
  }

  set(key, value) {
    this.entries.set(key, value);
  }
}

module.exports = { AnalysisCache, aesKeyFingerprint };
