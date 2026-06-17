const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WINDOWS_PATH_DELIMITER,
  resolveDllPath,
  buildDllSearchPath,
  getEngineWin64BinariesDir,
} = require('../src/dll-paths');

test('resolveDllPath returns an absolute path for a relative DLL argument', () => {
  const resolved = resolveDllPath('build/backend.dll', 'C:\\WORKSPACE_UE\\UnrealPackageInsight');
  assert.equal(resolved, 'C:\\WORKSPACE_UE\\UnrealPackageInsight\\build\\backend.dll');
});

test('resolveDllPath keeps an absolute DLL argument unchanged', () => {
  const absolutePath = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\Backend.dll';
  assert.equal(resolveDllPath(absolutePath), absolutePath);
});

test('resolveDllPath throws a usage error when the DLL path is missing or blank', () => {
  const usagePattern = /Backend DLL path is required/;

  assert.throws(() => resolveDllPath(), usagePattern);
  assert.throws(() => resolveDllPath(undefined), usagePattern);
  assert.throws(() => resolveDllPath(''), usagePattern);
  assert.throws(() => resolveDllPath('   '), usagePattern);
});

test('getEngineWin64BinariesDir resolves from an explicit engine root', () => {
  assert.equal(
    getEngineWin64BinariesDir('C:\\WORKSPACE_UE\\UnrealEngine'),
    'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64'
  );
});

test('getEngineWin64BinariesDir requires an explicit engine root', () => {
  assert.throws(() => getEngineWin64BinariesDir(), /engineRoot is required/);
  assert.throws(() => getEngineWin64BinariesDir(''), /engineRoot is required/);
  assert.throws(() => getEngineWin64BinariesDir('   '), /engineRoot is required/);
});

test('buildDllSearchPath requires an explicit engine root', () => {
  assert.throws(() => buildDllSearchPath({
    dllPath: 'C:\\backend\\UnrealPackageInsightBackend.dll',
    existingPath: '',
  }), /engineRoot is required/);
});

test('buildDllSearchPath prepends the DLL directory and engine Win64 binaries', () => {
  const dllPath = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend\\UnrealPackageInsightBackend.dll';
  const result = buildDllSearchPath({
    dllPath,
    engineRoot: 'C:\\WORKSPACE_UE\\UnrealEngine',
    existingPath: 'C:\\Windows\\System32',
  });

  const parts = result.split(WINDOWS_PATH_DELIMITER);
  assert.equal(parts[0], 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend');
  assert.equal(parts[1], 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64');
  assert.equal(parts[2], 'C:\\Windows\\System32');
});

test('buildDllSearchPath uses the Windows PATH delimiter for drive-letter paths', () => {
  assert.equal(WINDOWS_PATH_DELIMITER, ';');

  const dllDirectory = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend';
  const engineBinaries = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64';
  const dllPath = `${dllDirectory}\\UnrealPackageInsightBackend.dll`;
  const result = buildDllSearchPath({
    dllPath,
    engineRoot: 'C:\\WORKSPACE_UE\\UnrealEngine',
    existingPath: ['C:\\Tools\\bin', 'D:\\Sdk\\bin'].join(WINDOWS_PATH_DELIMITER),
  });

  assert.deepEqual(result.split(WINDOWS_PATH_DELIMITER), [
    dllDirectory,
    engineBinaries,
    'C:\\Tools\\bin',
    'D:\\Sdk\\bin',
  ]);
});

test('buildDllSearchPath dedupes existing PATH entries case-insensitively', () => {
  const dllDirectory = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend';
  const engineBinaries = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64';
  const dllPath = `${dllDirectory}\\UnrealPackageInsightBackend.dll`;
  const result = buildDllSearchPath({
    dllPath,
    engineRoot: 'C:\\WORKSPACE_UE\\UnrealEngine',
    existingPath: [
      'c:\\workspace_ue\\unrealengine\\engine\\binaries\\win64\\unrealpackageinsightbackend',
      'C:\\Tools\\bin',
      'c:\\workspace_ue\\unrealengine\\engine\\binaries\\win64',
    ].join(WINDOWS_PATH_DELIMITER),
  });

  const parts = result.split(WINDOWS_PATH_DELIMITER);
  assert.deepEqual(parts, [dllDirectory, engineBinaries, 'C:\\Tools\\bin']);
  assert.equal(parts.filter((part) => part.toLowerCase() === dllDirectory.toLowerCase()).length, 1);
  assert.equal(parts.filter((part) => part.toLowerCase() === engineBinaries.toLowerCase()).length, 1);
});
