const fs = require('node:fs');
const path = require('node:path');

function defaultNativeRoot() {
  return path.join(__dirname, '..', '..', '..', 'native');
}

function assertManifest(manifest, manifestPath) {
  for (const key of ['id', 'engineVersion', 'hostPlatform', 'hostArch', 'configuration', 'configurationKey', 'protocolVersion', 'dll', 'supports']) {
    if (manifest[key] === undefined) {
      throw new Error(`backend.manifest_invalid: ${manifestPath} missing ${key}`);
    }
  }
}

function assertHostCompatibility(manifest, manifestPath, platform, arch) {
  const mismatches = [];
  if (manifest.hostPlatform !== platform) {
    mismatches.push(`hostPlatform expected ${platform} got ${manifest.hostPlatform}`);
  }
  if (manifest.hostArch !== arch) {
    mismatches.push(`hostArch expected ${arch} got ${manifest.hostArch}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`backend.manifest_invalid: ${manifestPath} (${manifest.id}) ${mismatches.join(', ')}`);
  }
}

function findManifestFiles(root, files = []) {
  if (!fs.existsSync(root)) {
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      findManifestFiles(entryPath, files);
    } else if (entry.isFile() && entry.name === 'backend.json') {
      files.push(entryPath);
    }
  }
  return files;
}

function loadBackendManifests({
  nativeRoot = defaultNativeRoot(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return findManifestFiles(path.join(nativeRoot, `${platform}-${arch}`))
    .sort()
    .map((manifestPath) => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assertManifest(manifest, manifestPath);
      assertHostCompatibility(manifest, manifestPath, platform, arch);
      const dllPath = path.resolve(path.dirname(manifestPath), manifest.dll);
      if (!fs.existsSync(dllPath) || !fs.statSync(dllPath).isFile()) {
        throw new Error(`backend.manifest_invalid: DLL missing for ${manifest.id}: ${dllPath}`);
      }
      return { ...manifest, dllPath, manifestPath };
    });
}

function manifestLabel(manifest) {
  return `UE ${manifest.engineVersion} ${manifest.configuration}`;
}

function summarizeBackends(manifests) {
  return {
    status: 'OK',
    backendCount: manifests.length,
    backends: manifests.map((manifest) => ({
      id: manifest.id,
      label: manifestLabel(manifest),
      engineVersion: manifest.engineVersion,
      configuration: manifest.configuration,
    })),
  };
}

module.exports = {
  defaultNativeRoot,
  loadBackendManifests,
  manifestLabel,
  summarizeBackends,
};
