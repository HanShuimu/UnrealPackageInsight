const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { probeContainerFile } = require('../src/container-probe.js');

function tempFile(t, fileName, buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function withReadFileSyncBlocked(t) {
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = () => {
    throw new Error('readFileSync should not be used by container probe');
  };
  t.after(() => {
    fs.readFileSync = originalReadFileSync;
  });
}

test('probes Pak footer magic and format version', (t) => {
  const buffer = Buffer.alloc(128);
  buffer.writeUInt32LE(0x5A6F12E1, 64);
  buffer.writeInt32LE(12, 68);
  const pakPath = tempFile(t, 'pakchunk0-Windows.pak', buffer);

  assert.deepEqual(probeContainerFile(pakPath), {
    containerType: 'pak',
    path: pakPath,
    pakFormatVersion: 12,
    pakFormatVersionName: 'PakFile_Version_Utf8PakDirectory',
  });
});

test('probes Pak footer using a bounded trailer read', (t) => {
  const buffer = Buffer.alloc(1024);
  buffer.writeUInt32LE(0x5A6F12E1, 900);
  buffer.writeInt32LE(11, 904);
  const pakPath = tempFile(t, 'large-window-test.pak', buffer);
  withReadFileSyncBlocked(t);

  assert.deepEqual(probeContainerFile(pakPath), {
    containerType: 'pak',
    path: pakPath,
    pakFormatVersion: 11,
    pakFormatVersionName: 'PakFile_Version_Fnv64BugFix',
  });
});

test('probes UTOC magic and TOC format version', (t) => {
  const buffer = Buffer.alloc(96);
  Buffer.from('-==--==--==--==-', 'ascii').copy(buffer, 0);
  buffer.writeUInt32LE(8, 16);
  buffer.writeUInt32LE(96, 20);
  buffer.writeUInt32LE(42, 24);
  buffer.writeUInt32LE(7, 28);
  buffer.writeUInt32LE(2, 48);
  const utocPath = tempFile(t, 'global.utoc', buffer);

  assert.deepEqual(probeContainerFile(utocPath), {
    containerType: 'iostore',
    path: utocPath,
    utocPath,
    tocFormatVersion: 8,
    tocFormatVersionName: 'ReplaceIoChunkHashWithIoHash',
    tocEntryCount: 42,
    compressionBlockEntryCount: 7,
    partitionCount: 2,
  });
});

test('probes UTOC header using a bounded header read', (t) => {
  const buffer = Buffer.alloc(128);
  Buffer.from('-==--==--==--==-', 'ascii').copy(buffer, 0);
  buffer.writeUInt32LE(7, 16);
  buffer.writeUInt32LE(42, 24);
  buffer.writeUInt32LE(7, 28);
  buffer.writeUInt32LE(3, 48);
  const utocPath = tempFile(t, 'bounded-header.utoc', buffer);
  withReadFileSyncBlocked(t);

  assert.deepEqual(probeContainerFile(utocPath), {
    containerType: 'iostore',
    path: utocPath,
    utocPath,
    tocFormatVersion: 7,
    tocFormatVersionName: 'RemovedOnDemandMetaData',
    tocEntryCount: 42,
    compressionBlockEntryCount: 7,
    partitionCount: 3,
  });
});

test('throws for unsupported container extensions', (t) => {
  const filePath = tempFile(t, 'notes.txt', Buffer.from('not a package'));

  assert.throws(() => probeContainerFile(filePath), /probe\.unsupported_container/);
});

test('throws for short Pak files without a valid footer', (t) => {
  const pakPath = tempFile(t, 'short.pak', Buffer.alloc(4));

  assert.throws(() => probeContainerFile(pakPath), /probe\.pak_footer_invalid/);
});

test('throws for Pak files without footer magic', (t) => {
  const pakPath = tempFile(t, 'missing-magic.pak', Buffer.alloc(128));

  assert.throws(() => probeContainerFile(pakPath), /probe\.pak_footer_invalid/);
});

test('throws for short UTOC files', (t) => {
  const utocPath = tempFile(t, 'short.utoc', Buffer.alloc(16));

  assert.throws(() => probeContainerFile(utocPath), /probe\.utoc_header_invalid/);
});

test('throws for UTOC files with invalid magic', (t) => {
  const buffer = Buffer.alloc(96);
  Buffer.from('bad-magic-value!', 'ascii').copy(buffer, 0);
  const utocPath = tempFile(t, 'bad-magic.utoc', buffer);

  assert.throws(() => probeContainerFile(utocPath), /probe\.utoc_header_invalid/);
});
