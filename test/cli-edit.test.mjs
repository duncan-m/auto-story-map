import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { diffStoryMaps, formatStoryMapDiff, nextStoryId, parseStoryMap, proposeStoryMapEdit, StoryMapEditError } from "auto-story-map";
import { escapeRegExp } from "../dist/references.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const ownMap = await readFile(new URL("../product/story-map.yaml", import.meta.url), "utf8");
const fixture = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
const numRuns = Number(process.env.FC_NUM_RUNS) || 60;
// This repository's map changes as work lands, so pick a status the story does not have yet.
const ownStatus = parseStoryMap(ownMap).stories.find(story => story.id === "ESM-744").status;
const newStatus = ownStatus === "in-progress" ? "merged" : "in-progress";

/** A scratch repository holding a copy of the map, so edits run with the map inside the root. */
async function scratch(t, source = ownMap) {
  const root = await mkdtemp(join(tmpdir(), "story-map-edit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), source);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  const read = () => readFile(join(root, "product/story-map.yaml"), "utf8");
  return { root, run, read };
}

/** The lines of a story's block, from its `- id:` line to the line before the next item or comment at that depth. */
function storyBlock(source, id) {
  const lines = source.split("\n");
  const start = lines.findIndex(line => line === `  - id: ${id}`);
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("    ")) end++;
  return { before: lines.slice(0, start).join("\n"), after: lines.slice(end).join("\n") };
}

/** Asserts that only the named story's lines differ between the two texts. */
function onlyStoryChanged(before, after, id) {
  const old = storyBlock(before, id);
  const edited = storyBlock(after, id);
  assert.equal(edited.before, old.before, `lines before ${id} are unchanged`);
  assert.equal(edited.after, old.after, `lines after ${id} are unchanged`);
}

test("ESM-744: each edit operation changes only its story's lines", async () => {
  const cases = [
    [{ op: "status", id: "ESM-744", status: newStatus }, `status: ${newStatus}`],
    [{ op: "status", id: "ESM-106", status: "cut", reason: "Teams run one agent at a time." }, "statusReason: Teams run one agent at a time."],
    [{ op: "release", id: "ESM-105", release: "v0-7-6" }, "release: v0-7-6"],
    [{ op: "activity", id: "ESM-105", activity: "track" }, "activity: track"],
    [{ op: "title", id: "ESM-741", title: "Read the map: stories, releases" }, 'title: "Read the map: stories, releases"'],
    [{ op: "summary", id: "ESM-741", summary: "A new summary." }, "summary: A new summary."],
    [{ op: "notes", id: "ESM-741", notes: "First line.\nSecond line." }, "notes: |-\n      First line.\n      Second line."],
    [{ op: "add-source", id: "ESM-744", source: "docs/story-map.md#propose-edits" }, "\n      - docs/story-map.md#propose-edits\n  - id: ESM-106\n"],
  ];
  for (const [operation, expected] of cases) {
    const result = await proposeStoryMapEdit(ownMap, [operation]);
    assert.equal(result.valid, true, JSON.stringify(result.check.issues.filter(issue => issue.severity === "error")));
    assert.equal(result.changed, true);
    assert.ok(result.source.includes(expected), `${operation.op}: ${expected}`);
    onlyStoryChanged(ownMap, result.source, operation.id);
    assert.ok(result.summary.includes(operation.id));
  }
});

test("ESM-744: leaving blocked or cut drops the reason, and removing the last source drops the list", async () => {
  const cut = await proposeStoryMapEdit(fixture, [{ op: "status", id: "FINANCE-202", status: "planned" }]);
  assert.doesNotMatch(cut.source, /statusReason/);
  onlyStoryChanged(fixture, cut.source, "FINANCE-202");

  const removed = await proposeStoryMapEdit(fixture, [{ op: "remove-source", id: "BUILDER-102", source: "docs/example-builder-estimate-plan.md#builder-workflow" }]);
  const story = parseStoryMap(removed.source).stories.find(item => item.id === "BUILDER-102");
  assert.equal(story.sources, undefined);
  assert.doesNotMatch(removed.source, /^ {4}sources:$/m);
  onlyStoryChanged(fixture, removed.source, "BUILDER-102");
});

test("ESM-744: add gives the next ID in sequence across the map, and never reuses one", async () => {
  // This repository's map fills gaps (ESM-180), so take the setting out to check the default.
  const sequentialMap = ownMap.replace("  storyIds: lowest-free\n", "");
  assert.notEqual(sequentialMap, ownMap);
  const map = parseStoryMap(sequentialMap);
  const next = `ESM-${Math.max(...map.stories.map(story => Number(story.id.slice(4)))) + 1}`;
  assert.equal(nextStoryId(map.stories, "v0-7-5"), next, "the release does not change the number");
  assert.equal(nextStoryId(map.stories), next);
  assert.equal(nextStoryId([{ id: "B-1", release: "a" }, { id: "B-30", release: "b" }, { id: "B-2", release: "a" }], "a"), "B-31", "follows the highest number in any release");
  assert.equal(nextStoryId([{ id: "B-1" }, { id: "B-3" }]), "B-4", "does not fill gaps, so a removed or skipped number is never reused");
  assert.equal(nextStoryId([{ id: "B-07", release: "a" }], "new"), "B-08", "keeps the number's width");
  assert.equal(nextStoryId([{ id: "7", release: "a" }, { id: "A9B-12", release: "a" }, { id: "x", release: "a" }], "a"), "8", "IDs without a prefix and without digits are handled");
  const started = performance.now();
  assert.throws(() => nextStoryId([{ id: `${"9".repeat(50000)}x`, release: "a" }], "a"), StoryMapEditError);
  assert.ok(performance.now() - started < 200, "an ID of many digits with no trailing number is split in linear time");

  const result = await proposeStoryMapEdit(sequentialMap, [{ op: "add", title: "Check claims in CI", activity: "review", release: "v0-7-5" }]);
  assert.deepEqual(result.addedIds, [next]);
  const lastSource = map.stories.filter(story => story.release === "v0-7-5").at(-1).sources.at(-1);
  assert.match(result.source, new RegExp(`- ${escapeRegExp(lastSource)}\\n {2}- id: ${next}\\n {4}title: Check claims in CI\\n {4}activity: review\\n {4}release: v0-7-5\\n {4}status: planned\\n {2}# Personas\\n`));
  assert.equal(result.source.replace(new RegExp(` {2}- id: ${next}\\n(?: {4}.*\\n)+`), ""), sequentialMap, "only the new story's lines are added");
  assert.ok(result.newIssues.some(issue => issue.itemId === next && /estimate/.test(issue.message)), "the missing estimate is a new warning");

  await assert.rejects(proposeStoryMapEdit(sequentialMap, [{ op: "add", id: "ESM-701", title: "Again", activity: "review", release: "v0-7-5" }]), /already in the map. IDs are never reused/);
});

/** The sample map with a gap at BUILDER-104, a cut story at BUILDER-102 and, unless `scheme` is null, `settings.storyIds`. */
function gappedFixture(scheme = "lowest-free") {
  const source = fixture
    .replace("  - id: BUILDER-102\n", "  - id: BUILDER-105\n")
    .replace("  - id: FINANCE-202\n", "  - id: BUILDER-102\n");
  return scheme ? source.replace("\nactivities:\n", `\nsettings:\n  storyIds: ${scheme}\nactivities:\n`) : source;
}

test("ESM-180: lowest-free takes the lowest unused number in the main prefix", () => {
  assert.equal(nextStoryId([{ id: "B-101" }, { id: "B-103" }, { id: "B-102" }, { id: "B-107" }], undefined, "lowest-free"), "B-104", "fills the first gap");
  assert.equal(nextStoryId([{ id: "B-101" }, { id: "B-102" }], undefined, "lowest-free"), "B-103", "with no gap, takes one after the highest");
  assert.equal(nextStoryId([{ id: "B-101" }, { id: "B-103" }]), "B-104", "the default still follows the highest");
  assert.equal(nextStoryId([{ id: "B-101" }, { id: "B-103" }], undefined, "next"), "B-104");
  assert.equal(nextStoryId([{ id: "B-101" }, { id: "B-104" }, { id: "C-102" }, { id: "B-103" }], undefined, "lowest-free"), "B-102", "another prefix's numbers do not fill the gap");
  assert.equal(nextStoryId([{ id: "C-1" }, { id: "B-5" }, { id: "B-7" }, { id: "C-3" }], undefined, "lowest-free"), "C-2", "a tie goes to the prefix that comes first");
  assert.equal(nextStoryId([{ id: "B-007" }, { id: "B-009" }], undefined, "lowest-free"), "B-008", "keeps the number's width");
  assert.throws(() => nextStoryId([{ id: `B-${"9".repeat(400)}` }], undefined, "lowest-free"), StoryMapEditError, "a number too large to count is refused, not looped on");
});

test("ESM-180: add fills a gap but never reuses a cut story's number", async () => {
  const lowestFree = await proposeStoryMapEdit(gappedFixture(), [{ op: "add", title: "Export estimates", activity: "prepare", release: "builder-mvp" }]);
  assert.deepEqual(lowestFree.addedIds, ["BUILDER-104"], "BUILDER-102 is cut, so the first free number is 104");
  assert.equal(parseStoryMap(gappedFixture()).stories.find(story => story.id === "BUILDER-102").status, "cut");
  const two = await proposeStoryMapEdit(gappedFixture(), [
    { op: "add", title: "One", activity: "prepare", release: "builder-mvp" },
    { op: "add", title: "Two", activity: "prepare", release: "builder-mvp" },
  ]);
  assert.deepEqual(two.addedIds, ["BUILDER-104", "BUILDER-106"], "each add in one edit counts the ones before it");
  const chosen = await proposeStoryMapEdit(gappedFixture(), [{ op: "add", id: "BUILDER-900", title: "Chosen", activity: "prepare", release: "builder-mvp" }]);
  assert.deepEqual(chosen.addedIds, ["BUILDER-900"], "--id still wins");
  await assert.rejects(proposeStoryMapEdit(gappedFixture(), [{ op: "add", id: "BUILDER-102", title: "Again", activity: "prepare", release: "builder-mvp" }]), /already in the map/);
});

test("ESM-180: without the setting, or set to next, add numbers in sequence as before", async () => {
  for (const scheme of [null, "next"]) {
    const result = await proposeStoryMapEdit(gappedFixture(scheme), [{ op: "add", title: "Export estimates", activity: "prepare", release: "builder-mvp" }]);
    assert.deepEqual(result.addedIds, ["BUILDER-106"], `scheme ${scheme}`);
  }
  assert.throws(() => parseStoryMap(gappedFixture("lowest")), /storyIds/, "an unknown scheme fails validation");
});

test("ESM-180: add previews the lowest free ID on a dry run and writes it with --write", async t => {
  const { run, read } = await scratch(t, gappedFixture());
  const args = ["add", "--title", "Export estimates", "--activity", "prepare", "--release", "builder-mvp"];
  const dry = run(...args);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout + dry.stderr, /BUILDER-104/);
  assert.equal(await read(), gappedFixture(), "a dry run leaves the map alone");
  const written = run(...args, "--write");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stderr, /Added BUILDER-104\./);
  assert.match(await read(), /- id: BUILDER-104\n {4}title: Export estimates/);
});

test("ESM-180: story-map diff lists a change to storyIds under Settings", () => {
  const before = parseStoryMap(gappedFixture(null));
  const after = parseStoryMap(gappedFixture());
  assert.match(formatStoryMapDiff(diffStoryMaps(before, after)), /### Settings\n\n- `add` gives new stories the lowest free number \(was one after the highest number\)\./);
  assert.equal(diffStoryMaps(before, parseStoryMap(gappedFixture("next"))).storyIds, undefined, "next is the default, so setting it is no change");
});

test("ESM-744: release-impact always adds a draft item", async () => {
  const result = await proposeStoryMapEdit(fixture, [{ op: "release-impact", release: "finance-follow-up", metric: "Purchase orders retyped", expected: "None" }]);
  const release = parseStoryMap(result.source).releases.find(item => item.id === "finance-follow-up");
  assert.deepEqual(release.impact.at(-1), { metric: "Purchase orders retyped", expected: "None", draft: true });
  const fresh = await proposeStoryMapEdit(fixture, [{ op: "release-impact", release: "reconciliation-internal", metric: "Duplicates found", expected: "Counted weekly", solves: "Nobody knows how often it happens" }]);
  assert.match(fresh.source, /title: Reconciliation discovery\n {4}impact:\n {6}- metric: Duplicates found\n {8}expected: Counted weekly\n {8}solves: Nobody knows how often it happens\n {8}draft: true\n/);
});

test("ESM-744: edits refuse deletes, missing reasons, unapproved customer copy and unknown stories", async () => {
  const refused = async (operations, pattern, options) => {
    await assert.rejects(proposeStoryMapEdit(fixture, operations, options), error => error instanceof StoryMapEditError && pattern.test(error.message));
  };
  await refused([{ op: "delete", id: "BUILDER-101" }], /Edit 1: op/);
  await refused([{ op: "status", id: "BUILDER-101", status: "blocked" }], /needs a reason/);
  await refused([{ op: "status", id: "BUILDER-101", status: "planned", reason: "Because" }], /only for blocked and cut/);
  await refused([{ op: "customer-title", id: "FINANCE-202", title: "Duplicates" }], /needs approval. Pass --customer/);
  await refused([{ op: "customer-summary", id: "FINANCE-202", summary: "Duplicates" }], /no customer title/, { allowCustomer: true });
  await refused([{ op: "title", id: "BUILDER-110", title: "x" }], /There is no story BUILDER-110\. Did you mean BUILDER-101/);
  await refused([{ op: "remove-source", id: "BUILDER-101", source: "nope.md" }], /has no source nope\.md/);
  await refused([{ op: "title", id: "BUILDER-101", title: "x", id2: "y" }], /Edit 1/);

  const approved = await proposeStoryMapEdit(fixture, [{ op: "customer-title", id: "BUILDER-102", title: "Find prices fast" }], { allowCustomer: true });
  assert.match(approved.summary, /Customer-facing changes/);
  const credited = await proposeStoryMapEdit(fixture, [{ op: "status", id: "BUILDER-103", status: "in-progress" }], { updatedBy: "Sam Patel" });
  assert.equal(parseStoryMap(credited.source).stories.find(item => item.id === "BUILDER-103").updatedBy, "Sam Patel");
});

test("ESM-744: an edit that would change other lines is refused", async () => {
  // An alias shares its value with another story, so changing one would change both.
  const aliased = fixture.replace("title: Draft an estimate against a project", "title: &shared Draft an estimate against a project")
    .replace("title: Look up prices in the material catalogue", "title: *shared");
  await assert.rejects(proposeStoryMapEdit(aliased, [{ op: "title", id: "BUILDER-101", title: "Changed" }]), /cannot be made without changing other parts of the file/);
});

test("ESM-744: story-map edit is a dry run until --write, and writes only a valid map", async t => {
  const { run, read } = await scratch(t);
  const dry = run("edit", "ESM-744", "--status", newStatus);
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(dry.stdout.includes(`\n-    status: ${ownStatus}\n+    status: ${newStatus}\n`), dry.stdout);
  assert.match(dry.stdout, /\| `ESM-744` Propose map edits from the command line \| Status: /);
  assert.match(dry.stderr, /Dry run: nothing written/);
  assert.match(dry.stderr, /warnings the map already had, not shown/);
  assert.equal(await read(), ownMap);

  const written = run("edit", "ESM-744", "--status", newStatus, "--write");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stderr, /Wrote product\/story-map\.yaml/);
  onlyStoryChanged(ownMap, await read(), "ESM-744");

  const invalid = run("edit", "ESM-744", "--release", "v9", "--write");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown release 'v9'/);
  assert.match(invalid.stderr, /not valid, so it was not written/);
  assert.match(await read(), new RegExp(`release: v0-7-2\\n {4}status: ${newStatus}`));

  const same = run("edit", "ESM-744", "--status", newStatus);
  assert.equal(same.status, 0);
  assert.match(same.stderr, /Nothing to change/);
});

test("ESM-744: story-map edit --from applies every edit or none", async t => {
  const { root, run, read } = await scratch(t);
  const next = nextStoryId(parseStoryMap(ownMap).stories, undefined, "lowest-free");
  await writeFile(join(root, "edits.json"), JSON.stringify([
    { op: "status", id: "ESM-744", status: newStatus },
    { op: "add", title: "Check claims in CI", activity: "review", release: "v0-7-5" },
    { op: "status", id: "ESM-999", status: "merged" },
  ]));
  const refused = run("edit", "--from", "edits.json", "--write", "--format", "json");
  assert.equal(refused.status, 1);
  const json = JSON.parse(refused.stdout);
  assert.equal(json.format, "auto-story-map.edit");
  assert.equal(json.written, false);
  assert.equal(json.refused.operation, 2);
  assert.match(json.refused.message, /^Edit 3: There is no story ESM-999/);
  assert.equal(await read(), ownMap);

  await writeFile(join(root, "edits.json"), JSON.stringify({ operations: [
    { op: "status", id: "ESM-744", status: newStatus },
    { op: "add", title: "Check claims in CI", activity: "review", release: "v0-7-5" },
  ] }));
  const applied = JSON.parse(run("edit", "--from", "edits.json", "--write", "--format", "json").stdout);
  assert.equal(applied.written, true);
  assert.deepEqual(applied.addedIds, [next]);
  assert.match(applied.lineDiff, new RegExp(`^\\+ {2}- id: ${next}$`, "m"));
  assert.deepEqual(applied.diff.stories.added.map(story => story.id), [next]);
  assert.deepEqual(applied.diff.stories.updated.map(story => story.id), ["ESM-744"]);
  assert.match(await read(), new RegExp(`- id: ${next}\\n`));

  assert.equal(run("edit", "--from", "edits.json", "ESM-744").status, 2);
  await writeFile(join(root, "bad.json"), "{");
  assert.match(run("edit", "--from", "bad.json").stderr, /not valid JSON/);
});

test("ESM-744: story-map edit refuses a map or edits file outside the repository", async t => {
  const { run } = await scratch(t);
  const outside = run("edit", "ESM-744", "--status", "in-progress", "--map", "../story-map.yaml", "--write");
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /Points outside the repository/);
  assert.match(run("edit", "--from", "../edits.json").stderr, /Points outside the repository/);
});

test("ESM-744: add and release-impact commands", async t => {
  const { run, read } = await scratch(t, fixture);
  const added = run("add", "--title", "Export estimates", "--activity", "prepare", "--release", "builder-mvp", "--source", "docs/plan.md", "--write");
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stderr, /Added BUILDER-104\./);
  assert.match(await read(), /- id: BUILDER-104\n {4}title: Export estimates/);
  assert.equal(run("add", "--title", "x", "--activity", "prepare").status, 2, "--release is required");

  const impact = run("release-impact", "builder-mvp", "--metric", "Exports per week", "--expected", "Ten", "--write");
  assert.equal(impact.status, 0, impact.stderr);
  assert.match(await read(), /- metric: Exports per week\n {8}expected: Ten\n {8}draft: true/);

  const customer = run("edit", "BUILDER-104", "--customer-title", "Export your estimate");
  assert.equal(customer.status, 1);
  assert.match(customer.stderr, /Pass --customer once it is approved/);
  assert.equal(run("edit", "BUILDER-104", "--customer-title", "Export your estimate", "--customer").status, 0);
  assert.equal(run("edit", "BUILDER-104", "--reason", "x").status, 2);
  assert.equal(run("edit", "BUILDER-104").status, 2);
});

test("ESM-744: random sequences of edits change only what they name, and validation catches any rule they break", async () => {
  const map = parseStoryMap(fixture);
  const ids = map.stories.map(story => story.id);
  const releases = map.releases.map(release => release.id);
  const activities = map.activities.map(activity => activity.id);
  const words = fc.stringMatching(/^[A-Za-z][A-Za-z ,.:'#-]{0,30}[A-Za-z.]$/);
  const operation = fc.oneof(
    fc.record({ op: fc.constant("status"), id: fc.constantFrom(...ids), status: fc.constantFrom("planned", "in-progress", "merged", "shipped") }),
    fc.record({ op: fc.constant("status"), id: fc.constantFrom(...ids), status: fc.constantFrom("blocked", "cut"), reason: words }),
    fc.record({ op: fc.constant("release"), id: fc.constantFrom(...ids), release: fc.constantFrom(...releases) }),
    fc.record({ op: fc.constant("activity"), id: fc.constantFrom(...ids), activity: fc.constantFrom(...activities) }),
    fc.record({ op: fc.constant("title"), id: fc.constantFrom(...ids), title: words }),
    fc.record({ op: fc.constant("summary"), id: fc.constantFrom(...ids), summary: words }),
    fc.record({ op: fc.constant("notes"), id: fc.constantFrom(...ids), notes: fc.array(words, { minLength: 1, maxLength: 3 }).map(lines => lines.join("\n")) }),
    fc.record({ op: fc.constant("add-source"), id: fc.constantFrom(...ids), source: fc.stringMatching(/^docs\/[a-z]{1,8}\.md(#[a-z-]{1,8})?$/) }),
    fc.record({ op: fc.constant("add"), title: words, activity: fc.constantFrom(...activities), release: fc.constantFrom(...releases) }),
    fc.record({ op: fc.constant("release-impact"), release: fc.constantFrom(...releases), metric: words, expected: words }),
  );
  await fc.assert(fc.asyncProperty(fc.array(operation, { minLength: 1, maxLength: 6 }), async operations => {
    let source = fixture;
    for (const op of operations) {
      let result;
      try {
        result = await proposeStoryMapEdit(source, [op], { allowCustomer: true });
      } catch (error) {
        assert.fail(`${JSON.stringify(op)} was refused: ${error.message}`);
      }
      if (op.id) onlyStoryChanged(source, result.source, op.id);
      // A well-formed edit can still break a rule that spans the map, such as moving a customer-facing
      // story into an internal release, or a release's impact limit. Validation must catch those, and nothing else.
      const errors = result.check.issues.filter(issue => issue.severity === "error");
      if (errors.length) {
        assert.equal(result.valid, false);
        assert.ok(errors.every(issue => /customer-facing|at most|Too big/i.test(issue.message)), JSON.stringify(errors));
        return;
      }
      source = result.source;
    }
    parseStoryMap(source);
  }), { numRuns });
});

test("ESM-158: edit --priority sets, changes and removes a story's priority", async t => {
  const { run, read } = await scratch(t, fixture);
  const id = parseStoryMap(fixture).stories[0].id;
  assert.equal(run("edit", id, "--priority", "Must", "--write").status, 0);
  assert.equal(parseStoryMap(await read()).stories[0].priority, "must");
  const changed = run("edit", id, "--priority", "could");
  assert.equal(changed.status, 0);
  assert.match(changed.stdout, /Priority: must → could/);
  assert.equal(run("edit", id, "--priority", "none", "--write").status, 0);
  assert.ok(!("priority" in parseStoryMap(await read()).stories[0]));
  const wrong = run("edit", id, "--priority", "wont");
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /--priority must be must, should, could or none, not wont/);
});
