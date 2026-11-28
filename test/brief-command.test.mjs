import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getStoryMapForViewer, parseStoryMap, storyMapBrief } from "auto-story-map";
import { createStoryMapMcpServer, storyMapMcpTools, storyMapMcpWriteTools } from "auto-story-map/mcp";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const map = `version: 1
id: brief-demo
title: Brief demo
activities:
  - id: build
    title: Build
releases:
  - id: now
    title: "1.0: Now"
  - id: later
    title: "1.1: Later"
stories:
  - id: ESM-1
    title: Planned work
    activity: build
    release: now
    status: planned
    estimate: 2
    notes: Keep it small.
    sources:
      - docs/plan.md#planned-work
  - id: ESM-2
    title: Work in progress
    activity: build
    release: now
    status: in-progress
  - id: ESM-3
    title: Already merged
    activity: build
    release: now
    status: merged
  - id: ESM-4
    title: Later work
    activity: build
    release: later
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

/** A scratch repository holding the map on main, with a code commit for ESM-2, a planning commit for ESM-4 and an open branch for ESM-1. */
async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "story-map-brief-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "product/story-map.yaml"), map);
  await writeFile(join(root, "docs/plan.md"), "# Plan\n\n## Planned work\n\nESM-1 is small.\n");
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Add the map");
  await writeFile(join(root, "work.js"), "export const work = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "ESM-2: Start the work");
  await writeFile(join(root, "product/story-map.yaml"), map.replace("title: Later work", "title: Later work\n    summary: Estimated."));
  git("commit", "-q", "-am", "ESM-4: Estimate the later work");
  git("checkout", "-q", "-b", "feat/esm-1-planned-work");
  await writeFile(join(root, "planned.js"), "export const planned = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "ESM-1: Begin");
  git("checkout", "-q", "main");
  return { root, git, read: () => readFile(join(root, "product/story-map.yaml"), "utf8"), mapOnMain: map.replace("title: Later work", "title: Later work\n    summary: Estimated.") };
}

const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

test("ESM-126: story-map brief prints the board's brief, with Git evidence in flight", async t => {
  const { root, read, mapOnMain } = await repository(t);
  const view = getStoryMapForViewer(parseStoryMap(mapOnMain), {}, { canViewInternal: () => true });

  // Without evidence it is the board's brief, word for word.
  const plain = run(root, "brief", "--no-evidence", "ESM-1");
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, storyMapBrief(view, { story: "ESM-1" }));

  const withGit = run(root, "brief", "ESM-2");
  assert.equal(withGit.status, 0, withGit.stderr);
  assert.match(withGit.stdout, /<in_flight>\nESM-2:\n {2}- commit [0-9a-f]{7} on \d{4}-\d\d-\d\d {2}ESM-2: Start the work\n<\/in_flight>/);
  const branch = run(root, "brief", "ESM-1");
  assert.match(branch.stdout, /^ {2}- branch feat\/esm-1-planned-work \([0-9a-f]{7}, \d{4}-\d\d-\d\d\)$/m);

  // A commit that only changes the map is planning, so it is counted, not listed as work in flight.
  const planning = run(root, "brief", "ESM-4");
  assert.match(planning.stdout, /<in_flight>\nESM-4:\n {2}- 1 commit changes only the map or plans, so no code has landed yet\n<\/in_flight>/);
  assert.doesNotMatch(planning.stdout, /Estimate the later work/);
  assert.equal(await read(), mapOnMain, "the map is never changed");
});

test("ESM-126: story-map brief takes several stories, a release or an activity, and --full", async t => {
  const { root } = await repository(t);
  const stories = run(root, "brief", "--no-evidence", "ESM-1", "ESM-4");
  assert.match(stories.stdout, /^Build stories ESM-1 and ESM-4 /);

  const release = run(root, "brief", "--no-evidence", "--release", "now");
  assert.match(release.stdout, /scope="release" target="now"/);
  assert.match(release.stdout, /^ESM-1 {2}Planned work$/m);
  assert.match(release.stdout, /^ESM-2 {2}Work in progress$/m);
  assert.match(release.stdout, /^- ESM-4 \(planned, release later\) {2}Later work$/m);

  const activity = run(root, "brief", "--no-evidence", "--activity", "build", "--read-first", "docs/plan.md");
  assert.match(activity.stdout, /scope="activity" target="build"/);
  assert.match(activity.stdout, /Read first:\n- docs\/plan\.md\n/);
  assert.match(activity.stdout, /^ESM-4 {2}Later work$/m);

  assert.doesNotMatch(run(root, "brief", "--no-evidence", "ESM-1").stdout, /Keep it small/);
  assert.match(run(root, "brief", "--no-evidence", "--full", "ESM-1").stdout, /^ {2}notes: Keep it small\.$/m);
});

test("ESM-126: story-map brief --format json prints the scope, targets, branch and sections", async t => {
  const { root } = await repository(t);
  const result = run(root, "brief", "--format", "json", "--release", "now");
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.format, "auto-story-map.brief");
  assert.equal(body.scope, "release");
  assert.deepEqual(body.for, ["now"]);
  assert.deepEqual(body.targets, ["ESM-1", "ESM-2"]);
  assert.equal(body.branch, "feat/now");
  assert.ok(body.sections.in_flight.some(line => /ESM-2: Start the work/.test(line)));
  assert.match(body.brief, /^Build release now /);
});

test("ESM-126: story-map brief exits 1 for an unknown ID and 2 without exactly one scope", async t => {
  const { root } = await repository(t);
  const missing = run(root, "brief", "ESM-99");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Story ESM-99 is not in the map/);
  assert.equal(run(root, "brief", "--activity", "nope").status, 1);
  assert.equal(run(root, "brief").status, 2);
  const both = run(root, "brief", "ESM-1", "--release", "now");
  assert.equal(both.status, 2);
  assert.match(both.stderr, /only one of them/);
  assert.equal(run(root, "brief", "--no-evidence", "--claims", "ESM-1").status, 2);
  assert.match(run(root, "help", "brief").stdout, /--activity <ID>/);
});

async function connect(t, options) {
  const server = createStoryMapMcpServer(options);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => client.close());
  return async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return { isError: response.isError === true, body: JSON.parse(response.content[0].text) };
  };
}

test("ESM-126: the MCP server's get_brief tool returns what story-map brief --format json prints", async t => {
  const { root } = await repository(t);
  assert.ok(storyMapMcpTools.includes("get_brief"));
  assert.ok(!storyMapMcpWriteTools.includes("get_brief"), "read-only servers keep it");
  const call = await connect(t, { root, readOnly: true });

  const story = await call("get_brief", { ids: ["ESM-2"] });
  assert.equal(story.isError, false);
  assert.deepEqual(story.body, JSON.parse(run(root, "brief", "--format", "json", "ESM-2").stdout));

  const activity = await call("get_brief", { activity: "build", full: true, evidence: false });
  assert.deepEqual(activity.body, JSON.parse(run(root, "brief", "--format", "json", "--full", "--no-evidence", "--activity", "build").stdout));

  const several = await call("get_brief", { ids: ["ESM-1", "ESM-4"], evidence: false });
  assert.equal(several.body.scope, "stories");

  const unknown = await call("get_brief", { release: "nope" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.body.error, /Release nope is not in the map/);
  const none = await call("get_brief", {});
  assert.equal(none.isError, true);
  assert.match(none.body.error, /exactly one of ids, release or activity/);
});
