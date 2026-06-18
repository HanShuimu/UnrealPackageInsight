const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

test('repository instructions forbid adding environment variable dependencies to workflows', () => {
  const instructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');

  assert.match(instructions, /Do not add environment variable dependencies/i);
  assert.match(instructions, /parameters or configuration files/i);
  assert.match(instructions, /Do not read workflow variables from environment variables/i);
});
