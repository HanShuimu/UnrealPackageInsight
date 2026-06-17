const { createBackendClient } = require('./backend-client.js');
const { selectBackendCandidates } = require('./backend-selector.js');

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
  return {
    setSelection(filePath, backendId) {
      selectionStore.set(filePath, backendId);
    },
    getManifest(id) {
      return byId.get(id) || null;
    },
    getBackendClient(id) {
      const manifest = byId.get(id);
      if (!manifest) {
        throw new Error(`backend.no_compatible_backend: ${id}`);
      }
      if (!clients.has(id)) {
        clients.set(id, backendClientFactory({ dllPath: manifest.dllPath, koffi }));
      }
      return clients.get(id);
    },
    async resolveForFile(filePath, filePaths = []) {
      const remembered = selectionStore.get(filePath);
      if (remembered) {
        return {
          backendId: remembered,
          client: this.getBackendClient(remembered),
        };
      }

      const probe = probeContainerFile(filePath, { filePaths });
      const candidates = selectBackendCandidates({ probe, manifests });
      if (candidates.length === 0) {
        const error = new Error('No compatible backend found.');
        error.code = 'backend.no_compatible_backend';
        error.probe = probe;
        throw error;
      }
      if (candidates.length > 1) {
        const error = new Error('Multiple compatible backends found.');
        error.code = 'backend.multiple_candidates';
        error.probe = probe;
        error.candidates = candidates.map((candidate) => ({
          id: candidate.id,
          label: `UE ${candidate.engineVersion} ${candidate.configuration}`,
        }));
        error.filePath = filePath;
        throw error;
      }
      return {
        backendId: candidates[0].id,
        client: this.getBackendClient(candidates[0].id),
      };
    },
  };
}

module.exports = { createBackendClientProvider };
