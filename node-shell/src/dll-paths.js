const path = require('node:path');

const DEFAULT_ENGINE_ROOT = 'C:\\WORKSPACE_UE\\UnrealEngine';

function usageError() {
  return new Error('Usage: node src/index.js <path-to-backend-dll>');
}

function resolveDllPath(dllPath, cwd = process.cwd()) {
  if (!dllPath || typeof dllPath !== 'string' || dllPath.trim().length === 0) {
    throw usageError();
  }

  return path.win32.isAbsolute(dllPath)
    ? path.win32.normalize(dllPath)
    : path.win32.resolve(cwd, dllPath);
}

function getEngineWin64BinariesDir(engineRoot = DEFAULT_ENGINE_ROOT) {
  return path.win32.join(engineRoot, 'Engine', 'Binaries', 'Win64');
}

function buildDllSearchPath({ dllPath, engineRoot = DEFAULT_ENGINE_ROOT, existingPath = process.env.PATH || '' }) {
  const dllDirectory = path.win32.dirname(dllPath);
  const engineBinaries = getEngineWin64BinariesDir(engineRoot);
  const additions = [dllDirectory, engineBinaries];
  const existingParts = existingPath.length > 0 ? existingPath.split(path.delimiter) : [];
  const seen = new Set();
  const merged = [];

  for (const part of additions.concat(existingParts)) {
    if (!part || seen.has(part.toLowerCase())) {
      continue;
    }

    seen.add(part.toLowerCase());
    merged.push(part);
  }

  return merged.join(path.delimiter);
}

module.exports = {
  DEFAULT_ENGINE_ROOT,
  resolveDllPath,
  getEngineWin64BinariesDir,
  buildDllSearchPath,
};
