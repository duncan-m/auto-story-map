import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  addWorkflowSteps,
  applyUpgrade,
  findSetupBehind,
  knownSetupVersionsFrom,
  mergeAgentsSection,
  readSetupFileVersion,
  replaceAgentsSection,
  setupBody,
  setupBodyHash,
  stampSetupFile,
  storyMapVersion,
  templateRules,
  upgradeReport,
  workflowCommands,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/upgrade-0.7.5", import.meta.url));
const packaged = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const empty = { agents: {}, guide: {}, workflow: {} };
const version = storyMapVersion.replaceAll(".", "\\.");

const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
const read = (root, path) => readFile(join(root, path), "utf8");
const byPart = report => Object.fromEntries(report.parts.map(part => [part.part, part]));
const byChange = result => Object.fromEntries(result.changes.map(change => [change.part, change]));
const marker = id => `<!-- rule: ${id} -->\n`;
const replaceRule = (text, id, replacement) => text.replace(new RegExp(`${marker(id)}[^\\n]+\\n`), replacement);
const ruleText = (text, id) => new RegExp(`${marker(id)}([^\\n]+)\\n`).exec(text)[1];

async function host(t, files = {}, from) {
  const root = await mkdtemp(join(tmpdir(), "story-map-apply-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (from) await cp(from, root, { recursive: true });
  else await writeFile(join(root, "package-lock.json"), "{}");
  await write(root, files);
  return root;
}

async function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** Every file under the root with its contents and modified time, to check nothing was written. */
async function snapshot(root) {
  const files = {};
  for (const name of await readdir(root, { recursive: true })) {
    const info = await stat(join(root, name));
    if (info.isFile()) files[name] = [await readFile(join(root, name), "utf8"), info.mtimeMs];
  }
  return files;
}

test("ESM-169: simple mode upgrades a host set up from 0.7.5, and a second run changes nothing", async t => {
  const root = await host(t, {}, fixture);
  const validate = () => run(root, "validate", "product/story-map.yaml");
  assert.match(validate().stderr, /set-up is from 0\.7\.5.*\[setup-behind\]/);
  const before = await snapshot(root);

  // The dry run lists the changes and the questions, and writes nothing.
  const dry = run(root, "upgrade", "--mode", "simple");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^What changes for you since 0\.7\.5$/m);
  assert.match(dry.stdout, new RegExp(`^AGENTS\\.md section +replace +replace with ${version}$`, "m"));
  assert.match(dry.stdout, new RegExp(`^Guide +replace +replace with ${version}$`, "m"));
  assert.doesNotMatch(dry.stdout, /^CI workflow +/m, "the 0.7.5 workflow is this version's");
  assert.match(dry.stdout, /^- Do you want to use delivery plans.* Answer with --plans <folder>\|off\./m);
  assert.match(dry.stdout, /^- Should story-map add number new stories.* Answer with --story-ids next\|lowest-free\./m);
  assert.match(dry.stdout, /^Apply these changes\? Run again with --write\./m);
  assert.deepEqual(await snapshot(root), before);

  // Without a terminal, --write applies the files and lists the choices instead of guessing them.
  const applied = run(root, "upgrade", "--mode", "simple", "--write");
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /^Wrote AGENTS\.md, docs\/story-map\.md\. /m);
  assert.match(applied.stdout, /^To ask the person, and record only their answer:$/m);
  assert.equal(await read(root, "product/story-map.yaml"), before["product/story-map.yaml"][0], "no choice is recorded without an answer");
  assert.equal(await read(root, ".github/workflows/story-map.yml"), before[".github/workflows/story-map.yml"][0]);

  // Each replaced file carries this version's marker, and matches this version's template.
  assert.equal(await read(root, "docs/story-map.md"), stampSetupFile("guide", await packaged("docs/story-map.md"), storyMapVersion));
  assert.equal(await read(root, "AGENTS.md"), stampSetupFile("agents", await packaged("templates/AGENTS.md"), storyMapVersion));
  const parts = byPart(await upgradeReport({ root }));
  for (const id of ["agents", "guide"]) assert.deepEqual([parts[id].state, parts[id].version.recordedVersion], ["current", storyMapVersion], id);
  assert.doesNotMatch(validate().stderr, /setup-behind/, "the reminder goes quiet");

  // Nothing left to apply: every file stays byte for byte as it is.
  const after = await snapshot(root);
  const again = run(root, "upgrade", "--mode", "simple", "--write");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^Nothing to change\.$/m);
  assert.match(again.stdout, /^Nothing was changed\.$/m);
  assert.deepEqual(await snapshot(root), after);
});

test("ESM-169: the product choices are recorded only from the person's answers", async t => {
  const root = await host(t, {}, fixture);
  const json = JSON.parse(run(root, "upgrade", "--mode", "simple", "--format", "json").stdout);
  assert.deepEqual(json.questions.map(question => question.part), ["plans", "storyIds"]);
  assert.deepEqual(json.changes.filter(change => change.action === "ask").map(change => change.part), ["plans", "storyIds"]);
  assert.equal(json.written, false);

  const answered = run(root, "upgrade", "--mode", "simple", "--plans", "docs/plans", "--story-ids", "lowest-free", "--write");
  assert.equal(answered.status, 0, answered.stderr);
  assert.match(answered.stdout, /^Story ID policy +record +record "lowest-free" in settings\.storyIds$/m);
  assert.doesNotMatch(answered.stdout, /To ask the person/);
  const parts = byPart(await upgradeReport({ root }));
  assert.deepEqual([parts.plans.value, parts.storyIds.value], ["docs/plans", "lowest-free"]);
  assert.equal(run(root, "validate", "product/story-map.yaml").status, 0);

  // settings records the same answer on its own.
  assert.equal(run(root, "settings", "--story-ids", "next", "--write").status, 0);
  assert.equal(byPart(await upgradeReport({ root })).storyIds.value, "next");
  assert.equal(run(root, "settings", "--story-ids", "sometimes").status, 2);
});

test("ESM-169: an empty repository gets every part, and an existing AGENTS.md keeps its own text", async t => {
  const root = await host(t, { "AGENTS.md": "# House rules\n\nDeploy from main only.\n" });
  const result = await applyUpgrade({ root, known: empty, write: true });
  const changes = byChange(result);
  assert.deepEqual(["agents", "guide", "workflow", "skill"].map(id => changes[id].action), ["add", "add", "add", "keep"]);
  assert.equal(result.overview.kind, "install");
  assert.ok((await read(root, "AGENTS.md")).startsWith("# House rules\n\nDeploy from main only.\n\n<!-- auto-story-map:start "));
  for (const part of (await upgradeReport({ root, known: empty })).parts.filter(part => part.kind === "file" && part.part !== "skill")) {
    assert.deepEqual([part.state, part.from], ["current", storyMapVersion], part.part);
  }
  assert.deepEqual(await findSetupBehind(root), []);

  // Without a package-lock.json, the workflow is left out, as init leaves it out.
  const bare = await host(t);
  await rm(join(bare, "package-lock.json"));
  const workflow = byChange(await applyUpgrade({ root: bare, known: empty })).workflow;
  assert.deepEqual([workflow.action, /package-lock\.json/.test(workflow.change)], ["keep", true]);
});

test("ESM-169: parts the host edited are kept byte for byte in simple mode, and replaced when chosen with --apply", async t => {
  const guide = await packaged("docs/story-map.md");
  const edited = `${stampSetupFile("guide", `${guide}\nAn older line.\n`, "0.7.5")}\nOur own note.\n`;
  const skill = "---\nname: story-map\n---\n\nOur own skill.\n";
  const root = await host(t, { "docs/story-map.md": edited, ".claude/skills/story-map/SKILL.md": skill });

  const simple = await applyUpgrade({ root, known: empty, write: true });
  assert.deepEqual([byChange(simple).guide.action, byChange(simple).skill.action], ["keep", "keep"]);
  assert.match(simple.overview.kept, /Guide and Story map skill/);
  assert.equal(await read(root, "docs/story-map.md"), edited);
  assert.equal(await read(root, ".claude/skills/story-map/SKILL.md"), skill);

  // Advanced mode replaces only the parts named, even edited ones.
  await write(root, { "AGENTS.md": "# Our own AGENTS.md\n" });
  const chosen = run(root, "upgrade", "--apply", "guide", "--write");
  assert.equal(chosen.status, 0, chosen.stderr);
  assert.match(chosen.stdout, new RegExp(`^Guide +replace +replace with ${version}, replacing your edits$`, "m"));
  assert.equal(await read(root, "docs/story-map.md"), stampSetupFile("guide", guide, storyMapVersion));
  assert.equal(await read(root, ".claude/skills/story-map/SKILL.md"), skill);
  assert.equal(await read(root, "AGENTS.md"), "# Our own AGENTS.md\n", "parts not named are not added");

  // Usage errors exit 2.
  assert.equal(run(root, "upgrade", "--apply", "readme").status, 2);
  assert.equal(run(root, "upgrade", "--mode", "simple", "--apply", "guide").status, 2);
  assert.equal(run(root, "upgrade", "--write").status, 2);
  assert.equal(run(root, "upgrade", "--mode", "sometimes").status, 2);
  assert.match(run(root, "upgrade", "--mode", "advanced").stdout, /run again with --apply <parts> --write/);
});

test("ESM-169: an edited AGENTS.md section updates its unchanged rules and keeps every rule the host reworded or added", async t => {
  const template = await packaged("templates/AGENTS.md");
  // The 0.7.5 template, as in ESM-173's tests: two rules worded differently, one this version adds, one it drops.
  let older = replaceRule(template, "record-tokens", `${marker("record-tokens")}Record the tokens used, the old way.\n`);
  older = replaceRule(older, "test-names", `${marker("test-names")}Name tests after stories, the old way.\n`);
  older = replaceRule(older, "outstanding-actions", "");
  older = older.replace("<!-- auto-story-map:end -->", `\n${marker("old-dropped-rule")}A rule this version drops.\n<!-- auto-story-map:end -->`);
  const known = knownSetupVersionsFrom([{ part: "agents", version: "0.7.5", text: older }]);

  // The host rewords test-names, which changed since, and agreed-estimates, which did not, removes pr-diff-summary,
  // and adds a rule and a heading of its own after agreed-estimates.
  let hostText = replaceRule(older, "test-names", `${marker("test-names")}Our own wording of the test names rule.\n`);
  hostText = replaceRule(hostText, "agreed-estimates", `${marker("agreed-estimates")}Our own wording of the estimates rule.\n\nDeploy from main only.\n\n### Our own heading\n`);
  hostText = replaceRule(hostText, "pr-diff-summary", "");
  const outside = "# House rules\n\nKeep this paragraph.\n\n";
  const file = `${outside}${stampSetupFile("agents", older, "0.7.5").replace(setupBody("agents", older), setupBody("agents", hostText))}\nAfter the section.\n`;
  const root = await host(t, { "AGENTS.md": file });

  const result = await applyUpgrade({ root, known, write: true });
  const agents = byChange(result).agents;
  assert.equal(agents.action, "update");
  assert.equal(agents.change, "update 1 rule, add 1 new rule, remove 1 dropped rule, keep 1 reworded rule for you to review");
  assert.match(result.overview.kept, /AGENTS\.md section \(your reworded rules\)/);

  const text = await read(root, "AGENTS.md");
  assert.ok(text.startsWith(outside), "the text before the section is kept");
  assert.ok(text.endsWith("<!-- auto-story-map:end -->\n\nAfter the section.\n"), `the text after the section is kept: ${JSON.stringify(text.slice(-80))}`);
  const body = setupBody("agents", text);
  assert.equal(ruleText(body, "record-tokens"), ruleText(template, "record-tokens"), "an unchanged rule is updated");
  assert.equal(ruleText(body, "outstanding-actions"), ruleText(template, "outstanding-actions"), "a new rule is added");
  assert.equal(ruleText(body, "test-names"), "Our own wording of the test names rule.");
  assert.equal(ruleText(body, "agreed-estimates"), "Our own wording of the estimates rule.");
  assert.match(body, /^Our own wording of the estimates rule\.\n\nDeploy from main only\.\n\n### Our own heading\n\n/m, "the host's own blocks stay where they were");
  assert.doesNotMatch(body, /pr-diff-summary|A rule this version drops/);

  // A reworded rule is still to review, so the marker stays, and the review still offers it.
  assert.match(text, /<!-- auto-story-map:start 0\.7\.5 sha256:/);
  const part = byPart(await upgradeReport({ root, known })).agents;
  assert.deepEqual(part.rules.filter(rule => rule.recommendation !== "keep").map(rule => [rule.id, rule.recommendation]), [["test-names", "review"]]);

  // Running it again changes nothing.
  const again = await applyUpgrade({ root, known, write: true });
  assert.deepEqual([again.changed, byChange(again).agents.action], [false, "keep"]);
  assert.equal(await read(root, "AGENTS.md"), text);
});

test("ESM-169: an edited section with nothing left to review records this version, and the reminder goes quiet", async t => {
  const template = await packaged("templates/AGENTS.md");
  const older = replaceRule(template, "record-tokens", `${marker("record-tokens")}Record the tokens used, the old way.\n`);
  const known = knownSetupVersionsFrom([{ part: "agents", version: "0.7.5", text: older }]);
  const hostText = replaceRule(older, "agreed-estimates", `${marker("agreed-estimates")}Our own wording of the estimates rule.\n`);
  const root = await host(t, { "AGENTS.md": stampSetupFile("agents", older, "0.7.5").replace(setupBody("agents", older), setupBody("agents", hostText)) });
  assert.equal((await findSetupBehind(root, { known })).length, 1);

  await applyUpgrade({ root, known, write: true });
  const version = readSetupFileVersion("agents", await read(root, "AGENTS.md"), known);
  assert.deepEqual([version.recordedVersion, version.recordedHash, version.unedited], [storyMapVersion, setupBodyHash(setupBody("agents", template)), false]);
  const part = byPart(await upgradeReport({ root, known })).agents;
  assert.deepEqual([part.state, part.recommendation], ["edited", "keep"]);
  assert.equal(part.rules.find(rule => rule.id === "agreed-estimates").text, "Our own wording of the estimates rule.");
  assert.deepEqual(await findSetupBehind(root, { known }), []);
});

test("ESM-169: an edited workflow gains its missing steps and keeps the host's own edits", async t => {
  const template = await packaged("templates/story-map-ci.yml");
  const edited = stampSetupFile("workflow", template, "0.7.5")
    .replace(/      - name: Summarise story map changes[\s\S]*$/, "")
    .replace("node-version: lts/*", "node-version: 22")
    .replace("  validate:\n", "  map:\n");
  const root = await host(t, { ".github/workflows/story-map.yml": edited });

  const result = await applyUpgrade({ root, known: empty, write: true });
  assert.deepEqual([byChange(result).workflow.action, byChange(result).workflow.change], ["update", "add the story-map diff step"]);
  const text = await read(root, ".github/workflows/story-map.yml");
  assert.match(text, new RegExp(`^# auto-story-map ${version} sha256:`));
  assert.match(text, /node-version: 22/);
  assert.match(text, /^ {2}map:$/m);
  assert.ok(text.endsWith(template.slice(template.indexOf("      - name: Summarise story map changes"))), "the step is added as the template writes it");
  const workflow = byPart(await upgradeReport({ root, known: empty })).workflow;
  assert.deepEqual([workflow.state, workflow.recommendation], ["edited", "keep"]);
  assert.deepEqual(await findSetupBehind(root, { known: empty }), []);
});

test("ESM-169: merging and step helpers keep the template exact and refuse what they cannot place", async () => {
  // A section where every rule is kept renders as this version's template, byte for byte.
  for (const name of ["templates/AGENTS.md", "templates/AGENTS-skill.md"]) {
    const body = setupBody("agents", await packaged(name));
    const rules = [...templateRules(body, name.endsWith("skill.md") ? "skill" : "full").rules].map(([id, text]) => ({ id, title: id, state: "current", recommendation: "keep", change: "none", text }));
    assert.equal(mergeAgentsSection(body, body, rules), body, name);
    assert.equal(mergeAgentsSection(body, body, []), body, `${name}, with no review`);
  }

  // Steps go at the end of the job that runs validate, at the host's indentation.
  const template = await packaged("templates/story-map-ci.yml");
  const host = "jobs:\n  lint:\n    steps:\n    - run: npm run lint\n  map:\n    steps:\n    - run: npx story-map validate product/story-map.yaml\n";
  const added = addWorkflowSteps(host, template, ["story-map diff"]);
  assert.match(added, /^ {4}- run: npx story-map validate product\/story-map\.yaml\n {4}- name: Summarise story map changes\n {6}env:\n/m);
  assert.ok(workflowCommands(added).has("story-map diff"));
  assert.equal(addWorkflowSteps("jobs:\n  map:\n    steps: [{ run: npm test }]\n", template, ["story-map diff"]), undefined, "an inline list is left to the person");

  // Replacing a section keeps Windows line endings and the text around it.
  const crlf = "# Rules\r\n\r\n<!-- auto-story-map:start -->\r\nOld.\r\n<!-- auto-story-map:end -->\r\nAfter.\r\n";
  assert.equal(replaceAgentsSection(crlf, "<!-- auto-story-map:start 1.0.0 -->\nNew.\n<!-- auto-story-map:end -->\n"), "# Rules\r\n\r\n<!-- auto-story-map:start 1.0.0 -->\r\nNew.\r\n<!-- auto-story-map:end -->\r\nAfter.\r\n");
});
