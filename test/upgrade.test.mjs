import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isUpgradePartBehind,
  knownSetupVersionsFrom,
  stampSetupFile,
  storyMapVersion,
  upgradePartIds,
  upgradeReport,
  workflowCommands,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packaged = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const empty = { agents: {}, guide: {}, workflow: {} };

async function host(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package-lock.json"), "{}");
  await write(root, files);
  return root;
}

async function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
const read = (root, path) => readFile(join(root, path), "utf8");
const byPart = report => Object.fromEntries(report.parts.map(part => [part.part, part]));

/** Every file under the root with its size and modified time, to check nothing was written. */
async function snapshot(root) {
  const files = {};
  for (const name of await readdir(root, { recursive: true })) {
    const info = await stat(join(root, name));
    if (info.isFile()) files[name] = [info.size, info.mtimeMs];
  }
  return files;
}

test("ESM-167: an empty repository reports every part as not added and every choice as not chosen", async t => {
  const root = await host(t);
  const report = await upgradeReport({ root, known: empty });
  assert.equal(report.packageVersion, storyMapVersion);
  assert.deepEqual(report.parts.map(part => part.part), upgradePartIds);
  const parts = byPart(report);
  for (const id of ["agents", "guide", "workflow"]) {
    assert.deepEqual([parts[id].state, parts[id].recommendation, parts[id].kind], ["not-added", "add", "file"], id);
  }
  // The skill is optional while AGENTS.md would hold the full rules.
  assert.deepEqual([parts.skill.state, parts.skill.recommendation], ["not-added", "optional"]);
  for (const id of ["plans", "storyIds"]) assert.deepEqual([parts[id].state, parts[id].recommendation, parts[id].kind], ["not-chosen", "ask", "choice"]);
  assert.equal(report.parts.some(isUpgradePartBehind), false);
});

test("ESM-167: a fresh init is current, and recorded choices are reported as chosen", async t => {
  const root = await host(t);
  assert.equal(run(root, "init", "--dir", root).status, 0);
  const map = await read(root, "product/story-map.yaml");
  // The starter map already has settings, from ESM-186's architectureDecisions.
  await write(root, { "product/story-map.yaml": map.replace("settings:\n", "settings:\n  plans: docs/plans\n  storyIds: lowest-free\n") });

  const parts = byPart(await upgradeReport({ root }));
  for (const id of ["agents", "guide", "workflow"]) {
    assert.deepEqual([parts[id].state, parts[id].from, parts[id].recommendation, parts[id].diff], ["current", storyMapVersion, "keep", undefined], id);
    assert.equal(parts[id].version.matchesRecorded, true);
  }
  assert.deepEqual([parts.plans.state, parts.plans.value], ["chosen", "docs/plans"]);
  assert.deepEqual([parts.storyIds.state, parts.storyIds.value], ["chosen", "lowest-free"]);
});

test("ESM-167: an unedited part from an earlier version is outdated, and an edited one is kept or reviewed", async t => {
  const guide = await packaged("docs/story-map.md");
  const oldGuide = guide.replace("# Using the story map\n", "# Using the story map\n\nAn older paragraph.\n");
  const agents = await packaged("templates/AGENTS.md");
  const oldAgents = agents.replace("## Story map\n", "## Story map\n\nAn older rule.\n");

  // Outdated: stamped by 0.7.5 and never edited since.
  const root = await host(t, {
    "docs/story-map.md": stampSetupFile("guide", oldGuide, "0.7.5"),
    "AGENTS.md": `# House rules\n\n${stampSetupFile("agents", oldAgents, "0.7.5")}`,
  });
  let parts = byPart(await upgradeReport({ root, known: empty }));
  assert.deepEqual([parts.guide.state, parts.guide.from, parts.guide.recommendation], ["outdated", "0.7.5", "replace"]);
  assert.equal(parts.guide.change, `replace with ${storyMapVersion}`);
  assert.match(parts.guide.diff, /^-An older paragraph\.$/m);
  assert.deepEqual([parts.agents.state, parts.agents.from], ["outdated", "0.7.5"]);
  assert.equal(isUpgradePartBehind(parts.guide), true);

  // Edited and outdated: the host edited an old copy, and this version changed the template too.
  await write(root, { "docs/story-map.md": `${stampSetupFile("guide", oldGuide, "0.7.5")}\nOur own note.\n` });
  parts = byPart(await upgradeReport({ root, known: empty }));
  assert.deepEqual([parts.guide.state, parts.guide.from, parts.guide.recommendation], ["edited-outdated", "0.7.5", "review"]);
  assert.match(parts.guide.diff, /^-Our own note\.$/m);
  assert.equal(isUpgradePartBehind(parts.guide), true);

  // Edited: the host edited this version's copy, so there is nothing new to take.
  await write(root, { "docs/story-map.md": `${stampSetupFile("guide", guide, storyMapVersion)}\nOur own note.\n` });
  parts = byPart(await upgradeReport({ root, known: empty }));
  assert.deepEqual([parts.guide.state, parts.guide.from, parts.guide.recommendation], ["edited", storyMapVersion, "keep"]);
  assert.equal(isUpgradePartBehind(parts.guide), false);

  // An unmarked copy that matches no known template is edited, from an unknown version.
  await write(root, { "docs/story-map.md": `${guide}\nOur own note.\n` });
  parts = byPart(await upgradeReport({ root, known: empty }));
  assert.deepEqual([parts.guide.state, parts.guide.from], ["edited-outdated", undefined]);
  assert.match(parts.guide.change, /since an unknown version/);
});

test("ESM-167: unmarked parts from before 0.7.8 are recognised through the known templates", async t => {
  const agents = await packaged("templates/AGENTS.md");
  const oldAgents = agents.replace("## Story map\n", "## Story map\n\nAn older rule.\n");
  const known = knownSetupVersionsFrom([{ part: "agents", version: "0.7.5", text: oldAgents }]);
  const root = await host(t, { "AGENTS.md": oldAgents });
  const { agents: part } = byPart(await upgradeReport({ root, known }));
  assert.deepEqual([part.state, part.from, part.version.knownVersions], ["outdated", "0.7.5", ["0.7.5"]]);
});

test("ESM-167: workflow steps are compared by the commands they run", async t => {
  const template = await packaged("templates/story-map-ci.yml");
  assert.deepEqual([...workflowCommands(template).keys()], ["npm ci --ignore-scripts", "story-map validate", "story-map diff", "story-map pr-check"]);

  // The host's own Node version and an extra --plans flag are edits, but add no step.
  const ours = template.replace("node-version: lts/*", "node-version: 22").replace("--check-sources product", "--check-sources --plans docs/plans product");
  const root = await host(t, { ".github/workflows/story-map.yml": stampSetupFile("workflow", ours, "0.7.5") });
  // Stamped with this edited body, so it reads as an unedited 0.7.5 workflow.
  let { workflow } = byPart(await upgradeReport({ root, known: empty }));
  assert.deepEqual([workflow.state, workflow.additions], ["outdated", undefined]);

  // Edited after it was stamped, with the same steps: kept.
  await write(root, { ".github/workflows/story-map.yml": stampSetupFile("workflow", template, "0.7.5").replace("node-version: lts/*", "node-version: 22") });
  ({ workflow } = byPart(await upgradeReport({ root, known: empty })));
  assert.deepEqual([workflow.state, workflow.recommendation, workflow.additions], ["edited", "keep", undefined]);

  // A host that dropped the summary and pr-check steps and renamed its job is missing both.
  const dropped = stampSetupFile("workflow", template, "0.7.5")
    .replace(/      - name: Summarise story map changes[\s\S]*$/, "")
    .replace("  validate:\n", "  map:\n");
  await write(root, { ".github/workflows/story-map.yml": dropped });
  ({ workflow } = byPart(await upgradeReport({ root, known: empty })));
  assert.deepEqual([workflow.state, workflow.recommendation, workflow.additions], ["edited-outdated", "review", ["story-map diff", "story-map pr-check"]]);
  assert.equal(workflow.change, "add the story-map diff, story-map pr-check steps");
});

test("ESM-167: the skill is needed when AGENTS.md points to it, and reviewed when it differs", async t => {
  const root = await host(t, { "AGENTS.md": stampSetupFile("agents", await packaged("templates/AGENTS-skill.md"), storyMapVersion) });
  let parts = byPart(await upgradeReport({ root, known: empty }));
  assert.equal(parts.agents.state, "current");
  assert.deepEqual([parts.skill.state, parts.skill.recommendation], ["not-added", "add"]);

  await write(root, { ".claude/skills/story-map/SKILL.md": "---\nname: story-map\n---\n\nOur own skill.\n" });
  parts = byPart(await upgradeReport({ root, known: empty }));
  assert.deepEqual([parts.skill.state, parts.skill.recommendation, parts.skill.from], ["edited-outdated", "review", undefined]);
  assert.match(parts.skill.diff, /^-Our own skill\.$/m);
});

test("ESM-167: story-map upgrade prints text, Markdown or JSON and writes nothing", async t => {
  const guide = await packaged("docs/story-map.md");
  const root = await host(t, { "docs/story-map.md": stampSetupFile("guide", `${guide}\nAn older line.\n`, "0.7.5"), "product/story-map.yaml": "version: 1\nsettings:\n  plans: false\n" });
  const before = await snapshot(root);

  const text = run(root, "upgrade");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp(`^Set-up compared with auto-story-map ${storyMapVersion.replaceAll(".", "\\.")}$`, "m"));
  assert.match(text.stdout, /^Guide +outdated, from 0\.7\.5 +replace with /m);
  assert.match(text.stdout, /^AGENTS\.md section +not added +add the story map section$/m);
  assert.match(text.stdout, /^Delivery plans +chosen: false +none; the answer is kept$/m);
  assert.match(text.stdout, /^Story ID policy +not chosen +ask the person/m);
  assert.match(text.stdout, /Run again with --diff/);
  assert.doesNotMatch(text.stdout, /^-An older line\.$/m);
  assert.match(run(root, "upgrade", "--diff").stdout, /^-An older line\.$/m);

  const markdown = run(root, "upgrade", "--format", "markdown");
  assert.equal(markdown.status, 0);
  assert.match(markdown.stdout, /^\| Guide \| outdated, from 0\.7\.5 \| replace with .+ \|$/m);
  assert.match(markdown.stdout, /<details><summary>Guide: from yours to this version's<\/summary>\n\n```diff\n/);

  const json = run(root, "upgrade", "--format", "json");
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.deepEqual([report.format, report.version, report.packageVersion], ["auto-story-map.upgrade", 1, storyMapVersion]);
  const guidePart = report.parts.find(part => part.part === "guide");
  assert.deepEqual([guidePart.state, guidePart.from, guidePart.recommendation], ["outdated", "0.7.5", "replace"]);
  assert.match(guidePart.diff, /^-An older line\.$/m);

  assert.deepEqual(await snapshot(root), before);
  assert.equal(run(root, "upgrade", "--format", "yaml").status, 2);
  assert.match(run(root, "help", "upgrade").stdout, /story-map upgrade \[--format text\|markdown\|json\]/);
});
