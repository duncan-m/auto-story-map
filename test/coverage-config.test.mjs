import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertFasterThan } from "./fixtures/timing.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(await readFile(new URL("../.c8rc.json", import.meta.url), "utf8"));

test("ESM-177: coverage counts every production module and fails below whole-number floors", () => {
  assert.equal(config.all, true, "modules no test imports must count at 0%");
  assert.deepEqual(config.include, ["src/**"]);
  assert.deepEqual(config.exclude, ["src/version.ts"]);
  assert.equal(config.excludeAfterRemap, true, "include and exclude must match the source-mapped src/ paths");
  assert.equal(config.checkCoverage, true);
  for (const measure of ["lines", "branches", "functions"]) {
    assert.ok(Number.isInteger(config[measure]) && config[measure] > 0 && config[measure] <= 100, `${measure} floor is a whole percentage`);
  }
});

test("ESM-177: the package leaves out the source maps the build writes", async () => {
  const map = JSON.parse(await readFile(new URL("../dist/index.js.map", import.meta.url), "utf8"));
  assert.deepEqual(map.sources, ["../src/index.ts"]);
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(file => file.path);
  assert.ok(files.includes("dist/index.js"));
  assert.deepEqual(files.filter(path => path.endsWith(".map")), []);
});

test("ESM-177: time limits hold without coverage, and only the limit is skipped while V8 collects coverage", () => {
  const started = performance.now() - 50;
  assert.throws(() => assertFasterThan(started, 10, "slow step", { coverage: false }), /slow step: took \d+\.\dms, over 10ms/);
  assert.doesNotThrow(() => assertFasterThan(started, 10, "slow step", { coverage: true }));
  assert.doesNotThrow(() => assertFasterThan(performance.now(), 10_000, "quick step", { coverage: false }));
  // With no option, the helper follows this run: it skips the limit under coverage and enforces it otherwise.
  const byDefault = () => assertFasterThan(started, 10, "slow step");
  if (process.env.NODE_V8_COVERAGE) assert.doesNotThrow(byDefault);
  else assert.throws(byDefault, /slow step/);
});
