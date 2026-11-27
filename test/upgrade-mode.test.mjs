import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyUpgrade, diffStoryMaps, parseStoryMap, proposeStoryMapEdit, upgradeModeQuestion, upgradeReport } from "auto-story-map";
import { askUpgradeMode, walkThroughUpgrade } from "../dist/commands/upgrade.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/upgrade-0.7.5", import.meta.url));
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
const read = (root, path) => readFile(join(root, path), "utf8");

async function host(t) {
  const root = await mkdtemp(join(tmpdir(), "story-map-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  return root;
}

/** Answers each question in turn from `answers`, recording the prompts. */
function answering(answers) {
  const prompts = [];
  const ask = async prompt => {
    prompts.push(prompt);
    return answers.shift() ?? "";
  };
  return { ask, prompts };
}

test("ESM-170: settings.upgrade accepts simple or advanced, and nothing else", () => {
  const map = mode => `version: 1\nid: demo\ntitle: Demo\nsettings:\n  upgrade: ${mode}\nactivities:\n  - id: a\n    title: A\nreleases:\n  - id: r\n    title: R\nstories: []\n`;
  assert.equal(parseStoryMap(map("simple")).settings.upgrade, "simple");
  assert.equal(parseStoryMap(map("advanced")).settings.upgrade, "advanced");
  assert.throws(() => parseStoryMap(map("sometimes")));
});

test("ESM-170: with no mode chosen, agents get the report and the question, and --write is refused", async t => {
  const root = await host(t);
  const report = await upgradeReport({ root });
  assert.equal(report.mode, undefined);
  assert.deepEqual(report.modeQuestion, upgradeModeQuestion);

  const text = run(root, "upgrade");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /To ask the person: Do you want simple or advanced upgrades\?.*story-map settings --upgrade simple\|advanced/);
  assert.equal(JSON.parse(run(root, "upgrade", "--format", "json").stdout).modeQuestion.option, "story-map settings --upgrade simple|advanced");

  const before = await read(root, "AGENTS.md");
  const refused = run(root, "upgrade", "--write");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /nobody has chosen simple or advanced mode/);
  assert.equal(await read(root, "AGENTS.md"), before);
});

test("ESM-170: story-map settings records the person's answer, and story-map diff lists it", async t => {
  const root = await host(t);
  const mapBefore = await read(root, "product/story-map.yaml");
  const dry = run(root, "settings", "--upgrade", "advanced");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Upgrade review: advanced mode \(was not chosen\)\./);
  assert.equal(await read(root, "product/story-map.yaml"), mapBefore);

  assert.equal(run(root, "settings", "--upgrade", "advanced", "--write").status, 0);
  const mapAfter = await read(root, "product/story-map.yaml");
  assert.match(mapAfter, /^  upgrade: advanced$/m);
  assert.equal(run(root, "validate", "product/story-map.yaml").status, 0);
  assert.deepEqual(diffStoryMaps(parseStoryMap(mapBefore), parseStoryMap(mapAfter)).upgrade, { from: undefined, to: "advanced" });
  assert.equal(run(root, "settings", "--upgrade", "sometimes").status, 2);

  const report = await upgradeReport({ root });
  assert.equal(report.mode, "advanced");
  assert.equal(report.modeQuestion, undefined);
});

test("ESM-170: the recorded mode decides what story-map upgrade does, and --mode overrides it for one run", async t => {
  const root = await host(t);
  assert.equal(run(root, "settings", "--upgrade", "simple", "--write").status, 0);
  const dry = JSON.parse(run(root, "upgrade", "--format", "json").stdout);
  assert.equal(dry.mode, "simple");
  assert.equal(dry.written, false);
  assert.ok(dry.changes.some(change => change.action === "replace"));

  // Advanced for one run: the report with every diff, and nothing written.
  const advanced = run(root, "upgrade", "--mode", "advanced");
  assert.equal(advanced.status, 0, advanced.stderr);
  assert.match(advanced.stdout, /run again with --apply <parts> --write/);
  assert.match(advanced.stdout, /from yours to this version's/);
  assert.match(await read(root, "product/story-map.yaml"), /^  upgrade: simple$/m);

  // Simple, as recorded, writes with --write alone.
  const written = run(root, "upgrade", "--write");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /^Wrote .*AGENTS\.md/m);

  // Advanced, as recorded, without a terminal: the report with every diff.
  assert.equal(run(root, "settings", "--upgrade", "advanced", "--write").status, 0);
  assert.match(run(root, "upgrade").stdout, /To apply the parts you accept, run again with --apply/);
});

test("ESM-170: applyUpgrade records the mode only from the person's answer", async t => {
  const root = await host(t);
  const planned = await applyUpgrade({ root, mode: "advanced", parts: [], answers: { upgrade: "advanced" } });
  assert.equal(planned.modeRecorded, "advanced");
  assert.deepEqual(planned.files, ["product/story-map.yaml"]);
  assert.ok(planned.changes.every(change => change.action === "keep" || change.action === "ask"));
  assert.doesNotMatch(await read(root, "product/story-map.yaml"), /upgrade:/);

  const written = await applyUpgrade({ root, mode: "simple", answers: { upgrade: "simple" }, write: true });
  assert.equal(written.modeRecorded, "simple");
  assert.match(await read(root, "product/story-map.yaml"), /^  upgrade: simple$/m);
  // Without an answer, nothing is recorded, and a second answer that matches changes nothing.
  assert.equal((await applyUpgrade({ root, mode: "simple" })).modeRecorded, undefined);
  assert.equal((await applyUpgrade({ root, mode: "simple", answers: { upgrade: "simple" } })).modeRecorded, undefined);
});

test("ESM-170: the edit operation and its dry run keep settings in order", async () => {
  const source = "version: 1\nid: demo\ntitle: Demo\nsettings:\n  plans: docs/plans\nactivities:\n  - id: a\n    title: A\nreleases:\n  - id: r\n    title: R\nstories: []\n";
  const edit = await proposeStoryMapEdit(source, [{ op: "upgrade-mode", upgrade: "advanced" }]);
  assert.equal(edit.valid, true);
  assert.match(edit.source, /settings:\n  plans: docs\/plans\n  upgrade: advanced\n/);
  await assert.rejects(proposeStoryMapEdit(source, [{ op: "upgrade-mode", upgrade: "sometimes" }]));
});

test("ESM-170: at a terminal the review asks for the mode until it gets simple, advanced or not now", async () => {
  const warnings = [];
  const { ask, prompts } = answering(["maybe", "Advanced"]);
  assert.equal(await askUpgradeMode(ask, text => warnings.push(text)), "advanced");
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /^Do you want simple or advanced upgrades\?.*docs\/story-map\.md#choose-simple-or-advanced-mode/);
  assert.deepEqual(warnings, ["Answer simple or advanced, or press Enter for not now."]);
  assert.equal(await askUpgradeMode(answering(["s"]).ask), "simple");
  assert.equal(await askUpgradeMode(answering([""]).ask), undefined);
});

test("ESM-170: the advanced walk-through offers each part that would change, and Enter takes the recommendation", async t => {
  const root = await host(t);
  const report = await upgradeReport({ root });
  const offered = report.parts.filter(part => part.kind !== "choice" && part.state !== "current");
  assert.ok(offered.length >= 2);

  const printed = [];
  const enter = answering([]);
  const recommended = await walkThroughUpgrade(report, enter.ask, text => printed.push(text));
  assert.equal(enter.prompts.length, offered.length);
  assert.deepEqual(recommended, offered.filter(part => part.recommendation === "add" || part.recommendation === "replace").map(part => part.part));
  assert.match(printed[0], new RegExp(`^\\n1 of ${offered.length}\\. `));
  assert.match(enter.prompts[0], /^Take this version's .+\? \((Y\/n|y\/N)\) $/);

  // An unclear answer is asked again, and the person can decline everything.
  const declined = answering(["perhaps", ...offered.map(() => "n")]);
  assert.deepEqual(await walkThroughUpgrade(report, declined.ask, text => printed.push(text)), []);
  assert.equal(declined.prompts.length, offered.length + 1);
  assert.ok(printed.includes("Answer y or n, or press Enter for the recommendation."));

  // Taking parts the walk-through chose applies exactly those.
  const taken = await walkThroughUpgrade(report, answering(offered.map((_, index) => (index === 0 ? "y" : "n"))).ask, () => {});
  assert.deepEqual(taken, [offered[0].part]);
  const result = await applyUpgrade({ root, mode: "advanced", parts: taken });
  assert.deepEqual(result.changes.filter(change => !["keep", "ask"].includes(change.action)).map(change => change.part), taken);
});
