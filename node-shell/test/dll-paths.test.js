const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
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

test('resolveDllPath throws a usage error when the DLL path is missing', () => {
  assert.throws(
    () => resolveDllPath(''),
    /Usage: node src[\\/]index\.js <path-to-backend-dll>/
  );
});

test('getEngineWin64BinariesDir resolves from the default engine root', () => {
  assert.equal(
    getEngineWin64BinariesDir('C:\\WORKSPACE_UE\\UnrealEngine'),
    'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64'
  );
});

test('buildDllSearchPath prepends the DLL directory and engine Win64 binaries', () => {
  const dllPath = 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend\\UnrealPackageInsightBackend.dll';
  const result = buildDllSearchPath({
    dllPath,
    engineRoot: 'C:\\WORKSPACE_UE\\UnrealEngine',
    existingPath: 'C:\\Windows\\System32',
  });

  const parts = result.split(path.delimiter);
  assert.equal(parts[0], 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64\\UnrealPackageInsightBackend');
  assert.equal(parts[1], 'C:\\WORKSPACE_UE\\UnrealEngine\\Engine\\Binaries\\Win64');
  assert.equal(parts[2], 'C:\\Windows\\System32');
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
    ].join(path.delimiter),
  });

  const parts = result.split(path.delimiter);
  assert.deepEqual(parts, [dllDirectory, engineBinaries, 'C:\\Tools\\bin']);
  assert.equal(parts.filter((part) => part.toLowerCase() === dllDirectory.toLowerCase()).length, 1);
  assert.equal(parts.filter((part) => part.toLowerCase() === engineBinaries.toLowerCase()).length, 1);
});
