class AesKeySession {
  constructor() {
    this.key = '';
  }

  setKey(key) {
    const normalized = normalizeAesKey(key);
    this.key = normalized;
    return normalized;
  }

  getKey() {
    return this.key;
  }

  clear() {
    this.key = '';
  }
}

function normalizeAesKey(input) {
  const trimmed = String(input || '').trim();
  const withoutPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (withoutPrefix.length === 0) return '';
  if (!/^[0-9a-fA-F]+$/.test(withoutPrefix) || (withoutPrefix.length !== 32 && withoutPrefix.length !== 64)) {
    throw new Error('AES key must be 32 or 64 hex characters');
  }
  return withoutPrefix.toLowerCase();
}

module.exports = { AesKeySession, normalizeAesKey };
