const { createBackendClient } = require('./backend-client.js');
const { selectBackendCandidates } = require('./backend-selector.js');

function backendCandidateMetadata(candidate) {
  return {
    id: candidate.id,
    label: `UE ${candidate.engineVersion} ${candidate.configuration}`,
    engineVersion: candidate.engineVersion,
    configuration: candidate.configuration,
  };
}

function createBackendClientProvider({
  manifests,
  koffi,
  backendClientFactory = createBackendClient,
  probeContainerFile,
  selectionStore = new Map(),
}) {
  if (typeof probeContainerFile !== 'function') {
    throw new Error('backend provider requires a probeContainerFile function');
  }
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const clients = new Map();

  function createNoCompatibleBackendError({ message = 'No compatible backend found.', backendId, filePath, probe }) {
    const error = new Error(message);
    error.code = 'backend.no_compatible_backend';
    if (backendId !== undefined) {
      error.backendId = backendId;
    }
    if (filePath !== undefined) {
      error.filePath = filePath;
    }
    if (probe !== undefined) {
      error.probe = probe;
    }
    return error;
  }

  function setSelection(filePath, backendId) {
    selectionStore.set(filePath, backendId);
  }

  function getManifest(id) {
    return byId.get(id) || null;
  }

  function getBackendClient(id, { filePath } = {}) {
    const manifest = byId.get(id);
    if (!manifest) {
      throw createNoCompatibleBackendError({
        message: `No compatible backend found: ${id}`,
        backendId: id,
        filePath,
      });
    }
    if (!clients.has(id)) {
      clients.set(id, backendClientFactory({ dllPath: manifest.dllPath, koffi }));
    }
    return clients.get(id);
  }

  async function resolveForFile(filePath, filePaths = []) {
    const remembered = selectionStore.get(filePath);
    if (remembered) {
      return {
        backendId: remembered,
        client: getBackendClient(remembered, { filePath }),
      };
    }

    const probe = probeContainerFile(filePath, { filePaths });
    const candidates = selectBackendCandidates({ probe, manifests });
    if (candidates.length === 0) {
      throw createNoCompatibleBackendError({ filePath, probe });
    }

    return {
      backendId: candidates[0].id,
      client: getBackendClient(candidates[0].id, { filePath }),
    };
  }

  function getCandidateSelection(filePath, filePaths = []) {
    const probe = probeContainerFile(filePath, { filePaths });
    const candidates = selectBackendCandidates({ probe, manifests });

    return {
      filePath,
      probe,
      candidates: candidates.map(backendCandidateMetadata),
    };
  }

  return {
    setSelection,
    getManifest,
    getBackendClient,
    getCandidateSelection,
    resolveForFile,
  };
}

module.exports = { createBackendClientProvider };
