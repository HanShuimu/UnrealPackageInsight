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
