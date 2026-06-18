const assert = require('node:assert/strict');
const test = require('node:test');

const { AesKeySession, normalizeAesKey } = require('../src/aes-key-session.js');
const { aesKeyFingerprint } = require('../src/analysis-cache.js');

test('normalizes AES keys by trimming, removing 0x prefix, and lowercasing', () => {
  assert.equal(normalizeAesKey('  0xABCDEFABCDEFABCDEFABCDEFABCDEFAB  '), 'abcdefabcdefabcdefabcdefabcdefab');
  assert.equal(
    normalizeAesKey('0XABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD'),
    'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  );
});

test('normalizes Unreal config Base64 AES keys to lowercase hex', () => {
  assert.equal(
    normalizeAesKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='),
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  );
});

test('rejects AES keys with non-hex characters or unsupported lengths', () => {
  assert.throws(() => normalizeAesKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAZ'), {
    message: 'AES key must be 32 or 64 hex characters, or a Base64-encoded 16 or 32 byte key',
  });
  assert.throws(() => normalizeAesKey('0xABCDEF'), {
    message: 'AES key must be 32 or 64 hex characters, or a Base64-encoded 16 or 32 byte key',
  });
});

test('stores only normalized AES keys and clears session state', () => {
  const session = new AesKeySession();

  assert.equal(session.setKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAB'), 'abcdefabcdefabcdefabcdefabcdefab');
  assert.equal(session.getKey(), 'abcdefabcdefabcdefabcdefabcdefab');

  session.clear();

  assert.equal(session.getKey(), '');
});

test('fingerprints empty AES keys as none and hashes non-empty keys without exposing raw key', () => {
  const key = 'abcdefabcdefabcdefabcdefabcdefab';

  assert.equal(aesKeyFingerprint(''), 'none');
  assert.equal(aesKeyFingerprint(null), 'none');
  assert.equal(aesKeyFingerprint(key), aesKeyFingerprint(key));
  assert.notEqual(aesKeyFingerprint(key), key);
  assert.match(aesKeyFingerprint(key), /^[0-9a-f]{16}$/);
});
