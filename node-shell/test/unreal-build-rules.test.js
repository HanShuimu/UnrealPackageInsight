const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const buildRulesPath = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'UnrealPackageInsightBackend.Build.cs',
);
const publicHeaderPath = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'Public',
  'UnrealPackageInsightBackend.h',
);
const containerExtractorPath = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'Private',
  'ContainerExtractor.cpp',
);

test('Unreal Build.cs uses Program-local generated protocol includes only', () => {
  const source = fs.readFileSync(buildRulesPath, 'utf8');
  const forbiddenSnippets = [
    ['UPI', '_REPO', '_ROOT'].join(''),
    [
      'Path.Combine("node-shell", "packages", "protocol", ',
      '"generated", "cpp")',
    ].join(''),
    ['FindGeneratedCpp', 'IncludePath'].join(''),
    ['Directory', '.GetCurrentDirectory()'].join(''),
  ];

  for (const snippet of forbiddenSnippets) {
    assert.equal(source.includes(snippet), false);
  }

  assert.match(source, /Path\.Combine\(ModuleDirectory,\s*"Generated",\s*"Protocol"\)/);
});

test('native public ABI declares container extraction exports', () => {
  const source = fs.readFileSync(publicHeaderPath, 'utf8');

  assert.match(
    source,
    /UPI_BACKEND_API\s+int32_t\s+UPI_ExtractPakV1\(const char\*\s+PakPathUtf8,\s+const char\*\s+OutputDirectoryUtf8,\s+const char\*\s+AesKeyUtf8OrNull,\s+uint8_t\*\s+OutBytes,\s+int32_t\s+OutCapacity,\s+int32_t\*\s+RequiredSize\);/,
  );
  assert.match(
    source,
    /UPI_BACKEND_API\s+int32_t\s+UPI_ExtractIoStoreV1\(const char\*\s+UtocPathUtf8,\s+const char\*\s+UcasPathUtf8,\s+const char\*\s+OutputDirectoryUtf8,\s+const char\*\s+AesKeyUtf8OrNull,\s+uint8_t\*\s+OutBytes,\s+int32_t\s+OutCapacity,\s+int32_t\*\s+RequiredSize\);/,
  );
});

test('native extraction follows approved IoStore and AES spec details', () => {
  const source = fs.readFileSync(containerExtractorPath, 'utf8');

  assert.equal(source.includes('return OutKey.IsValid();'), false);
  assert.match(source, /bOutHasKey\s*=\s*true;\s*return\s+true;/);
  assert.equal(source.includes('&OrderMap'), false);
  assert.match(
    source,
    /ExtractFilesFromIoStoreContainer\(\s*\*OutResult\.ContainerPath,\s*\*OutputDirectory,\s*KeyChain,\s*nullptr,\s*nullptr,\s*nullptr,\s*&bIsSigned\s*\)/,
  );
});

test('native extraction hardens encrypted container key handling and preflight', () => {
  const source = fs.readFileSync(containerExtractorPath, 'utf8');

  assert.match(source, /SecondaryEncryptionKeys/);
  assert.match(source, /EncryptionKeyGuid\.IsValid\(\)/);
  assert.match(source, /UPI_AddKeyToKeyChain\(TocHeader\.EncryptionKeyGuid,\s*ParsedKey,\s*KeyChain\)/);
  assert.match(source, /UPI_ResolveIoStorePaths\(UtocPath,\s*UcasPath/);

  assert.match(source, /UPI_ReadPakIndexData/);
  assert.match(source, /UPI_CanDecryptPakIndexWithKey/);
  assert.match(source, /bEncryptedIndex/);
  assert.match(source, /Entry\.IsEncrypted\(\)/);
  assert.match(source, /UPI_PreflightPakForExtraction\(PakPath,\s*ParsedKey,\s*bHasKey,\s*PakEncryptionKeyGuid\)/);

  assert.match(source, /UPI_CanCreateFile\(TempResponseFile\)/);
  assert.match(source, /ExecuteUnrealPak\(\*CommandLine\)/);
  assert.ok(source.indexOf('UPI_CanCreateFile(TempResponseFile)') < source.indexOf('ExecuteUnrealPak(*CommandLine)'));
});

test('native Pak preflight registers runtime key before loading the index', () => {
  const source = fs.readFileSync(containerExtractorPath, 'utf8');
  const preflightStart = source.indexOf('bool UPI_PreflightPakForExtraction(');
  assert.notEqual(preflightStart, -1);

  const preflightEnd = source.indexOf('\n\tvoid UPI_AddKeyToKeyChain', preflightStart);
  assert.notEqual(preflightEnd, -1);

  const preflightSource = source.slice(preflightStart, preflightEnd);
  const trailerGuidIndex = preflightSource.indexOf('OutEncryptionKeyGuid = TrailerInfo.EncryptionKeyGuid;');
  const noKeyGuidGuardIndex = preflightSource.indexOf('if (TrailerInfo.EncryptionKeyGuid.IsValid() && !bHasKey)');
  const registrationIndex = preflightSource.indexOf('UPI_RegisterPakRuntimeKey(TrailerInfo.EncryptionKeyGuid, ParsedKey);');
  const indexLoadIndex = preflightSource.indexOf('MakeRefCount<FPakFile>(&PlatformFile, *PakPath, false, true)');

  assert.notEqual(trailerGuidIndex, -1);
  assert.notEqual(noKeyGuidGuardIndex, -1);
  assert.notEqual(registrationIndex, -1);
  assert.notEqual(indexLoadIndex, -1);
  assert.ok(trailerGuidIndex < registrationIndex);
  assert.ok(trailerGuidIndex < noKeyGuidGuardIndex);
  assert.ok(noKeyGuidGuardIndex < indexLoadIndex);
  assert.ok(registrationIndex < indexLoadIndex);
});
