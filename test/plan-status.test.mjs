import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { checkStoryMap, getStoryMapForViewer, parseStoryMap, storyMapPlan } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/** A map with stories at every stage, in two releases. */
const map = (change = () => {}) => {
  const value = {
    version: 1,
    id: "plans",
    title: "Plans",
    settings: { plans: "docs/plans" },
    activities: [{ id: "prepare", title: "Prepare" }],
    releases: [{ id: "r1", title: "1.0: First" }, { id: "r2", title: "1.1: Second" }],
    stories: [
      { id: "S-1", title: "One", activity: "prepare", release: "r1", status: "shipped" },
      { id: "S-2", title: "Two", activity: "prepare", release: "r1", status: "shipped" },
      { id: "S-3", title: "Three", activity: "prepare", release: "r1", status: "merged" },
      { id: "S-4", title: "Four", activity: "prepare", release: "r2", status: "in-progress" },
      { id: "S-5", title: "Five", activity: "prepare", release: "r2", status: "planned" },
      { id: "S-6", title: "Six", activity: "prepare", release: "r2", status: "cut", statusReason: "Dropped." },
    ],
  };
  change(value);
  return stringify(value);
};

/** Checks one plan per status line and returns the status-line issues, by file. */
async function check(t, plans, source = map()) {
  const root = await mkdtemp(join(tmpdir(), "esm-plan-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs", "plans"), { recursive: true });
  for (const [name, text] of Object.entries(plans)) await writeFile(join(root, "docs", "plans", name), text);
  const result = await checkStoryMap(source, { root, plans: ["docs/plans"] });
  const found = {};
  for (const issue of result.issues.filter(issue => issue.rule.startsWith("plan-status-"))) {
    (found[issue.file.replace("docs/plans/", "")] ??= []).push(issue);
  }
  return { found, result, root };
}

const plan = status => `# Plan\n\nStatus: ${status}\n\nMore text.\n`;

test("ESM-160: a status line behind every story it names is a warning that names the status to use", async t => {
  const { found } = await check(t, {
    "behind.md": plan("in progress. The work is S-1 and S-3 in the **1.0: First** release of the map."),
    "proposed-shipped.md": plan("proposed. The work is S-1 and S-5."),
    "planned-in-progress.md": plan("planned. The work is S-4."),
  });
  const [behind] = found["behind.md"];
  assert.equal(behind.rule, "plan-status-behind");
  assert.equal(behind.severity, "warning");
  assert.equal(behind.line, 3);
  assert.equal(behind.message, "The status line says 'in progress', but in the map S-1 is shipped and S-3 is merged. Start the line with 'merged'.");
  assert.match(behind.help, /#check-plan-status-lines$/);
  // Proposed is behind once any story has shipped, even when others are still planned.
  assert.match(found["proposed-shipped.md"][0].message, /Start the line with 'in progress'\.$/);
  assert.match(found["planned-in-progress.md"][0].message, /S-4 is in progress\. Start the line with 'in progress'\.$/);
});

test("ESM-160: a status line that is current or ahead of the map, or names no stories, passes", async t => {
  const { found } = await check(t, {
    "current.md": plan("merged. The work is S-3."),
    "ahead.md": plan("shipped. The work is S-4 and S-5. Its estimate is agreed: 8 points."),
    "mixed.md": plan("in progress. The work is S-1, S-4 and S-5."),
    "proposed.md": plan("proposed. The work is S-3, S-4 and S-5, none shipped yet."),
    "cut.md": plan("planned. The work is S-5 and S-6."),
    "no-stories.md": plan("proposed. Planning only."),
    "dash.md": plan("in-progress, with notes. The work is S-4."),
  });
  assert.deepEqual(found, {});
});

test("ESM-160: words other than the map's statuses are reported once per plan", async t => {
  const { found } = await check(t, {
    "built.md": plan("built. The work is S-1. ESM-1 and S-2 are done."),
    "done.md": plan("done, released in 1.0."),
    "sentence.md": plan("S-1 to S-2 are merged."),
    "prefix.md": plan("shippedish. The work is S-1."),
  });
  for (const file of ["built.md", "done.md", "sentence.md", "prefix.md"]) {
    assert.equal(found[file]?.length, 1, `${file}: ${JSON.stringify(found[file])}`);
    assert.equal(found[file][0].rule, "plan-status-words");
    assert.match(found[file][0].message, /^The status line starts with words other than the map's statuses\. Start it with 'proposed', 'planned', 'in progress', 'merged', 'shipped', 'blocked' or 'cut'/);
  }
});

test("ESM-160: a release title the map no longer has is reported, with the title of the release that holds the stories", async t => {
  const { found } = await check(t, {
    "renamed.md": plan("shipped. The work is S-1 in the **1.0: Old name** release of the map."),
    "short.md": plan("shipped. The work is S-1 to S-2 in the **1.0** release, planned as the **Groundwork** release."),
    "current.md": plan("shipped. The work is S-1 in the **1.0: First** release. It is **not** a release name."),
    "other-map.md": plan("proposed. The work is OTHER-1 in the **Builder workflow** release of the map."),
  });
  assert.deepEqual(found["renamed.md"].map(issue => issue.message), [
    "The status line names the release '1.0: Old name', which the map no longer has. Use the title of the release that holds its stories: '1.0: First'.",
  ]);
  // A version, or bold text beside the word "release", is read as a release title.
  assert.deepEqual(found["short.md"].map(issue => issue.rule), ["plan-status-release", "plan-status-release"]);
  assert.equal(found["current.md"], undefined);
  // A line that names none of the map's stories, such as the guide's example, is not checked for its release.
  assert.equal(found["other-map.md"], undefined);
});

test("ESM-160: ranges such as S-1 to S-3 count every story between", async t => {
  const { found } = await check(t, {
    "range.md": plan("in progress. The work is S-1 to S-3."),
    "dash.md": plan("in progress. The work is S-1–S-3."),
  });
  assert.match(found["range.md"][0].message, /S-1 and S-2 are shipped and S-3 is merged/);
  assert.match(found["dash.md"][0].message, /S-1 and S-2 are shipped and S-3 is merged/);
});

test("ESM-160: files without a status line are skipped, and only the first status line outside fenced code is read", async t => {
  const { found, result } = await check(t, {
    "retro.md": "# Retro\n\nS-1 went well.\n",
    "fenced.md": "# Plan\n\n```yaml\nstatus: built\n```\n\nStatus: merged. The work is S-3.\n\nStatus: built.\n",
    "bold.md": "# Plan\n\n**Status:** done. The work is S-3.\n",
  });
  assert.equal(found["retro.md"], undefined);
  assert.equal(found["fenced.md"], undefined);
  assert.equal(found["bold.md"][0].rule, "plan-status-words");
  assert.equal(found["bold.md"][0].line, 3);
  assert.ok(result.valid, "status-line problems are warnings");
});

test("ESM-160: validate --plans prints the warnings with their rule, and --strict fails on them", async t => {
  const { root } = await check(t, { "stale.md": plan("in progress. The work is S-1.") });
  await writeFile(join(root, "map.yaml"), map());
  const run = (...args) => spawnSync(process.execPath, [cli, "validate", ...args, "--plans", "docs/plans", "map.yaml"], { cwd: root, encoding: "utf8" });
  const text = run();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stderr, /^docs\/plans\/stale\.md:3: warning: The status line says 'in progress', but in the map S-1 is shipped\. Start the line with 'shipped'\. \[plan-status-behind\]\n  help: \S+#check-plan-status-lines$/m);
  assert.equal(run("--strict").status, 1);
  const github = run("--format", "github");
  assert.match(github.stdout, /^::warning file=docs\/plans\/stale\.md,line=3,title=plan-status-behind::/m);
});

test("ESM-160: the plan story-map plan prints passes the status-line check", async t => {
  const source = map();
  const internal = getStoryMapForViewer(parseStoryMap(source), {}, { canViewInternal: () => true });
  const plans = {
    "new.md": storyMapPlan(internal, { stories: ["S-5"] }).markdown,
    "release.md": storyMapPlan(internal, { release: "r2" }).markdown,
    "started.md": storyMapPlan(internal, { stories: ["S-4", "S-5"] }).markdown,
    "built.md": storyMapPlan(internal, { stories: ["S-1", "S-3"] }).markdown,
    "partly-shipped.md": storyMapPlan(internal, { stories: ["S-1", "S-5"] }).markdown,
  };
  assert.match(plans["new.md"], /^Status: proposed\. The work is S-5 in the \*\*1\.1: Second\*\* release of the map\./m);
  assert.match(plans["built.md"], /^Status: merged\. /m);
  assert.match(plans["partly-shipped.md"], /^Status: in progress\. /m);
  const { found } = await check(t, plans, source);
  assert.deepEqual(found, {});
});

test("ESM-160: every plan in this repository passes the status-line check", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = await readFile(join(root, "product", "story-map.yaml"), "utf8");
  const result = await checkStoryMap(source, { root, plans: ["docs"] });
  assert.deepEqual(result.issues.filter(issue => issue.rule.startsWith("plan-status-")).map(issue => `${issue.file}: ${issue.message}`), []);
});
