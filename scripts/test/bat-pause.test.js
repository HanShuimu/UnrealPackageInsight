const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function listTrackedBatchFiles() {
  return execFileSync("git", ["ls-files", "*.bat"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

function findExitPathViolations(content) {
  const lines = content.split(/\r?\n/);
  const violations = [];
  let sawPauseInCurrentSection = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim().toLowerCase();

    if (trimmed.startsWith(":")) {
      sawPauseInCurrentSection = false;
      return;
    }

    if (trimmed === "pause") {
      sawPauseInCurrentSection = true;
      return;
    }

    if (/^exit\s+\/b\b/.test(trimmed) && !sawPauseInCurrentSection) {
      violations.push(index + 1);
    }
  });

  return violations;
}

test("all tracked batch-file exit paths pause before exiting", () => {
  const batchFiles = listTrackedBatchFiles();
  assert.ok(batchFiles.length > 0, "expected tracked .bat files");

  const failures = [];
  for (const batchFile of batchFiles) {
    const content = fs.readFileSync(path.resolve(batchFile), "utf8");
    const violations = findExitPathViolations(content);
    if (violations.length > 0) {
      failures.push(`${batchFile}: exit /b without pause at line(s) ${violations.join(", ")}`);
    }
  }

  assert.deepEqual(failures, []);
});
