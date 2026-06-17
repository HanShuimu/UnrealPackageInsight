const PROTOCOL_VERSION = 1;

function parseVersion(version) {
  return String(version).split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function configurationRank(configuration) {
  return String(configuration).toLowerCase() === 'development' ? 0 : 1;
}

function sortBackendCandidates(manifests) {
  return [...manifests].sort((left, right) => (
    configurationRank(left.configuration) - configurationRank(right.configuration)
    || compareVersions(right.engineVersion, left.engineVersion)
    || left.id.localeCompare(right.id)
  ));
}

function supportsProbe(manifest, probe) {
  if (manifest.protocolVersion !== PROTOCOL_VERSION) {
    return false;
  }
  if (probe.containerType === 'pak') {
    const support = manifest.supports?.pak;
    return Boolean(support)
      && probe.pakFormatVersion >= support.versionMin
      && probe.pakFormatVersion <= support.versionMax;
  }
  if (probe.containerType === 'iostore') {
    const support = manifest.supports?.iostore;
    return Boolean(support)
      && probe.tocFormatVersion >= support.tocVersionMin
      && probe.tocFormatVersion <= support.tocVersionMax;
  }
  return false;
}

function selectBackendCandidates({ probe, manifests }) {
  return sortBackendCandidates(manifests.filter((manifest) => supportsProbe(manifest, probe)));
}

module.exports = {
  PROTOCOL_VERSION,
  compareVersions,
  selectBackendCandidates,
  sortBackendCandidates,
};
