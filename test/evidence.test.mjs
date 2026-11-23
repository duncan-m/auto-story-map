import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gatherStoryEvidence } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const day = 24 * 60 * 60 * 1000;

const map = `version: 1
id: evidence-demo
title: Evidence demo
activities:
  - id: build
    title: Build
releases:
  - id: now
    title: Now
stories:
  - id: ESM-1
    title: Has an open branch
    activity: build
    release: now
    status: planned
  - id: ESM-2
    title: Has merged code
    activity: build
    release: now
    status: in-progress
  - id: ESM-3
    title: Already merged
    activity: build
    release: now
    status: merged
  - id: ESM-4
    title: Cut after work landed
    activity: build
    release: now
    status: cut
    statusReason: Dropped in review.
  - id: ESM-5
    title: Shipped
    activity: build
    release: now
    status: shipped
  - id: ESM-6
    title: Stalled
    activity: build
    release: now
    status: in-progress
  - id: ESM-7
    title: Has a broken source
    activity: build
    release: now
    status: planned
    sources:
      - docs/plan.md#gone
      - docs/missing.md
  - id: ESM-8
    title: Only planned so far
    activity: build
    release: now
    status: planned
  - id: ESM-10
    title: A longer ID that starts like ESM-1
    activity: build
    release: now
    status: planned
`;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Alex Morgan",
  GIT_AUTHOR_EMAIL: "alex@example.com",
  GIT_COMMITTER_NAME: "Alex Morgan",
  GIT_COMMITTER_EMAIL: "alex@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

/**
 * A scratch repository on main with: a plan that mentions ESM-1 and ESM-8, a
 * test tagged ESM-2, a merged code commit for ESM-2 and ESM-4, a plan-only
 * commit for ESM-8, a code commit that mentions ESM-5 only below its title,
 * and an open branch for ESM-1.
 */
async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "story-map-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  const commit = async (files, message) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    }
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  git("init", "-q", "-b", "main");
  await commit({
    "product/story-map.yaml": map,
    "docs/plan.md": "# Plan\n\n## Steps\n\nBuild ESM-1 first, then ESM-8. ESM-1 again on this line.\n",
  }, "Add the map");
  await commit({ "src/feature.js": "export const two = 2;\n", "test/feature.test.mjs": 'test("ESM-2: adds the feature", () => {});\n' }, "ESM-2: Build the feature");
  await commit({ "src/cut.js": "export const four = 4;\n" }, "ESM-4: Start work that was later cut");
  await commit({ "docs/plan.md": "# Plan\n\n## Steps\n\nBuild ESM-1 first, then ESM-8.\n\nESM-8 needs a design.\n" }, "ESM-8: Plan the work");
  await commit({ "src/rename.js": "export const five = 5;\n" }, "Rename some files\n\nAlso touches ESM-5 and ESM-10.");
  git("switch", "-q", "-c", "feat/esm-1-open-branch");
  await commit({ "src/one.js": "export const one = 1;\n" }, "ESM-1: Start the branch");
  git("switch", "-q", "main");
  return { root, git };
}

const load = () => map;
const byId = result => new Map(result.stories.map(story => [story.id, story]));

test("ESM-105: reports branches, merged commits, plans, tests and broken sources for each story", async t => {
  const { root } = await repository(t);
  const result = await gatherStoryEvidence(load(), { root });
  assert.equal(result.defaultBranch, "main");
  assert.deepEqual(result.checked, ["git", "plans", "tests", "sources"]);
  const stories = byId(result);
  assert.deepEqual([...stories.keys()], ["ESM-1", "ESM-2", "ESM-3", "ESM-5", "ESM-6", "ESM-7", "ESM-8", "ESM-10"], "every active story, without cut ones");

  const one = stories.get("ESM-1");
  assert.deepEqual(one.branches.map(branch => [branch.name, branch.merged]), [["feat/esm-1-open-branch", false]]);
  assert.deepEqual(one.commits, [], "a commit on another branch is not merged work");
  assert.deepEqual(one.plans.map(plan => `${plan.file}:${plan.line}`), ["docs/plan.md:5"], "one entry for a line that mentions it twice");
  assert.equal(one.suggestedStatus, "in-progress");
  assert.match(one.reasons[0], /Branch feat\/esm-1-open-branch names the story and is not merged/);

  const two = stories.get("ESM-2");
  assert.deepEqual(two.commits.map(commit => [commit.subject, commit.named, commit.changes]), [["ESM-2: Build the feature", "title", "code"]]);
  assert.deepEqual(two.tests.map(found => [found.file, found.line, found.name]), [["test/feature.test.mjs", 1, "ESM-2: adds the feature"]]);
  assert.equal(two.suggestedStatus, "merged");

  const seven = stories.get("ESM-7");
  assert.deepEqual(seven.brokenSources.map(source => source.source), ["docs/plan.md#gone", "docs/missing.md"]);
  assert.match(seven.reasons.at(-1), /2 sources point to something that no longer exists/);
});

test("ESM-105: never suggests a status back from merged or shipped, a change to a cut story, or shipped", async t => {
  const { root } = await repository(t);
  const stories = byId(await gatherStoryEvidence(load(), { root, ids: ["ESM-2", "ESM-3", "ESM-4", "ESM-5"] }));
  assert.equal(stories.get("ESM-3").suggestedStatus, "merged", "merged with no evidence stays merged");
  assert.equal(stories.get("ESM-5").suggestedStatus, "shipped", "shipped stays shipped");
  const cut = stories.get("ESM-4");
  assert.equal(cut.commits.length, 1, "a cut story's evidence is still reported");
  assert.equal(cut.suggestedStatus, "cut");
  assert.match(cut.reasons[0], /cut, so evidence never changes its status/);
  for (const story of stories.values()) assert.notEqual(story.suggestedStatus === "shipped" && story.status !== "shipped", true);
});

test("ESM-105: plan-only commits and mentions below the title are reported but do not suggest merged", async t => {
  const { root } = await repository(t);
  const stories = byId(await gatherStoryEvidence(load(), { root, ids: ["ESM-8", "ESM-10"] }));
  const eight = stories.get("ESM-8");
  assert.deepEqual(eight.commits.map(commit => [commit.named, commit.changes]), [["title", "plans"]]);
  assert.equal(eight.suggestedStatus, "planned");
  const ten = stories.get("ESM-10");
  assert.deepEqual(ten.commits.map(commit => [commit.named, commit.changes]), [["message", "code"]]);
  assert.equal(ten.suggestedStatus, "planned");
});

test("ESM-105: an ID is never matched inside a longer one", async t => {
  const { root, git } = await repository(t);
  git("branch", "fix/esm-10-longer");
  git("branch", "fix/esm-1x-not-an-id");
  git("branch", "fix/xesm-1-not-an-id");
  const stories = byId(await gatherStoryEvidence(load(), { root, ids: ["ESM-1", "ESM-10"] }));
  assert.deepEqual(stories.get("ESM-1").branches.map(branch => branch.name), ["feat/esm-1-open-branch"]);
  assert.deepEqual(stories.get("ESM-10").branches.map(branch => branch.name), ["fix/esm-10-longer"]);
  assert.ok(!stories.get("ESM-1").commits.some(commit => /ESM-10/.test(commit.subject)), "ESM-10 in a message is not ESM-1");
  assert.equal(stories.get("ESM-10").plans.length, 0, "ESM-1 in a plan is not ESM-10");
});

test("ESM-105: flags stalled stories from history and reads merge commits by their pull request title", async t => {
  const { root, git } = await repository(t);
  git("switch", "-q", "-c", "feat/esm-6-stalled-work");
  await writeFile(join(root, "src/six.js"), "export const six = 6;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Do the work");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-ff", "feat/esm-6-stalled-work", "-m", "Merge pull request #12 from owner/feat/esm-6-stalled-work", "-m", "Finish the stalled work");
  const ago = days => new Date(Date.now() - days * day).toISOString();
  const history = {
    version: 1,
    generatedAt: ago(0),
    complete: true,
    events: [
      { storyId: "ESM-6", type: "added", to: "planned", at: ago(90), commit: "aaaaaaa" },
      { storyId: "ESM-6", type: "status", from: "planned", to: "in-progress", at: ago(60), commit: "bbbbbbb" },
    ],
  };
  const result = await gatherStoryEvidence(load(), { root, ids: ["ESM-6"], history });
  assert.ok(result.checked.includes("history"));
  const [six] = result.stories;
  assert.equal(six.stalled.afterWeeks, 4);
  assert.equal(six.stalled.since, history.events[1].at);
  assert.deepEqual(six.commits.map(commit => [commit.pullRequest, commit.named, commit.changes]), [[12, "title", "code"]], "the merge lists the files it brings in");
  assert.deepEqual(six.branches.map(branch => [branch.name, branch.merged]), [["feat/esm-6-stalled-work", true]]);
  assert.equal(six.suggestedStatus, "merged");
  assert.match(six.reasons.at(-1), /longer than the 4 week stalled threshold/);
});

test("ESM-105: the evidence command prints text or JSON, and changes nothing", async t => {
  const { root, git } = await repository(t);
  const run = (...args) => spawnSync(process.execPath, [cli, "evidence", ...args], { cwd: root, encoding: "utf8", env });
  const before = git("status", "--porcelain");

  const text = run("ESM-1", "ESM-2");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ESM-1 {2}Has an open branch$/m);
  assert.match(text.stdout, /^ {2}Status: {4}planned, suggests in-progress$/m);
  assert.match(text.stdout, /^ {4}feat\/esm-1-open-branch \([0-9a-f]{7}, \d{4}-\d\d-\d\d\)$/m);
  assert.match(text.stdout, /^ {2}Commits on main:\n {4}\d{4}-\d\d-\d\d {2}[0-9a-f]{7} ESM-2: Build the feature \[code\]$/m);
  assert.match(text.stdout, /^ {4}test\/feature\.test\.mjs:1 {2}ESM-2: adds the feature$/m);

  const json = run("--format", "json", "ESM-2");
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.format, "auto-story-map.evidence");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.stories[0].suggestedStatus, "merged");

  assert.equal(git("status", "--porcelain"), before, "nothing in the checkout changed");
});

test("ESM-105: unknown IDs exit 1 with suggestions, and a missing default branch exits 2", async t => {
  const { root } = await repository(t);
  const run = (...args) => spawnSync(process.execPath, [cli, "evidence", ...args], { cwd: root, encoding: "utf8", env });
  const unknown = run("ESM-1", "ESM-11");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /^ESM-1 /m);
  assert.match(unknown.stderr, /^ESM-11: no story with this ID in product\/story-map\.yaml\. Did you mean ESM-1, ESM-10/m);

  const branch = run("--default-branch", "trunk");
  assert.equal(branch.status, 2);
  assert.match(branch.stderr, /--default-branch trunk is not a branch or commit/);
  assert.equal(run("--default-branch=--output=x").status, 2, "a ref that looks like an option is refused");
  assert.equal(run("--nope").status, 2);
});

test("ESM-105: outside a Git checkout it still reports plans, tests and sources", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/plan.md"), "# Plan\n\nESM-1 comes first.\n");
  const result = await gatherStoryEvidence(load(), { root, ids: ["ESM-1"], tests: ["docs"] });
  assert.deepEqual(result.checked, ["plans", "tests", "sources"]);
  assert.match(result.notes[0], /Not a Git checkout/);
  assert.equal(result.defaultBranch, undefined);
  assert.equal(result.stories[0].plans.length, 1);
  assert.equal(result.stories[0].suggestedStatus, "planned");
});

test("ESM-105: escapes control characters from commit subjects in text output", async t => {
  const { root, git } = await repository(t);
  await writeFile(join(root, "src/escape.js"), "export const x = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "ESM-3: Fix \u001b[31mred\u001b[0m text");
  const result = spawnSync(process.execPath, [cli, "evidence", "ESM-3"], { cwd: root, encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\u001b/);
  assert.match(result.stdout, /ESM-3: Fix \\u001b\[31mred\\u001b\[0m text/);
});

/**
 * The scratch repository with ESM-2 merged too, then: tag v1.0.0 on ESM-2's
 * work, a later release v0.9.9 on main that also holds it, named so it sorts
 * first by name but not by date, an ESM-3 commit after both, and a tag that
 * does not match `v*` on ESM-3. Tags are dated a day apart.
 */
const releasedMap = map.replace("title: Has merged code\n    activity: build\n    release: now\n    status: in-progress", "title: Has merged code\n    activity: build\n    release: now\n    status: merged");

async function releasedRepository(t) {
  const { root, git } = await repository(t);
  const at = days => ({ ...env, GIT_COMMITTER_DATE: new Date(Date.UTC(2030, 0, 1) + days * day).toISOString() });
  const dated = (days, ...args) => execFileSync("git", args, { cwd: root, env: at(days), encoding: "utf8" });
  const two = git("log", "--format=%H", "-1", "--grep=^ESM-2:").trim();
  dated(0, "tag", "-a", "-m", "First release", "v1.0.0", two);
  dated(1, "tag", "-a", "-m", "Second release", "v0.9.9");
  await writeFile(join(root, "src/three.js"), "export const three = 3;\n");
  git("add", "-A");
  dated(2, "commit", "-q", "-m", "ESM-3: Finish the merged story");
  const three = git("rev-parse", "HEAD").trim();
  dated(3, "tag", "-a", "-m", "Nightly", "nightly-1", three);
  return { root, git, two, three };
}

test("ESM-107: suggests shipped for a merged story whose merging commit is in a matching tag", async t => {
  const { root, two, three } = await releasedRepository(t);
  const result = await gatherStoryEvidence(releasedMap, { root, ids: ["ESM-2", "ESM-3"], shippedTags: "v*" });
  assert.ok(result.checked.includes("tags"));
  const stories = byId(result);

  const shipped = stories.get("ESM-2");
  assert.equal(shipped.suggestedStatus, "shipped", "merged before a matching tag");
  assert.deepEqual(shipped.shippedIn, { tag: "v1.0.0", commit: two }, "the earliest matching tag that holds it");
  assert.match(shipped.reasons[0], /^Commit [0-9a-f]{7} is in tag v1\.0\.0, which matches v\*/);

  const waiting = stories.get("ESM-3");
  assert.equal(waiting.commits[0].commit, three);
  assert.equal(waiting.suggestedStatus, "merged", "merged after the last matching tag, and only in a tag that does not match");
  assert.equal(waiting.shippedIn, undefined);
  assert.match(waiting.reasons[0], /is not in any tag that matches v\* yet/);

  const nightly = byId(await gatherStoryEvidence(releasedMap, { root, ids: ["ESM-3"], shippedTags: "nightly-*" })).get("ESM-3");
  assert.equal(nightly.suggestedStatus, "shipped", "the pattern decides which tags count");
  assert.equal(nightly.shippedIn.tag, "nightly-1");
});

test("ESM-107: never suggests shipped without --shipped-tags, or for stories that are not merged", async t => {
  const { root } = await releasedRepository(t);
  const without = byId(await gatherStoryEvidence(releasedMap, { root, ids: ["ESM-2", "ESM-3"] }));
  for (const story of without.values()) {
    assert.equal(story.suggestedStatus, "merged");
    assert.equal(story.shippedIn, undefined);
  }
  const result = await gatherStoryEvidence(load(), { root, ids: ["ESM-2", "ESM-4"], shippedTags: "v*" });
  const stories = byId(result);
  assert.equal(stories.get("ESM-2").suggestedStatus, "merged", "an in-progress story in a tag moves only to merged");
  assert.equal(stories.get("ESM-4").suggestedStatus, "cut");
});

test("ESM-107: notes when no tag matches, and keeps a merged story with no merging commit as merged", async t => {
  const { root } = await repository(t);
  const result = await gatherStoryEvidence(releasedMap, { root, ids: ["ESM-2", "ESM-3"], shippedTags: "release-*" });
  assert.ok(result.notes.some(note => /No tag matches --shipped-tags release-\*/.test(note)));
  const stories = byId(result);
  assert.equal(stories.get("ESM-2").suggestedStatus, "merged");
  assert.match(stories.get("ESM-2").reasons[0], /no tag matches release-\*/);
  assert.equal(stories.get("ESM-3").suggestedStatus, "merged");
  assert.match(stories.get("ESM-3").reasons[0], /no commit on the default branch names it in its title and changes code/);
});

test("ESM-107: the evidence command takes --shipped-tags, passes it to Git as an argument and refuses an empty one", async t => {
  const { root, git } = await releasedRepository(t);
  await writeFile(join(root, "product/story-map.yaml"), releasedMap);
  git("commit", "-q", "-am", "Mark ESM-2 merged");
  const run = (...args) => spawnSync(process.execPath, [cli, "evidence", ...args], { cwd: root, encoding: "utf8", env });

  const text = run("--shipped-tags", "v*", "ESM-2");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ {2}Status: {4}merged, suggests shipped$/m);
  assert.match(text.stdout, /^ {2}Shipped in: v1\.0\.0 \([0-9a-f]{7}\)$/m);

  const json = JSON.parse(run("--format", "json", "--shipped-tags=v*", "ESM-2").stdout);
  assert.equal(json.stories[0].suggestedStatus, "shipped");
  assert.equal(json.stories[0].shippedIn.tag, "v1.0.0");

  const plain = run("ESM-2");
  assert.match(plain.stdout, /^ {2}Status: {4}merged, no change suggested$/m);
  assert.doesNotMatch(plain.stdout, /Shipped in/);

  const option = run("--shipped-tags=--contains", "ESM-2");
  assert.equal(option.status, 0, "a pattern that looks like an option is only a pattern");
  assert.match(option.stderr, /No tag matches --shipped-tags --contains/);
  assert.match(option.stdout, /merged, no change suggested/);

  const empty = run("--shipped-tags=", "ESM-2");
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /--shipped-tags needs a value/);
  await assert.rejects(gatherStoryEvidence(releasedMap, { root, shippedTags: " " }), /--shipped-tags needs a tag pattern/);
});
