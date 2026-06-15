const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanPackageDirectory } = require('../src/package-scan.js');

function createFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

test('scans supported package containers into deterministic files and tree', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-package-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  createFile(path.join(root, 'Content', 'Paks', 'global.utoc'));
  createFile(path.join(root, 'Content', 'Paks', 'global.ucas'));
  createFile(path.join(root, 'Content', 'Paks', 'pakchunk0-Windows.pak'));
  createFile(path.join(root, 'Engine', 'Binaries', 'Game.exe'));

  const result = await scanPackageDirectory(root);

  assert.equal(result.root, root);
  assert.deepEqual(result.files.map((file) => file.relativePath), [
    'Content\\Paks\\global.ucas',
    'Content\\Paks\\global.utoc',
    'Content\\Paks\\pakchunk0-Windows.pak',
  ]);
  assert.deepEqual(result.files.map((file) => file.kind), ['ucas', 'utoc', 'pak']);
  assert.deepEqual(result.files.map((file) => file.name), [
    'global.ucas',
    'global.utoc',
    'pakchunk0-Windows.pak',
  ]);

  assert.deepEqual(result.tree, {
    name: path.basename(root),
    path: root,
    kind: 'directory',
    children: [
      {
        name: 'Content',
        path: path.join(root, 'Content'),
        kind: 'directory',
        children: [
          {
            name: 'Paks',
            path: path.join(root, 'Content', 'Paks'),
            kind: 'directory',
            children: [
              {
                name: 'global.ucas',
                path: path.join(root, 'Content', 'Paks', 'global.ucas'),
                kind: 'ucas',
                relativePath: 'Content\\Paks\\global.ucas',
              },
              {
                name: 'global.utoc',
                path: path.join(root, 'Content', 'Paks', 'global.utoc'),
                kind: 'utoc',
                relativePath: 'Content\\Paks\\global.utoc',
              },
              {
                name: 'pakchunk0-Windows.pak',
                path: path.join(root, 'Content', 'Paks', 'pakchunk0-Windows.pak'),
                kind: 'pak',
                relativePath: 'Content\\Paks\\pakchunk0-Windows.pak',
              },
            ],
          },
        ],
      },
    ],
  });
});
