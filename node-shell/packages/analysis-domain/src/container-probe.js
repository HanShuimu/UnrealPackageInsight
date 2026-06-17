const fs = require('node:fs');
const path = require('node:path');

const PAK_MAGIC = 0x5A6F12E1;
const UTOC_MAGIC = Buffer.from('-==--==--==--==-', 'ascii');

const PAK_VERSION_NAMES = new Map([
  [1, 'PakFile_Version_Initial'],
  [2, 'PakFile_Version_NoTimestamps'],
  [3, 'PakFile_Version_CompressionEncryption'],
  [4, 'PakFile_Version_IndexEncryption'],
  [5, 'PakFile_Version_RelativeChunkOffsets'],
  [6, 'PakFile_Version_DeleteRecords'],
  [7, 'PakFile_Version_EncryptionKeyGuid'],
  [8, 'PakFile_Version_FNameBasedCompressionMethod'],
  [9, 'PakFile_Version_FrozenIndex'],
  [10, 'PakFile_Version_PathHashIndex'],
  [11, 'PakFile_Version_Fnv64BugFix'],
  [12, 'PakFile_Version_Utf8PakDirectory'],
]);

const UTOC_VERSION_NAMES = new Map([
  [1, 'Initial'],
  [2, 'DirectoryIndex'],
  [3, 'PartitionSize'],
  [4, 'PerfectHash'],
  [5, 'PerfectHashWithOverflow'],
  [6, 'OnDemandMetaData'],
  [7, 'RemovedOnDemandMetaData'],
  [8, 'ReplaceIoChunkHashWithIoHash'],
]);

function ext(filePath) {
  return path.extname(filePath).toLowerCase();
}

function probePak(filePath) {
  const buffer = fs.readFileSync(filePath);
  const searchStart = Math.max(0, buffer.length - 512);
  for (let offset = searchStart; offset <= buffer.length - 8; offset += 1) {
    if (buffer.readUInt32LE(offset) === PAK_MAGIC) {
      const version = buffer.readInt32LE(offset + 4);
      return {
        containerType: 'pak',
        path: filePath,
        pakFormatVersion: version,
        pakFormatVersionName: PAK_VERSION_NAMES.get(version) || `PakFile_Version_${version}`,
      };
    }
  }
  throw new Error('probe.pak_footer_invalid');
}

function probeUtoc(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 52 || !buffer.subarray(0, UTOC_MAGIC.length).equals(UTOC_MAGIC)) {
    throw new Error('probe.utoc_header_invalid');
  }
  const tocFormatVersion = buffer.readUInt32LE(16);
  return {
    containerType: 'iostore',
    path: filePath,
    utocPath: filePath,
    tocFormatVersion,
    tocFormatVersionName: UTOC_VERSION_NAMES.get(tocFormatVersion) || `EIoStoreTocVersion_${tocFormatVersion}`,
    tocEntryCount: buffer.readUInt32LE(24),
    compressionBlockEntryCount: buffer.readUInt32LE(28),
    partitionCount: buffer.readUInt32LE(48),
  };
}

function probeContainerFile(filePath) {
  if (ext(filePath) === '.pak') {
    return probePak(filePath);
  }
  if (ext(filePath) === '.utoc') {
    return probeUtoc(filePath);
  }
  throw new Error('probe.unsupported_container');
}

module.exports = {
  PAK_MAGIC,
  UTOC_MAGIC,
  probeContainerFile,
  probePak,
  probeUtoc,
};
