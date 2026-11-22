import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkStoryMap, findStories, getStories, getStoryMapForViewer, parseStoryMap, storyMapToJson } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/builder-estimates.yaml", import.meta.url));
const sample = await readFile(fixture, "utf8");
const internal = map => getStoryMapForViewer(map, {}, { canViewInternal: () => true });
const day = 24 * 60 * 60 * 1000;

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), "story-map-read-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/** History where BUILDER-101 went in progress 60 days ago, so it is stalled, and BUILDER-102 was added yesterday. */
function sampleHistory() {
  const ago = days => new Date(Date.now() - days * day).toISOString();
  return {
    version: 1,
    generatedAt: ago(0),
    complete: true,
    events: [
      { storyId: "BUILDER-101", type: "added", to: "planned", at: ago(90), by: "Alex Morgan", commit: "aaaaaaa" },
      { storyId: "BUILDER-101", type: "status", from: "planned", to: "in-progress", at: ago(60), by: "Alex Morgan", commit: "bbbbbbb" },
      { storyId: "BUILDER-102", type: "added", to: "planned", at: ago(1), by: "Sam Patel", commit: "ccccccc" },
    ],
  };
}

test("ESM-741: story prints a story in full and exits 1 with suggestions for an unknown ID", () => {
  const found = run("story", "--map", fixture, "BUILDER-102");
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /^BUILDER-102 {2}Look up prices in the material catalogue$/m);
  assert.match(found.stdout, /^ {2}Release: {3}builder-mvp \(Builder workflow\)$/m);
  assert.match(found.stdout, /^ {2}Notes: {5}Confirm how a catalogue price/m);
  assert.match(found.stdout, /^ {4}docs\/example-builder-estimate-plan\.md#builder-workflow$/m);
  assert.doesNotMatch(found.stdout, /Find material prices/, "customer copy is not printed");

  const missing = run("story", "--map", fixture, "BUILDER-101", "builder-102", "NOPE-1");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^BUILDER-101 /m);
  assert.match(missing.stderr, /^builder-102: no story with this ID in .*\. Did you mean BUILDER-102/m);
  assert.match(missing.stderr, /^NOPE-1: no story with this ID in [^?]*\.$/m);

  assert.equal(run("story", "--map", fixture).status, 2, "an ID is required");
});

test("ESM-741: story and stories return the JSON export's story shape", () => {
  const map = parseStoryMap(sample);
  const exported = JSON.parse(storyMapToJson(internal(map)));
  const story = JSON.parse(run("story", "--map", fixture, "--format", "json", "FINANCE-202", "MISSING-9").stdout);
  assert.equal(story.format, "auto-story-map.stories");
  assert.equal(story.version, 1);
  assert.deepEqual(story.stories, [exported.stories.find(item => item.id === "FINANCE-202")]);
  assert.deepEqual(story.missing, [{ id: "MISSING-9", suggestions: [] }]);

  const listed = JSON.parse(run("stories", "--map", fixture, "--format", "json", "--status", "all").stdout);
  assert.deepEqual(listed.stories, exported.stories);
  assert.equal(listed.filter.total, map.stories.length);
});

test("ESM-741: stories applies the board's filters and hides blocked and cut stories by default", () => {
  const ids = (...args) => {
    const result = run("stories", "--map", fixture, "--format", "json", ...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).stories.map(story => story.id);
  };
  assert.deepEqual(ids(), ["BUILDER-101", "BUILDER-102", "BUILDER-103", "FINANCE-201"]);
  assert.deepEqual(ids("--status", "cut"), ["FINANCE-202"]);
  assert.deepEqual(ids("--status", "in-progress,cut"), ["BUILDER-101", "FINANCE-202"]);
  assert.deepEqual(ids("--status", "in-progress", "--status", "cut"), ["BUILDER-101", "FINANCE-202"]);
  assert.deepEqual(ids("--release", "builder-mvp", "--activity", "prepare"), ["BUILDER-101", "BUILDER-102"]);
  assert.deepEqual(ids("--release=finance-follow-up,reconciliation-internal", "--status", "all"), ["FINANCE-201", "FINANCE-202"]);
  assert.deepEqual(ids("--query", "CATALOGUE"), ["BUILDER-102"], "the query matches notes and titles case-insensitively");
  assert.deepEqual(ids("--query", "finance-2"), ["FINANCE-201"], "the query matches IDs, and the cut story stays hidden");

  const text = run("stories", "--map", fixture);
  assert.match(text.stdout, /^BUILDER-101 {2}in-progress {2}builder-mvp {8}Draft an estimate against a project$/m);
  assert.equal(text.stderr.trim(), "4 stories of 5; 1 cut hidden, shown with --status all");

  assert.equal(run("stories", "--map", fixture, "--status", "done").status, 2);
  assert.equal(run("stories", "--map", fixture, "--changed-within", "3").status, 2);
  const unknown = run("stories", "--map", fixture, "--release", "later");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /--release later: no release with this ID/);
});

test("ESM-741: stories filters stalled and recently changed stories from history", async t => {
  const directory = await scratch(t);
  const history = join(directory, "history.json");
  await writeFile(history, JSON.stringify(sampleHistory()));
  const ids = (...args) => JSON.parse(run("stories", "--map", fixture, "--format", "json", "--history", history, ...args).stdout).stories.map(story => story.id);
  assert.deepEqual(ids("--status", "stalled"), ["BUILDER-101"]);
  assert.deepEqual(ids("--changed-within", "7"), ["BUILDER-102"]);
  assert.deepEqual(ids("--changed-within", "30d"), ["BUILDER-102"]);

  const story = run("story", "--map", fixture, "--history", history, "BUILDER-101");
  assert.match(story.stdout, /^ {2}Status: {4}in-progress \(stalled\)$/m);
  assert.match(story.stdout, /^ {4}\d{4}-\d\d-\d\d {2}planned → in-progress by Alex Morgan \(bbbbbbb\)$/m);

  const ignored = run("stories", "--map", fixture, "--changed-within", "7");
  assert.equal(ignored.status, 0);
  assert.match(ignored.stderr, /warning: --changed-within needs --history, so it is ignored/);
});

test("ESM-741: story lists tagged tests from a tests index", async t => {
  const directory = await scratch(t);
  const index = join(directory, "tests.json");
  await writeFile(index, JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    tests: [{ storyIds: ["BUILDER-101"], file: "test/drafts.test.js", line: 12, name: "BUILDER-101: saves a draft", kind: "test" }],
  }));
  const text = run("story", "--map", fixture, "--tests-index", index, "BUILDER-101", "BUILDER-102");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ {2}Tests: {5}1 tagged test\n {4}test\/drafts\.test\.js:12 {2}BUILDER-101: saves a draft$/m);
  assert.match(text.stdout, /^ {2}Tests: {5}0 tagged tests$/m);
  const json = JSON.parse(run("story", "--map", fixture, "--format", "json", "--tests-index", index, "BUILDER-101").stdout);
  assert.equal(json.stories[0].testCount, 1);
});

test("ESM-741: releases lists story counts, estimates and impact, marking drafts", () => {
  const text = run("releases", "--map", fixture, "builder-mvp");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^builder-mvp {2}Builder workflow$/m);
  assert.match(text.stdout, /^ {2}Stories: {3}3 \(2 planned, 1 in progress\)$/m);
  assert.match(text.stdout, /^ {4}Estimate turnaround time$/m);
  assert.match(text.stdout, /^ {4}\[draft\] Estimates returned for corrections$/m);
  assert.match(text.stdout, /^ {13}Catalogue prices are locked/m, "each line of multi-line notes is indented");
  assert.doesNotMatch(text.stdout, /Finance follow-up/);

  const json = JSON.parse(run("releases", "--map", fixture, "--format", "json").stdout);
  assert.equal(json.format, "auto-story-map.releases");
  assert.deepEqual(json.releases.map(release => release.id), ["builder-mvp", "finance-follow-up", "reconciliation-internal"]);
  assert.equal(json.releases[0].impact[1].draft, true);

  const missing = run("releases", "--map", fixture, "later");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^later: no release with this ID/m);
});

test("ESM-741: read commands escape control characters in map text", async t => {
  const directory = await scratch(t);
  const file = join(directory, "map.yaml");
  await writeFile(file, sample
    .replace("title: Draft an estimate against a project", 'title: "Draft\\r\\u001b[2Kforged"')
    .replace("notes: Confirm how a catalogue price is carried into a submitted estimate.", 'notes: "First line\\nSecond \\u001b[31mred"'));
  const listed = run("stories", "--map", file);
  assert.equal(listed.status, 0, listed.stderr);
  assert.doesNotMatch(listed.stdout, /[\r\u001b]/);
  assert.match(listed.stdout, /Draft\\r\\u001b\[2Kforged/);
  const story = run("story", "--map", file, "BUILDER-102");
  assert.doesNotMatch(story.stdout, /\u001b/);
  assert.match(story.stdout, /^ {2}Notes: {5}First line\n {13}Second \\u001b\[31mred$/m);
});

test("ESM-741: read commands report an invalid map and exit 1", async t => {
  const directory = await scratch(t);
  const file = join(directory, "map.yaml");
  await writeFile(file, sample.replace("release: finance-follow-up\n", "release: finance-later\n"));
  const result = run("stories", "--map", file);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown release 'finance-later'/);
  assert.equal(result.stdout, "");
});

test("ESM-741: findStories and getStories take an unfiltered internal view", () => {
  const map = parseStoryMap(sample);
  const view = internal(map);
  assert.deepEqual(findStories(view, { releases: ["builder-mvp"], status: ["planned"] }).stories.map(story => story.id), ["BUILDER-102", "BUILDER-103"]);
  assert.deepEqual(getStories(view, ["BUILDER-103", "BUILDER-103", "BUILDER-10"]).stories.map(story => story.id), ["BUILDER-103"]);
  assert.deepEqual(getStories(view, ["BUILDER-10"]).missing[0].suggestions, ["BUILDER-101", "BUILDER-102", "BUILDER-103"]);
  const customer = getStoryMapForViewer(map, { roles: [] }, { canViewInternal: () => false });
  assert.throws(() => findStories(customer), TypeError);
});

test("ESM-741: help prints one command's section", () => {
  const help = run("help", "stories");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:\n {2}story-map stories /);
  assert.match(help.stdout, /--changed-within <days>/);
  assert.doesNotMatch(help.stdout, /story-map validate/);
  assert.match(run("help").stdout, /story-map releases/);
  assert.equal(run("help", "nope").status, 2);

  const wrong = run("releases", "--bogus");
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /^Usage:\n {2}story-map releases /);
  assert.doesNotMatch(wrong.stderr, /story-map validate/);
});

test("ESM-742: validate --format json returns a valid map's counts and warnings", () => {
  const result = run("validate", "--format", "json", fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const json = JSON.parse(result.stdout);
  assert.equal(json.format, "auto-story-map.validation");
  assert.equal(json.version, 1);
  assert.equal(json.valid, true);
  assert.equal(json.maps.length, 1);
  assert.deepEqual(json.maps[0].counts, { activities: 4, releases: 3, stories: 5 });
  assert.equal(json.maps[0].file, fixture);
  assert.equal(json.maps[0].errors, 0);
});

test("ESM-742: validate --format json returns each error with its position and YAML path", async t => {
  const directory = await scratch(t);
  const file = join(directory, "map.yaml");
  await writeFile(file, sample.replace("release: finance-follow-up\n", "release: finance-later\n"));
  const line = sample.split("\n").findIndex(text => text.includes("release: finance-follow-up")) + 1;
  const result = run("validate", "--format", "json", file, fixture);
  assert.equal(result.status, 1);
  const json = JSON.parse(result.stdout);
  assert.equal(json.valid, false);
  assert.deepEqual(json.maps.map(entry => entry.valid), [false, true]);
  const [broken] = json.maps;
  assert.equal(broken.counts, undefined);
  assert.deepEqual(broken.issues, [{
    severity: "error",
    line,
    column: 14,
    path: ["stories", 3, "release"],
    target: "stories.3.release (FINANCE-201)",
    itemId: "FINANCE-201",
    message: "Unknown release 'finance-later'.",
  }]);

  const unreadable = JSON.parse(run("validate", "--format", "json", join(directory, "missing.yaml")).stdout);
  assert.equal(unreadable.maps[0].issues[0].severity, "error");
  assert.match(unreadable.maps[0].issues[0].message, /ENOENT/);
});

test("ESM-742: validate --format json fails warnings with --strict", async t => {
  const directory = await scratch(t);
  const file = join(directory, "map.yaml");
  await writeFile(file, sample.replace("    statusReason: Finance will handle duplicate approvals manually until volumes justify it.\n", ""));
  const relaxed = run("validate", "--format", "json", file);
  assert.equal(relaxed.status, 0);
  const warning = JSON.parse(relaxed.stdout).maps[0].issues.find(issue => issue.severity === "warning");
  assert.equal(warning.itemId, "FINANCE-202");
  const strict = run("validate", "--format", "json", "--strict", file);
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).maps[0].valid, false);
});

test("ESM-742: validate --format json includes source, plan and test issues from other files", async t => {
  const directory = await scratch(t);
  await writeFile(join(directory, "map.yaml"), sample);
  await writeFile(join(directory, "plan.md"), "# Plan\n\nBUILDER-999 is not in the map.\n");
  await writeFile(join(directory, "a.test.js"), 'test("BUILDER-998: nothing", () => {});\n');
  const result = spawnSync(process.execPath, [cli, "validate", "--format", "json", "--check-sources", "--plans", "plan.md", "--tests", "a.test.js", "map.yaml"], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 1);
  const [entry] = JSON.parse(result.stdout).maps;
  assert.deepEqual(entry.checked, ["sources", "plans", "tests"]);
  const files = entry.issues.filter(issue => issue.severity === "error").map(issue => issue.file);
  assert.ok(files.includes("plan.md"), JSON.stringify(entry.issues));
  assert.ok(files.includes("a.test.js"), JSON.stringify(entry.issues));
  assert.ok(entry.issues.some(issue => issue.target?.startsWith("stories.1.sources.0")), "the missing plan is reported as a broken source");
});

test("ESM-742: checkStoryMap returns the same result as validate --format json", async () => {
  const result = await checkStoryMap(sample);
  const cliResult = JSON.parse(run("validate", "--format", "json", fixture).stdout).maps[0];
  assert.deepEqual({ file: fixture, ...result }, cliResult);
  const broken = await checkStoryMap("version: 1\nstories: [\n");
  assert.equal(broken.valid, false);
  assert.ok(broken.errors > 0);
});
