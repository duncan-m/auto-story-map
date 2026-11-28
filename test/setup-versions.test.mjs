import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  hasAgentsSection,
  knownSetupVersionsFrom,
  loadKnownSetupVersions,
  readSetupFileVersion,
  setupBody,
  setupBodyHash,
  setupParts,
  stampSetupFile,
  storyMapVersion,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packageRoot = new URL("../", import.meta.url);
const packaged = path => readFile(new URL(path, packageRoot), "utf8");
const hashPattern = /sha256:[0-9a-f]{64}/;

async function host(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package-lock.json"), "{}");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const init = (root, ...args) => spawnSync(process.execPath, [cli, "init", "--dir", root, ...args], { encoding: "utf8" });
const read = (root, path) => readFile(join(root, path), "utf8");

test("ESM-166: init records the package version and template hash in each part", async t => {
  const root = await host(t, { "AGENTS.md": "# House rules\n", "test/a.test.js": "" });
  assert.equal(init(root).status, 0);

  const agents = await read(root, "AGENTS.md");
  const guide = await read(root, "docs/story-map.md");
  const workflow = await read(root, ".github/workflows/story-map.yml");
  assert.match(agents, new RegExp(`<!-- auto-story-map:start ${storyMapVersion.replaceAll(".", "\\.")} sha256:[0-9a-f]{64} -->\n## Story map\n`));
  assert.match(guide.split("\n")[0], new RegExp(`^<!-- auto-story-map ${storyMapVersion.replaceAll(".", "\\.")} sha256:[0-9a-f]{64} -->$`));
  assert.match(workflow.split("\n")[0], new RegExp(`^# auto-story-map ${storyMapVersion.replaceAll(".", "\\.")} sha256:[0-9a-f]{64}$`));

  // The hash covers the body as written, so the workflow's --tests line is included.
  assert.match(workflow, /--tests test /);
  assert.equal(guide.slice(guide.indexOf("\n") + 1), await packaged("docs/story-map.md"));

  for (const [part, text] of [["agents", agents], ["guide", guide], ["workflow", workflow]]) {
    const version = readSetupFileVersion(part, text);
    assert.equal(version.recordedVersion, storyMapVersion, part);
    assert.equal(version.recordedHash, version.hash, part);
    assert.match(version.hash, hashPattern);
    assert.equal(version.matchesRecorded, true, part);
    assert.equal(version.unedited, true, part);
    assert.equal(version.from, storyMapVersion, part);
    assert.deepEqual(version.knownVersions, []);
  }

  // Running init again hands over to the upgrade review, which finds every stamped part current and writes nothing.
  const again = init(root);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /^This repository is already set up, so init hands over to story-map upgrade\./);
  assert.match(again.stdout, /^AGENTS\.md section +current, from /m);
  assert.match(again.stdout, /^Guide +current, from /m);
  assert.equal(await read(root, "AGENTS.md"), agents);
  assert.equal(await read(root, "docs/story-map.md"), guide);
});

test("ESM-166: an edit to a part's body no longer matches its recorded hash", async t => {
  const root = await host(t, { "AGENTS.md": "# House rules\n" });
  assert.equal(init(root).status, 0);
  const agents = await read(root, "AGENTS.md");
  const guide = await read(root, "docs/story-map.md");
  const workflow = await read(root, ".github/workflows/story-map.yml");

  // Text outside the AGENTS.md section is the host's own and does not count.
  assert.equal(readSetupFileVersion("agents", `${agents}\n## More house rules\n`).unedited, true);
  assert.equal(readSetupFileVersion("agents", agents.replace("# House rules", "# Our rules")).unedited, true);

  const edited = [
    ["agents", agents.replace("## Story map\n", "## Story map\n\nOur own rule.\n")],
    ["guide", `${guide}\nOur own note.\n`],
    ["workflow", workflow.replace("node-version: lts/*", "node-version: 22")],
  ];
  for (const [part, text] of edited) {
    const version = readSetupFileVersion(part, text);
    assert.equal(version.matchesRecorded, false, part);
    assert.equal(version.unedited, false, part);
    assert.equal(version.from, storyMapVersion, part);
    assert.notEqual(version.hash, version.recordedHash);
  }

  // Line endings do not count as an edit.
  assert.equal(readSetupFileVersion("guide", guide.replaceAll("\n", "\r\n")).unedited, true);
  assert.equal(readSetupFileVersion("agents", agents.replaceAll("\n", "\r\n")).unedited, true);
});

test("ESM-166: unmarked parts from earlier releases are recognised by their known template", async () => {
  const workflow = await packaged("templates/story-map-ci.yml");
  const agents = await packaged("templates/AGENTS.md");
  const known = knownSetupVersionsFrom([
    { part: "workflow", version: "0.7.5", text: workflow },
    { part: "workflow", version: "0.7.4", text: workflow },
    { part: "agents", version: "0.7.5", text: agents },
  ]);

  const old = readSetupFileVersion("workflow", workflow, known);
  assert.equal(old.recordedVersion, undefined);
  assert.equal(old.recordedHash, undefined);
  assert.equal(old.matchesRecorded, false);
  assert.deepEqual(old.knownVersions, ["0.7.4", "0.7.5"]);
  assert.equal(old.unedited, true);
  assert.equal(old.from, "0.7.5");

  // The plain marker from before 0.7.11 still opens the section.
  const host = readSetupFileVersion("agents", `# House rules\n\n${agents}`, known);
  assert.deepEqual([host.unedited, host.from, host.recordedVersion], [true, "0.7.5", undefined]);

  // An unmarked part that matches no known template is edited, from an unknown version.
  const unknown = readSetupFileVersion("workflow", `${workflow}# ours\n`, known);
  assert.deepEqual([unknown.unedited, unknown.from, unknown.knownVersions], [false, undefined, []]);

  // Without the known versions, only a recorded hash counts.
  assert.equal(readSetupFileVersion("workflow", workflow).unedited, false);

  // An AGENTS.md without a complete section has nothing to read.
  assert.equal(readSetupFileVersion("agents", "# House rules\n"), undefined);
  assert.equal(readSetupFileVersion("agents", "<!-- auto-story-map:start -->\n## Story map\n"), undefined);
});

test("ESM-166: init and validate keep working for hosts set up without versions", async t => {
  const guide = await packaged("docs/story-map.md");
  const agents = await packaged("templates/AGENTS.md");
  const map = (await packaged("templates/story-map.yaml")).replace("__ID__", "old-host").replace("__TITLE__", "Old Host Story Map");
  const root = await host(t, {
    "AGENTS.md": `# House rules\n\n${agents}`,
    "docs/story-map.md": guide,
    "product/story-map.yaml": map,
  });

  const run = init(root, "--no-ci");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /hands over to story-map upgrade/);
  assert.match(run.stdout, /^AGENTS\.md section +current/m);
  assert.match(run.stdout, /^Guide +current/m);
  assert.equal(await read(root, "AGENTS.md"), `# House rules\n\n${agents}`);
  assert.equal(await read(root, "docs/story-map.md"), guide);

  const validate = spawnSync(process.execPath, [cli, "validate", "--check-sources", "--strict", join(root, "product/story-map.yaml")], { encoding: "utf8", cwd: root });
  assert.equal(validate.status, 0, validate.stderr);

  // An edited, unmarked section is still reported, not replaced.
  await writeFile(join(root, "AGENTS.md"), `# House rules\n\n${agents.replace("## Story map\n", "## Story map\n\nOur own rule.\n")}`);
  assert.match(init(root, "--no-ci").stdout, /^AGENTS\.md section +edited/m);
  assert.match(await read(root, "AGENTS.md"), /Our own rule\./);

  // A stamped guide passes the same checks, heading links included.
  const stamped = await host(t);
  assert.equal(init(stamped).status, 0);
  const starter = await read(stamped, "product/story-map.yaml");
  const linked = starter.replace("stories: []", "stories:\n  - id: HOST-1\n    title: Read the set-up markers\n    activity: first-step\n    release: unassigned\n    status: planned\n    sources:\n      - docs/story-map.md#what-the-set-up-markers-mean\n");
  assert.notEqual(linked, starter);
  await writeFile(join(stamped, "product/story-map.yaml"), linked);
  const checked = spawnSync(process.execPath, [cli, "validate", "--check-sources", join(stamped, "product/story-map.yaml")], { encoding: "utf8", cwd: stamped });
  assert.equal(checked.status, 0, checked.stderr);
  const broken = linked.replace("#what-the-set-up-markers-mean", "#no-such-heading");
  await writeFile(join(stamped, "product/story-map.yaml"), broken);
  assert.notEqual(spawnSync(process.execPath, [cli, "validate", "--check-sources", join(stamped, "product/story-map.yaml")], { cwd: stamped }).status, 0);
});

test("ESM-166: stamping replaces an earlier marker and keeps the body", async () => {
  const guide = await packaged("docs/story-map.md");
  const once = stampSetupFile("guide", guide, "0.7.8");
  const twice = stampSetupFile("guide", once, "0.7.9");
  assert.equal(setupBody("guide", twice), guide);
  assert.match(twice, /^<!-- auto-story-map 0\.7\.9 sha256:[0-9a-f]{64} -->\n# Using the story map\n/);
  assert.equal(readSetupFileVersion("guide", twice).from, "0.7.9");

  const agents = stampSetupFile("agents", await packaged("templates/AGENTS.md"), "0.7.8");
  assert.equal(stampSetupFile("agents", agents, "0.7.8"), agents);
  assert.ok(hasAgentsSection(agents));
  assert.ok(hasAgentsSection("<!-- auto-story-map:start -->"));
  assert.ok(!hasAgentsSection("<!-- embedded-story-map:start -->"));
  assert.throws(() => stampSetupFile("agents", "# no section\n", "0.7.8"), /no complete story map section/);
  assert.equal(setupBodyHash("a\r\nb"), setupBodyHash("a\nb"));
});

test("ESM-166: known versions group shared templates and sort versions numerically", () => {
  const known = knownSetupVersionsFrom([
    { part: "guide", version: "0.10.0", text: "# Guide\n" },
    { part: "guide", version: "0.9.0", text: "# Guide\n" },
    { part: "guide", version: "0.9.0", text: "# Guide\n" },
    { part: "guide", version: "0.2.0", text: "# Old guide\n" },
    { part: "agents", version: "0.1.0", text: "<!-- embedded-story-map:start -->\n## Story map\n<!-- embedded-story-map:end -->\n" },
  ]);
  assert.deepEqual(Object.values(known.guide), [["0.2.0"], ["0.9.0", "0.10.0"]]);
  assert.deepEqual(Object.keys(known.guide), [setupBodyHash("# Old guide\n"), setupBodyHash("# Guide\n")]);
  assert.deepEqual(known.agents, {});
  assert.deepEqual(known.workflow, {});
});

test("ESM-166: the package ships the hashes of earlier release templates", async () => {
  const known = await loadKnownSetupVersions();
  const file = JSON.parse(await packaged("templates/known-versions.json"));
  assert.match(file.$comment, /scripts\/known-versions\.mjs/);
  assert.deepEqual(Object.keys(known), [...setupParts, "rules"]);
  for (const part of setupParts) {
    assert.ok(Object.keys(known[part]).length > 0, part);
    for (const [hash, versions] of Object.entries(known[part])) {
      assert.match(hash, new RegExp(`^${hashPattern.source}$`));
      assert.ok(versions.length > 0 && versions.every(version => /^\d+\.\d+\.\d+$/.test(version)), part);
    }
  }

  // Where the release tags are available, each part's template at v0.7.6 is listed under 0.7.6.
  const show = path => spawnSync("git", ["show", `v0.7.6:${path}`], { cwd: packageRoot, encoding: "utf8" });
  const tagged = { agents: show("templates/AGENTS.md"), guide: show("docs/story-map.md"), workflow: show("templates/story-map-ci.yml") };
  if (Object.values(tagged).some(result => result.status !== 0)) return;
  for (const [part, result] of Object.entries(tagged)) {
    const version = readSetupFileVersion(part, result.stdout, known);
    assert.equal(version.unedited, true, part);
    assert.ok(version.knownVersions.includes("0.7.6"), part);
  }
});
