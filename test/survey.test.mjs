import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { changelogVersions, suggestedReleaseId, surveyRepository, surveyTodosMaxItems, surveyTextMaxLength, tagVersion } from "auto-story-map";
import { markdownHeadings } from "../dist/references.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Alex Morgan",
  GIT_AUTHOR_EMAIL: "alex@example.com",
  GIT_COMMITTER_NAME: "Alex Morgan",
  GIT_COMMITTER_EMAIL: "alex@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const changelog = `# Changelog

## Unreleased

- **Refunds:** Cancel an order and get your money back.

## [1.1.0] - 2026-03-01

- Export orders as CSV.

### Fixes

- Totals round to the penny.

## 1.0.0

- First release.
- Checkout with a card.

## 0.9.0

- A preview for testers.
`;

async function files(root, entries) {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/**
 * A scratch shop repository with a changelog, docs, two plans (one done), code
 * with TODO and FIXME comments, and tags v1.0.0 (annotated), v1.1.0 and
 * deploy-march, which has no version.
 */
async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "story-map-survey-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, date = "2026-01-10T09:00:00Z") =>
    execFileSync("git", args, { cwd: root, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: "utf8" });
  const commit = async (entries, message, date) => {
    await files(root, entries);
    git(["add", "-A"], date);
    git(["commit", "-q", "-m", message], date);
  };
  git(["init", "-q", "-b", "main"]);
  await commit({
    "README.md": "# Shop\n\n## Getting started\n\nRun it.\n",
    "docs/checkout.md": "# Checkout\n\n## How payment works\n\n```md\n## Not a heading\n```\n\nRefunds\n-------\n\n## How payment works\n",
    "src/cart.js": "// TODO: keep the cart between visits\nexport const cart = [];\n",
  }, "Start the shop", "2026-01-10T09:00:00Z");
  git(["tag", "-a", "v1.0.0", "-m", "1.0.0"], "2026-01-15T09:00:00Z");
  await commit({
    CHANGELOG: "not the changelog",
    "CHANGELOG.md": changelog,
    "docs/plans/refunds.md": "# Plan: refunds\n\nStatus: proposed. Needs a payment provider.\n",
    "docs/plans/csv-export.md": "# Plan: CSV export\n\n**Status:** done, released in 1.1.0.\n",
    "docs/ROADMAP.md": "# Roadmap\n\nNo status yet.\n",
    "src/orders.py": [
      "def total(order):",
      "    # FIXME: rounding is off for some currencies",
      "    return sum(order)",
      "message = 'TODO is not a comment here'",
      "/* TODO(alex): split this file */",
      "",
    ].join("\n"),
    "node_modules/pkg/index.js": "// TODO: never read\n",
    "dist/out.js": "// TODO: built, never read\n",
  }, "Add CSV export", "2026-03-01T09:00:00Z");
  git(["tag", "v1.1.0"], "2026-03-01T09:00:00Z");
  git(["tag", "deploy-march"], "2026-03-02T09:00:00Z");
  return { root, git };
}

test("ESM-118: joins release tags and changelog versions into suggested releases, oldest first", async t => {
  const { root, git } = await repository(t);
  const survey = await surveyRepository({ root });
  assert.deepEqual(survey.checked, ["git", "tags", "changelog", "docs", "plans", "todos"]);
  assert.equal(survey.history.commits, 2);
  assert.equal(survey.history.firstCommitAt.slice(0, 10), "2026-01-10");
  assert.equal(survey.history.lastCommitAt.slice(0, 10), "2026-03-01");

  assert.deepEqual(survey.releases.map(release => [release.suggestedId, release.version, release.tag?.name, release.changelog?.source]), [
    ["v0-9-0", "0.9.0", undefined, "CHANGELOG.md#090"],
    ["v1-0-0", "1.0.0", "v1.0.0", "CHANGELOG.md#100"],
    ["v1-1-0", "1.1.0", "v1.1.0", "CHANGELOG.md#110---2026-03-01"],
    ["deploy-march", "deploy-march", "deploy-march", undefined],
    ["unreleased", "Unreleased", undefined, "CHANGELOG.md#unreleased"],
  ]);
  const [preview, one, eleven, , unreleased] = survey.releases;
  assert.equal(preview.date, undefined, "no tag and no date in the heading");
  assert.equal(one.tag.commit, git(["rev-list", "-n", "1", "v1.0.0"]).trim(), "an annotated tag points to its commit");
  assert.equal(one.date.slice(0, 10), "2026-01-15");
  assert.deepEqual(one.changelog.entries, ["First release.", "Checkout with a card."]);
  assert.equal(eleven.changelog.date, "2026-03-01");
  assert.deepEqual(eleven.changelog.entries, ["Export orders as CSV.", "Totals round to the penny."], "subheadings stay in their version");
  assert.equal(unreleased.unreleased, true);
});

test("ESM-118: lists Markdown docs with their headings as sources, and plans that are not finished", async t => {
  const { root } = await repository(t);
  const survey = await surveyRepository({ root });
  assert.deepEqual(survey.docs.map(doc => doc.file), ["CHANGELOG.md", "README.md", "docs/ROADMAP.md", "docs/checkout.md", "docs/plans/csv-export.md", "docs/plans/refunds.md"]);
  const checkout = survey.docs.find(doc => doc.file === "docs/checkout.md");
  assert.equal(checkout.title, "Checkout");
  assert.deepEqual(checkout.headings, [
    { level: 1, text: "Checkout", source: "docs/checkout.md#checkout" },
    { level: 2, text: "How payment works", source: "docs/checkout.md#how-payment-works" },
    { level: 2, text: "Refunds", source: "docs/checkout.md#refunds" },
    { level: 2, text: "How payment works", source: "docs/checkout.md#how-payment-works-1" },
  ], "code fences are skipped, setext headings count and repeated headings get GitHub's suffix");

  assert.deepEqual(survey.plans, [
    { file: "docs/ROADMAP.md", title: "Roadmap" },
    { file: "docs/plans/refunds.md", title: "Plan: refunds", status: "proposed. Needs a payment provider." },
  ]);
  assert.equal(survey.closedPlans, 1, "a plan whose status says done is left out of plans, and stays in docs");

  const only = await surveyRepository({ root, docs: ["docs/plans"], plans: ["docs/plans/csv-export.md"] });
  assert.deepEqual(only.docs.map(doc => doc.file), ["docs/plans/csv-export.md", "docs/plans/refunds.md"]);
  assert.deepEqual(only.plans, []);
  assert.equal(only.closedPlans, 1);
});

test("ESM-118: lists TODO and FIXME comments with file and line, only after a comment marker", async t => {
  const { root } = await repository(t);
  const survey = await surveyRepository({ root });
  assert.deepEqual(survey.todos, [
    { file: "src/cart.js", line: 1, kind: "TODO", text: "keep the cart between visits" },
    { file: "src/orders.py", line: 2, kind: "FIXME", text: "rounding is off for some currencies" },
    { file: "src/orders.py", line: 5, kind: "TODO", text: "(alex): split this file" },
  ], "a string is not a comment, and node_modules and dist are skipped");
});

test("ESM-118: caps long lists and long text, and counts what it leaves out", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-survey-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const long = "x".repeat(surveyTextMaxLength * 2);
  await files(root, { "src/big.js": Array.from({ length: surveyTodosMaxItems + 5 }, (_, index) => `// TODO: ${index} ${long}`).join("\n") });
  const survey = await surveyRepository({ root });
  assert.equal(survey.todos.length, surveyTodosMaxItems);
  assert.equal(survey.moreTodos, 5);
  assert.equal(survey.todos[0].text.length, surveyTextMaxLength);
  assert.ok(survey.todos[0].text.endsWith("…"));
});

test("ESM-118: outside a Git checkout it still reports the changelog, docs, plans and comments, with notes", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-survey-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await files(root, { "changelog.md": changelog, "notes.md": "# Notes\n" });
  const survey = await surveyRepository({ root });
  assert.deepEqual(survey.checked, ["changelog", "docs", "plans", "todos"]);
  assert.equal(survey.history, undefined);
  assert.match(survey.notes[0], /Not a Git checkout/);
  assert.deepEqual(survey.releases.map(release => release.suggestedId), ["v0-9-0", "v1-0-0", "v1-1-0", "unreleased"]);
  assert.equal(survey.releases[0].changelog.source, "changelog.md#090");

  const empty = await mkdtemp(join(tmpdir(), "story-map-survey-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const nothing = await surveyRepository({ root: empty });
  assert.deepEqual([nothing.releases, nothing.docs, nothing.plans, nothing.todos], [[], [], [], []]);
  assert.ok(nothing.notes.some(note => /No CHANGELOG.md/.test(note)));
});

test("ESM-118: the survey command prints text or JSON and changes nothing", async t => {
  const { root, git } = await repository(t);
  const before = git(["status", "--porcelain"]);
  const text = spawnSync(process.execPath, [cli, "survey", "--root", root], { encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^History: {2}2 commits, 2026-01-10 to 2026-03-01$/m);
  assert.match(text.stdout, /^ {2}v1-0-0 {2}1\.0\.0 \(2026-01-15\) {2}tag v1\.0\.0, CHANGELOG\.md#100, 2 entries$/m);
  assert.match(text.stdout, /^Open plans: 2, and 1 finished plan left out$/m);
  assert.match(text.stdout, /^ {2}src\/orders\.py:2 {2}FIXME rounding is off for some currencies$/m);

  const json = spawnSync(process.execPath, [cli, "survey", "--format", "json", "--root", root, "--tags", "v*"], { encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  const document = JSON.parse(json.stdout);
  assert.equal(document.format, "auto-story-map.survey");
  assert.equal(document.version, 1);
  assert.deepEqual(document.releases.filter(release => release.tag).map(release => release.tag.name), ["v1.0.0", "v1.1.0"], "--tags narrows the tags read");
  assert.equal(git(["status", "--porcelain"]), before);
});

test("ESM-118: passes --tags to Git as a pattern, and refuses an empty pattern or a missing root or changelog", async t => {
  const { root } = await repository(t);
  const option = await surveyRepository({ root, tags: "--contains=HEAD" });
  assert.deepEqual(option.releases.filter(release => release.tag), [], "a pattern that looks like an option matches no tag");
  assert.ok(option.notes.includes("No tag matches --tags --contains=HEAD."));

  for (const args of [["--tags= "], ["--root", join(root, "missing")], ["--changelog", "HISTORY.md"], ["--changelog", "../outside.md"]]) {
    const result = spawnSync(process.execPath, [cli, "survey", "--root", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, /^story-map: /);
  }
  const usage = spawnSync(process.execPath, [cli, "survey", "--unknown"], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /story-map survey \[--format text\|json\]/);
});

test("ESM-118: escapes control characters from docs and comments in text output", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-survey-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await files(root, { "guide.md": "# Guide \u001b[31mred\n", "src/app.js": "// TODO: clear \u001b]0;title\u0007 the screen\n" });
  const result = spawnSync(process.execPath, [cli, "survey", "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /\u001b|\u0007/);
  assert.match(result.stdout, /Guide \\u001b\[31mred/);
  assert.match(result.stdout, /TODO clear \\u001b\]0;title\\u0007 the screen/);
});

test("ESM-118: reads version headings, tag versions and release IDs", () => {
  assert.deepEqual(changelogVersions("# Changes\n\n## v2.0.0-beta.1 (2026-05-01)\n\n- New\n  - Nested\n\n# Other\n\n- Not in a version\n", "CHANGES.md"), [
    { heading: "v2.0.0-beta.1 (2026-05-01)", source: "CHANGES.md#v200-beta1-2026-05-01", line: 3, date: "2026-05-01", entries: ["New"] },
  ]);
  assert.deepEqual(changelogVersions("# Notes\n\n## Install\n", "CHANGELOG.md"), []);
  assert.deepEqual(["v1.2.0", "pkg@1.2.0", "release-2.0", "v1.0.0-rc.1", "latest"].map(tagVersion), ["1.2.0", "1.2.0", "2.0", "1.0.0-rc.1", undefined]);
  assert.deepEqual(["0.7.5", "1.0.0-rc.1", "Unreleased", "deploy/March 2026", "---"].map(suggestedReleaseId), ["v0-7-5", "v1-0-0-rc-1", "unreleased", "deploy-march-2026", "release"]);
  assert.deepEqual(markdownHeadings("Title\n=====\n\n#### Deep `code` [link](x)\n").map(({ level, text, anchor, line }) => [level, text, anchor, line]), [
    [1, "Title", "title", 1],
    [4, "Deep code link", "deep-code-link", 4],
  ]);
});
