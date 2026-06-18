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

const AES_KEY_ERROR_MESSAGE = 'AES key must be 32 or 64 hex characters, or a Base64-encoded 16 or 32 byte key';
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function normalizeAesKey(input) {
  const trimmed = String(input || '').trim();
  const hasHexPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X');
  const withoutPrefix = hasHexPrefix ? trimmed.slice(2) : trimmed;
  if (withoutPrefix.length === 0) return '';
  if (/^[0-9a-fA-F]+$/.test(withoutPrefix)) {
    if (withoutPrefix.length === 32 || withoutPrefix.length === 64) {
      return withoutPrefix.toLowerCase();
    }
    throw new Error(AES_KEY_ERROR_MESSAGE);
  }
  if (!hasHexPrefix) {
    const normalizedBase64 = normalizeBase64AesKey(trimmed);
    if (normalizedBase64) {
      return normalizedBase64;
    }
  }
  throw new Error(AES_KEY_ERROR_MESSAGE);
}

function normalizeBase64AesKey(input) {
  if (input.length % 4 !== 0 || !BASE64_RE.test(input)) {
    return '';
  }

  const bytes = Buffer.from(input, 'base64');
  if (bytes.length !== 16 && bytes.length !== 32) {
    return '';
  }
  if (bytes.toString('base64') !== input) {
    return '';
  }
  return bytes.toString('hex');
}

module.exports = { AesKeySession, normalizeAesKey };
