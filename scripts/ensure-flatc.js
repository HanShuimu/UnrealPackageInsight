#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const {
  REQUIRED_FLATC_VERSION,
  getConfiguredFlatc,
  getFlatcVersion,
  getProtocolOutputPaths,
} = require('./generate-protocol.js');

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tools-config') {
      const toolsConfig = argv[index + 1];
      if (!toolsConfig || toolsConfig.startsWith('--')) {
        throw new Error('Missing value for --tools-config');
      }
      parsed.toolsConfig = toolsConfig;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return parsed;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function downloadFile(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirectsLeft <= 0 || !response.headers.location) {
          reject(new Error(`Too many redirects while downloading ${url}.`));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, destination, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed for ${url}: HTTP ${response.statusCode}.`));
        return;
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', (error) => {
        fs.rmSync(destination, { force: true });
        reject(error);
      });
    });

    request.on('error', reject);
  });
}

function getDownloadArchivePath(repoRoot, tool) {
  const archiveName = path.basename(new URL(tool.download.url).pathname);
  return path.join(repoRoot, 'node-shell', '.cache', 'flatc', tool.version, 'downloads', archiveName);
}

function extractZip(archivePath, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  execFileSync('tar', ['-xf', archivePath, '-C', targetDir], { stdio: 'inherit' });
}

async function ensureFlatc({
  repoRoot = getProtocolOutputPaths().repoRoot,
  configPath,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const tool = getConfiguredFlatc({ repoRoot, configPath, platform, arch });
  if (tool.version !== REQUIRED_FLATC_VERSION) {
    throw new Error(`Configured flatc version ${tool.version} does not match required ${REQUIRED_FLATC_VERSION}.`);
  }

  if (fs.existsSync(tool.executable)) {
    const existingVersion = getFlatcVersion(tool.executable);
    if (existingVersion === tool.version) {
      console.log(`[OK] flatc ${existingVersion} already available at ${tool.executable}`);
      return tool;
    }
    console.log(`Replacing flatc ${existingVersion} at ${tool.executable}; expected ${tool.version}.`);
  }

  if (!tool.download?.url || !tool.download?.sha256) {
    throw new Error(`No configured flatc download for ${tool.platformKey}. Add it to tools/protocol-tools.json.`);
  }

  const archivePath = getDownloadArchivePath(repoRoot, tool);
  console.log(`Downloading flatc ${tool.version} from ${tool.download.url}`);
  await downloadFile(tool.download.url, archivePath);

  const actualHash = sha256File(archivePath);
  if (actualHash.toLowerCase() !== tool.download.sha256.toLowerCase()) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(`flatc archive checksum mismatch. Expected ${tool.download.sha256}, got ${actualHash}.`);
  }

  extractZip(archivePath, path.dirname(tool.executable));
  if (!fs.existsSync(tool.executable)) {
    throw new Error(`flatc archive did not produce ${tool.executable}.`);
  }

  const installedVersion = getFlatcVersion(tool.executable);
  if (installedVersion !== tool.version) {
    throw new Error(`Downloaded flatc version ${installedVersion} does not match expected ${tool.version}.`);
  }

  console.log(`[OK] flatc ${installedVersion} ready at ${tool.executable}`);
  return tool;
}

module.exports = {
  downloadFile,
  ensureFlatc,
  extractZip,
  getDownloadArchivePath,
  parseArgs,
  sha256File,
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  ensureFlatc({ configPath: args.toolsConfig }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
