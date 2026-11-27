import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { stampSetupFile } from "../dist/setup-versions.js";
import { storyMapVersion } from "../dist/version.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
// Standard input is a pipe, not a terminal, as it is for agents, so init never asks.
const init = (root, ...args) => spawnSync(process.execPath, [cli, "init", "--dir", root, ...args], { encoding: "utf8" });
const exists = path => access(path).then(() => true, () => false);

async function host(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-init-parts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return root;
}

/** The Change column of the parts table, by part title. */
function partsTable(stdout) {
  const rows = {};
  const table = stdout.slice(stdout.indexOf("\nPart "), stdout.indexOf("\n\n", stdout.indexOf("\nPart ")));
  for (const line of table.split("\n").slice(2)) {
    const [title, state, change] = line.split(/ {2,}/);
    rows[title] = { state, change };
  }
  return rows;
}

test("ESM-171: init prints the install overview and the parts, all not added, then adds the recommended set", async t => {
  const root = await host(t, { "package-lock.json": "{}" });
  const run = init(root);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^How Auto Story Map works in this repository\n\n- /);
  assert.match(run.stdout, new RegExp(`\\nParts of the set-up, from auto-story-map ${storyMapVersion.replaceAll(".", "\\.")}\\n`));
  const parts = partsTable(run.stdout);
  for (const title of ["AGENTS.md section", "Guide", "CI workflow", "Story map skill"]) assert.equal(parts[title].state, "not added", title);
  for (const title of ["AGENTS.md section", "Guide", "CI workflow"]) assert.equal(parts[title].change, "add", title);
  assert.equal(parts["Story map skill"].change, "not added; add it with --skill");
  for (const title of ["Delivery plans", "Story ID policy"]) assert.deepEqual(parts[title], { state: "not chosen", change: "ask the person; not now leaves it unset" });

  // The overview and the parts come before anything is written.
  assert.ok(run.stdout.indexOf("Parts of the set-up") < run.stdout.indexOf("created  product/story-map.yaml"));
  for (const path of ["product/story-map.yaml", "docs/story-map.md", "AGENTS.md", ".github/workflows/story-map.yml"]) {
    assert.match(run.stdout, new RegExp(`^created  ${path.replaceAll(".", "\\.")}$`, "m"));
    assert.ok(await exists(join(root, path)), path);
  }
  assert.equal(await exists(join(root, ".claude/skills/story-map/SKILL.md")), false);
  assert.match(run.stdout, /^ask      story ID policy \(not chosen yet; see docs\/story-map\.md#change-the-map-from-the-command-line\)$/m);
});

test("ESM-171: --no-ci leaves out the workflow and --skill adds the skill, in the parts list too", async t => {
  const root = await host(t, { "package-lock.json": "{}" });
  const run = init(root, "--no-ci", "--skill");
  assert.equal(run.status, 0, run.stderr);
  const parts = partsTable(run.stdout);
  assert.equal(parts["CI workflow"].change, "left out (--no-ci)");
  assert.equal(parts["Story map skill"].change, "add, with a short pointer in AGENTS.md");
  assert.equal(await exists(join(root, ".github/workflows/story-map.yml")), false);
  assert.ok(await exists(join(root, ".claude/skills/story-map/SKILL.md")));
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /\[story map skill\]\(\.claude\/skills\/story-map\/SKILL\.md\)/);
});

test("ESM-171: advanced mode adds only the parts the person chooses", async t => {
  // Without --apply, and with nobody at a terminal, it lists the parts and writes nothing.
  const empty = await host(t, { "package-lock.json": "{}" });
  const listed = init(empty, "--mode", "advanced");
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^How Auto Story Map works in this repository/);
  assert.equal(partsTable(listed.stdout)["Story map skill"].change, "optional; add it with --apply skill");
  assert.match(listed.stdout, /Nothing was written\. To add the parts you choose, run init again with --apply <parts>, such as --apply agents,guide,workflow\.\n$/);
  assert.deepEqual(await readdir(empty), ["package-lock.json"]);

  // --apply picks the parts, and implies advanced mode. The map is always added.
  const root = await host(t, { "package-lock.json": "{}" });
  const run = init(root, "--apply", "guide,skill");
  assert.equal(run.status, 0, run.stderr);
  const parts = partsTable(run.stdout);
  assert.equal(parts["AGENTS.md section"].change, "not added (not chosen)");
  assert.equal(parts["CI workflow"].change, "not added (not chosen)");
  assert.equal(parts.Guide.change, "add");
  assert.equal(parts["Story map skill"].change, "add, with a short pointer in AGENTS.md");
  for (const path of ["product/story-map.yaml", "docs/story-map.md", ".claude/skills/story-map/SKILL.md"]) assert.ok(await exists(join(root, path)), path);
  for (const path of ["AGENTS.md", ".github/workflows/story-map.yml"]) assert.equal(await exists(join(root, path)), false, path);
  assert.doesNotMatch(run.stdout, /AGENTS\.md \(|created  AGENTS\.md/);
});

test("ESM-171: init records only the answers the person gave, and asks the rest", async t => {
  const root = await host(t);
  const run = init(root, "--no-ci", "--plans", "docs/plans", "--story-ids", "lowest-free");
  assert.equal(run.status, 0, run.stderr);
  const parts = partsTable(run.stdout);
  assert.equal(parts["Delivery plans"].change, 'record "docs/plans"');
  assert.equal(parts["Story ID policy"].change, 'record "lowest-free"');
  assert.match(run.stdout, /^recorded delivery plans \(settings\.plans: "docs\/plans"\)$/m);
  assert.match(run.stdout, /^recorded story id policy \(settings\.storyIds: "lowest-free"\)$/m);
  assert.doesNotMatch(run.stdout, /^ask /m);
  assert.doesNotMatch(run.stdout, /Then ask me/);
  const map = parse(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  assert.deepEqual(map.settings, { plans: "docs/plans", storyIds: "lowest-free" });
  const validate = spawnSync(process.execPath, [cli, "validate", join(root, "product/story-map.yaml")], { encoding: "utf8" });
  assert.equal(validate.status, 0, validate.stderr);

  // Without answers, nothing is recorded, and both choices are left for the person.
  const plain = await host(t);
  assert.equal(init(plain, "--no-ci").status, 0);
  assert.equal(parse(await readFile(join(plain, "product/story-map.yaml"), "utf8")).settings, undefined);
});

test("ESM-171: init on a host that is already set up hands over to story-map upgrade and writes nothing", async t => {
  const root = await host(t, { "package-lock.json": "{}" });
  assert.equal(init(root).status, 0);
  // An unedited guide from an earlier version.
  const old = stampSetupFile("guide", "# Using the story map\n\nAn old guide.\n", "0.7.0");
  await writeFile(join(root, "docs/story-map.md"), old);
  const before = await Promise.all(["AGENTS.md", "product/story-map.yaml", ".github/workflows/story-map.yml"].map(path => readFile(join(root, path), "utf8")));

  const report = init(root);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^This repository is already set up, so init hands over to story-map upgrade\.\n\nWhat changes for you since 0\.7\.0\n/);
  assert.match(report.stdout, /\nSet-up compared with auto-story-map /);
  assert.match(report.stdout, /^Guide +outdated, from 0\.7\.0/m);
  assert.doesNotMatch(report.stdout, /^(created|updated|skipped) /m);
  assert.match(report.stdout, /\nTo apply the changes, run story-map upgrade --mode simple --write, or --apply <parts> --write for only the parts you accept\.\n$/);

  // The mode, parts and answers go with it, as a dry run.
  const simple = init(root, "--mode", "simple", "--plans", "off");
  assert.equal(simple.status, 0, simple.stderr);
  assert.match(simple.stdout, /^Guide +replace +replace with /m);
  assert.match(simple.stdout, /^Delivery plans +record +record false in settings\.plans$/m);
  assert.match(simple.stdout, /To apply the changes, run story-map upgrade --mode simple --plans off --write, or --apply <parts> --write/);
  const advanced = init(root, "--apply", "guide");
  assert.match(advanced.stdout, /To apply the changes, run story-map upgrade --apply guide --write\.\n$/);

  assert.equal(await readFile(join(root, "docs/story-map.md"), "utf8"), old);
  const after = await Promise.all(["AGENTS.md", "product/story-map.yaml", ".github/workflows/story-map.yml"].map(path => readFile(join(root, path), "utf8")));
  assert.deepEqual(after, before);

  // Once everything is current, the hand-over says so and suggests nothing.
  const current = await host(t, { "package-lock.json": "{}" });
  assert.equal(init(current).status, 0);
  const again = init(current);
  assert.match(again.stdout, /Nothing was changed\.\n$/);
  assert.doesNotMatch(again.stdout, /To apply the changes/);
});

test("ESM-171: init takes its mode from settings.upgrade in an existing map", async t => {
  const root = await host(t);
  assert.equal(init(root, "--apply", "guide").status, 0);
  // Only the map and the guide are there. Recording advanced mode and removing the guide leaves a host with nothing set up.
  const mapPath = join(root, "product/story-map.yaml");
  await writeFile(mapPath, (await readFile(mapPath, "utf8")).replace("visibility: internal\n", "visibility: internal\nsettings:\n  upgrade: advanced\n"));
  await rm(join(root, "docs"), { recursive: true });
  const run = init(root);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Nothing was written\. To add the parts you choose, run init again with --apply <parts>/);
  assert.equal(await exists(join(root, "AGENTS.md")), false);
  // --mode overrides it for one run.
  const simple = init(root, "--mode", "simple");
  assert.equal(simple.status, 0, simple.stderr);
  assert.ok(await exists(join(root, "AGENTS.md")));
});

test("ESM-171: init refuses options that disagree", async t => {
  const root = await host(t);
  for (const args of [["--mode", "simple", "--apply", "guide"], ["--no-ci", "--apply", "workflow"], ["--mode", "fancy"], ["--apply", "nothing"], ["--story-ids", "random"]]) {
    const run = init(root, ...args);
    assert.equal(run.status, 2, args.join(" "));
  }
  assert.deepEqual(await readdir(root), []);
});
