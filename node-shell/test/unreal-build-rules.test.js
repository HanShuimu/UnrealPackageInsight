const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const buildRulesPath = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'UnrealPackageInsightBackend.Build.cs',
);

test('Unreal Build.cs uses Program-local generated protocol includes only', () => {
  const source = fs.readFileSync(buildRulesPath, 'utf8');
  const forbiddenSnippets = [
    ['UPI', '_REPO', '_ROOT'].join(''),
    [
      'Path.Combine("node-shell", "packages", "protocol", ',
      '"generated", "cpp")',
    ].join(''),
    ['FindGeneratedCpp', 'IncludePath'].join(''),
    ['Directory', '.GetCurrentDirectory()'].join(''),
  ];

  for (const snippet of forbiddenSnippets) {
    assert.equal(source.includes(snippet), false);
  }

  assert.match(source, /Path\.Combine\(ModuleDirectory,\s*"Generated",\s*"Protocol"\)/);
});
