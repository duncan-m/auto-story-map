import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import {
  checkStoryMap,
  currentSetupTemplateHashes,
  findSetupBehind,
  isSetupPartBehind,
  readSetupFileVersion,
  setupBehindMessage,
  setupBodyHash,
  storyMapVersion,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const oldHash = `sha256:${"0".repeat(64)}`;

/** A small valid map with no warnings and the delivery plans choice made, so only the set-up notice can appear. */
const map = stringify({
  version: 1,
  id: "behind",
  title: "Behind",
  settings: { plans: false },
  activities: [{ id: "prepare", title: "Prepare" }],
  releases: [{ id: "r1", title: "First", impact: [{ metric: "Quotes", expected: "More quotes", solves: "Slow pricing" }] }],
  stories: [{ id: "S-1", title: "Price a quote", activity: "prepare", release: "r1", status: "planned" }],
});

/** Marked parts from an older version, whose recorded template is not one this version writes. */
const oldAgents = `# House rules\n\n<!-- auto-story-map:start 0.7.5 ${oldHash} -->\n## Story map\n\nOld rules.\n<!-- auto-story-map:end -->\n`;
const oldGuide = `<!-- auto-story-map 0.7.4 ${oldHash} -->\n# Using the story map\n`;
const oldWorkflow = `# auto-story-map 0.7.5 ${oldHash}\nname: Story map\n`;

async function host(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-behind-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"), { recursive: true });
  await writeFile(join(root, "product", "story-map.yaml"), map);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const notices = async root => (await checkStoryMap(map, { root })).issues.filter(issue => issue.rule === "setup-behind");
const validate = (root, ...args) => spawnSync(process.execPath, [cli, "validate", ...args, "product/story-map.yaml"], { cwd: root, encoding: "utf8" });

test("ESM-172: validate prints one notice naming every part that is behind, pointing to story-map upgrade", async t => {
  const root = await host(t, { "AGENTS.md": oldAgents, "docs/story-map.md": oldGuide, ".github/workflows/story-map.yml": oldWorkflow });
  const result = await checkStoryMap(map, { root, strict: true });
  const found = result.issues.filter(issue => issue.rule === "setup-behind");
  assert.equal(found.length, 1, "one notice, not one per part");
  assert.equal(result.notices, 1);
  assert.equal(found[0].severity, "notice");
  assert.equal(result.valid, true, "a notice never fails, even with --strict");
  assert.equal(
    found[0].message,
    `This repository's set-up is from 0.7.4 and 0.7.5, and the package is ${storyMapVersion}, which changes the story map section of AGENTS.md (from 0.7.5), docs/story-map.md (from 0.7.4) and .github/workflows/story-map.yml (from 0.7.5). Run \`story-map upgrade\` to see what changes.`,
  );
  // The host's guide is an old one without the heading, so the link goes to the packaged guide.
  assert.equal(found[0].help, `https://github.com/duncan-m/auto-story-map/blob/v${storyMapVersion}/docs/story-map.md#what-the-set-up-markers-mean`);
});

test("ESM-172: the notice names one version when every part came from it", () => {
  const behind = [{ part: "agents", path: "AGENTS.md", from: "0.7.5" }, { part: "guide", path: "docs/story-map.md", from: "0.7.5" }];
  assert.equal(
    setupBehindMessage(behind, "0.7.8"),
    "This repository's set-up is from 0.7.5, and the package is 0.7.8, which changes the story map section of AGENTS.md and docs/story-map.md. Run `story-map upgrade` to see what changes.",
  );
});

test("ESM-172: validate prints the notice once in text, GitHub and JSON output, and never fails with --strict", async t => {
  const root = await host(t, { "AGENTS.md": oldAgents, "docs/story-map.md": oldGuide });
  const text = validate(root, "--strict");
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stderr.match(/setup-behind/g)?.length, 1, text.stderr);
  assert.match(text.stderr, /^product\/story-map\.yaml: notice: This repository's set-up is from 0\.7\.4 and 0\.7\.5,.* \[setup-behind\]\n {2}help: /);
  assert.match(text.stdout, /valid \(.*\), 1 notice\n/);
  const github = validate(root, "--format", "github", "--strict");
  assert.equal(github.status, 0);
  assert.match(github.stdout, /^::notice file=product\/story-map\.yaml,title=setup-behind::This repository's set-up is from/m);
  const json = JSON.parse(validate(root, "--format", "json").stdout);
  assert.equal(json.valid, true);
  assert.deepEqual(json.maps[0].issues.map(issue => issue.rule), ["setup-behind"]);
});

test("ESM-172: no notice when the set-up is current, just installed or missing", async t => {
  assert.deepEqual(await notices(await host(t)), [], "missing parts");
  const root = await host(t, { "AGENTS.md": "# House rules\n", "package-lock.json": "{}", "test/a.test.js": "" });
  assert.equal(spawnSync(process.execPath, [cli, "init", "--dir", root], { encoding: "utf8" }).status, 0);
  assert.deepEqual(await notices(root), [], "parts init just wrote");
  const skill = await host(t, { "package-lock.json": "{}" });
  assert.equal(spawnSync(process.execPath, [cli, "init", "--skill", "--dir", skill], { encoding: "utf8" }).status, 0);
  assert.deepEqual(await notices(skill), [], "the skill form of the AGENTS.md section");
  // An AGENTS.md without the story map section has nothing to compare.
  assert.deepEqual(await notices(await host(t, { "AGENTS.md": "# House rules\n" })), []);
});

test("ESM-172: an older part whose template has not changed since, even if edited, gets no notice", async t => {
  const current = await currentSetupTemplateHashes();
  const [guideHash] = current.guide;
  const guide = await readFile(join(repoRoot, "docs", "story-map.md"), "utf8");
  // Recorded from an older version, but the template it recorded is still this version's: the edit is the host's own.
  const edited = `<!-- auto-story-map 0.7.0 ${guideHash} -->\n${guide}\nOur own notes.\n`;
  assert.deepEqual(await notices(await host(t, { "docs/story-map.md": edited })), []);
  // A part from this version, or a newer one, is never behind.
  const newer = `<!-- auto-story-map 99.0.0 ${oldHash} -->\nold\n`;
  assert.deepEqual(await notices(await host(t, { "docs/story-map.md": newer })), []);
});

test("ESM-172: unmarked parts from before 0.7.11 count only when they match a known template that has changed", async t => {
  const old = "# Using the story map\n\nAn old guide.\n";
  const current = await currentSetupTemplateHashes();
  const known = { agents: {}, guide: { [setupBodyHash(old)]: ["0.7.0", "0.7.1"] }, workflow: {} };
  const root = await host(t, { "docs/story-map.md": old });
  assert.deepEqual(await findSetupBehind(root, { known }), [{ part: "guide", path: "docs/story-map.md", from: "0.7.1" }]);
  // The same file, when its template is still this version's, is not behind.
  assert.deepEqual(await findSetupBehind(root, { known, current: { ...current, guide: new Set([setupBodyHash(old)]) } }), []);
  // An unmarked part that matches no known template is from an unknown version, so it gets no notice.
  assert.deepEqual(await findSetupBehind(root, { known: { agents: {}, guide: {}, workflow: {} } }), []);
  // An unmarked copy of this version's guide that matches an old release's template is not behind either.
  const guide = await readFile(join(repoRoot, "docs", "story-map.md"), "utf8");
  const version = readSetupFileVersion("guide", guide, { agents: {}, guide: { [setupBodyHash(guide)]: ["0.7.0"] }, workflow: {} });
  assert.equal(version.from, "0.7.0");
  assert.equal(isSetupPartBehind(version, current.guide), false);
});

test("ESM-172: this repository's own files do not trigger the notice", async () => {
  assert.deepEqual(await findSetupBehind(repoRoot), []);
  assert.deepEqual((await checkStoryMap(await readFile(join(repoRoot, "product", "story-map.yaml"), "utf8"), { root: repoRoot })).issues.filter(issue => issue.rule === "setup-behind"), []);
});
