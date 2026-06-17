const path = require('node:path');

const WINDOWS_PATH_DELIMITER = ';';

function usageError() {
  return new Error('Backend DLL path is required.');
}

function requireNonBlank(value, name) {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function resolveDllPath(dllPath, cwd = process.cwd()) {
  if (!dllPath || typeof dllPath !== 'string' || dllPath.trim().length === 0) {
    throw usageError();
  }

  return path.win32.isAbsolute(dllPath)
    ? path.win32.normalize(dllPath)
    : path.win32.resolve(cwd, dllPath);
}

function getEngineWin64BinariesDir(engineRoot) {
  return path.win32.join(requireNonBlank(engineRoot, 'engineRoot'), 'Engine', 'Binaries', 'Win64');
}

function buildDllSearchPath({ dllPath, engineRoot, existingPath = process.env.PATH || '' }) {
  const dllDirectory = path.win32.dirname(requireNonBlank(dllPath, 'dllPath'));
  const engineBinaries = getEngineWin64BinariesDir(engineRoot);
  const additions = [dllDirectory, engineBinaries];
  const existingParts = existingPath.length > 0 ? existingPath.split(WINDOWS_PATH_DELIMITER) : [];
  const seen = new Set();
  const merged = [];

  for (const part of additions.concat(existingParts)) {
    if (!part || seen.has(part.toLowerCase())) {
      continue;
    }

    seen.add(part.toLowerCase());
    merged.push(part);
  }

  return merged.join(WINDOWS_PATH_DELIMITER);
}

module.exports = {
  WINDOWS_PATH_DELIMITER,
  resolveDllPath,
  getEngineWin64BinariesDir,
  buildDllSearchPath,
};
