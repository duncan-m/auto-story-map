import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = await readFile(join(root, "biome.jsonc"), "utf8");

test("ESM-176: Biome is pinned to an exact version", async () => {
  const { devDependencies, scripts } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.match(devDependencies["@biomejs/biome"], /^\d+\.\d+\.\d+$/);
  assert.equal(scripts.lint, "biome ci");
});

test("ESM-176: the formatter and assist are off, so lint never rewrites a file", () => {
  assert.match(config, /"formatter":\s*\{\s*"enabled":\s*false\s*\}/);
  assert.match(config, /"assist":\s*\{\s*"enabled":\s*false\s*\}/);
});

test("ESM-176: every rule turned off in biome.jsonc has a comment giving its reason", () => {
  const lines = config.split("\n");
  const off = lines.flatMap((line, index) => (/"off"/.test(line) ? [index] : []));
  assert.ok(off.length > 0);
  for (const index of off) {
    // The reason sits on the line just above the rule, or, for a rule inside an override,
    // just above the override's "includes" line, with no other rule in between.
    let at = index - 1;
    if (!lines[at].trim().startsWith("//")) {
      at = lines.slice(0, index).findLastIndex(line => /"includes"/.test(line)) - 1;
      if (lines.slice(at + 2, index).some(line => /":\s*"(off|warn|error|on|info)"/.test(line))) at = -1;
    }
    const above = lines[at];
    assert.ok(above && above.replace(/^\s*\/\/\s*/, "").length >= 20, `line ${index + 1} turns a rule off without a reason`);
  }
});

test("ESM-176: every biome-ignore comment gives its reason", async () => {
  const missing = [];
  for (const folder of ["src", "test", "scripts", "example"]) {
    for (const entry of await readdir(join(root, folder), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx|js|mjs)$/.test(entry.name) || entry.name === "lint-config.test.mjs") continue;
      const file = join(entry.parentPath, entry.name);
      for (const [index, line] of (await readFile(file, "utf8")).split("\n").entries()) {
        const ignore = /biome-ignore(?:-all|-start)?\s+([^\s:]+)(.*)/.exec(line);
        if (ignore && !/^:\s*\S.{10,}/.test(ignore[2])) missing.push(`${file.slice(root.length)}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

/**
 * The most cognitive-complexity warnings Biome may report. Warnings don't fail `npm run lint`,
 * so this ceiling stops new code adding them unnoticed. Lower it when a change removes some.
 * Raise it only when a change can't reasonably split a function, and say why in the PR.
 */
const complexityCeiling = 140;

test("ESM-189: Biome reports no more complexity warnings than the ceiling, and no other warnings", () => {
  const biome = join(root, "node_modules", "@biomejs", "biome", "bin", "biome");
  const run = spawnSync(process.execPath, [biome, "lint", "--reporter=json", "--max-diagnostics=none"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.ok(!run.error && run.stdout.trim(), `Biome did not run: ${run.error?.message ?? run.stderr}`);
  const report = JSON.parse(run.stdout);
  const warnings = report.diagnostics.filter(diagnostic => diagnostic.severity === "warning");
  const other = warnings.filter(diagnostic => diagnostic.category !== "lint/complexity/noExcessiveCognitiveComplexity");
  assert.deepEqual(other.map(diagnostic => `${diagnostic.location.path}:${diagnostic.location.start.line} ${diagnostic.category}`), [], "only complexity is a warning; fix the others or make them errors");
  const complexity = warnings.length - other.length;
  assert.ok(complexity <= complexityCeiling, `Biome reports ${complexity} complexity warnings, over the ceiling of ${complexityCeiling}. Split the functions this change made more complex, which npx biome lint lists.`);
  assert.equal(complexity, complexityCeiling, `Biome reports ${complexity} complexity warnings, under the ceiling of ${complexityCeiling}. Lower complexityCeiling in test/lint-config.test.mjs to ${complexity}.`);
});
