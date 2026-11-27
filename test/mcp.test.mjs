import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStoryMapMcpServer, storyMapMcpTools, storyMapMcpWriteTools } from "auto-story-map/mcp";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const map = `version: 1
id: mcp-demo
title: MCP demo
activities:
  - id: build
    title: Build
releases:
  - id: now
    title: Now
  - id: later
    title: Later
stories:
  # Kept as it is by every edit.
  - id: ESM-1
    title: Planned work
    activity: build
    release: now
    status: planned
  - id: ESM-2
    title: Work in progress
    activity: build
    release: now
    status: in-progress
    dependsOn:
      - ESM-1
  - id: ESM-3
    title: Already merged
    activity: build
    release: later
    status: merged
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

/** A scratch repository holding the map, with one commit on main. */
async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "story-map-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"), { recursive: true });
  await writeFile(join(root, "product/story-map.yaml"), map);
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "Add the map");
  return { root, git, read: () => readFile(join(root, "product/story-map.yaml"), "utf8") };
}

/** A client connected to a server in this process. */
async function connect(t, options) {
  const server = createStoryMapMcpServer(options);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => client.close());
  return {
    client,
    /** Calls a tool and parses its JSON result. */
    async call(name, args = {}) {
      const response = await client.callTool({ name, arguments: args });
      const text = response.content[0].text;
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { text };
      }
      return { isError: response.isError === true, body };
    },
  };
}

function cliJson(cwd, args) {
  try {
    return JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" }));
  } catch (error) {
    return JSON.parse(error.stdout);
  }
}

test("ESM-116: lists the tools that wrap the CLI, and a read-only server leaves out the ones that write", async t => {
  const { root } = await repository(t);
  const { client } = await connect(t, { root });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [...storyMapMcpTools]);
  assert.ok(!tools.some(tool => /confirm/.test(tool.name)), "no tool confirms drafts");
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, !storyMapMcpWriteTools.includes(tool.name), tool.name);

  const readOnly = await connect(t, { root, readOnly: true });
  const listed = (await readOnly.client.listTools()).tools.map(tool => tool.name);
  assert.deepEqual(listed, storyMapMcpTools.filter(name => !storyMapMcpWriteTools.includes(name)));
});

test("ESM-116: reads stories and releases in the same JSON as story, stories and releases --format json", async t => {
  const { root } = await repository(t);
  const { call } = await connect(t, { root });

  const story = await call("get_story", { ids: ["ESM-2", "ESM-22"] });
  assert.equal(story.isError, false, "a found story with a missing one is not an error");
  assert.deepEqual(story.body, cliJson(root, ["story", "--format", "json", "ESM-2", "ESM-22"]));
  assert.equal(story.body.stories[0].readiness.state, "waiting");
  assert.equal(story.body.missing[0].id, "ESM-22");
  assert.equal((await call("get_story", { ids: ["ESM-22"] })).isError, true, "only missing stories is an error");

  const ready = await call("list_stories", { readiness: ["ready"] });
  assert.deepEqual(ready.body, cliJson(root, ["stories", "--format", "json", "--readiness", "ready"]));
  assert.deepEqual(ready.body.stories.map(item => item.id), ["ESM-1"]);
  assert.deepEqual((await call("list_stories", { query: "merged", status: ["all"] })).body.stories.map(item => item.id), ["ESM-3"]);

  const unknown = await call("list_stories", { release: ["never"] });
  assert.equal(unknown.isError, true);
  assert.match(unknown.body.error, /no release with this ID/);

  const releases = await call("list_releases", { ids: ["later"] });
  assert.deepEqual(releases.body, cliJson(root, ["releases", "--format", "json", "later"]));
});

test("ESM-116: propose_edit is a dry run unless write is set, and writes only a valid map", async t => {
  const { root, read } = await repository(t);
  const { call } = await connect(t, { root });

  const dryRun = await call("propose_edit", { operations: [{ op: "status", id: "ESM-1", status: "in-progress" }] });
  assert.equal(dryRun.isError, false);
  assert.equal(dryRun.body.format, "auto-story-map.edit");
  assert.equal(dryRun.body.written, false);
  assert.match(dryRun.body.lineDiff, /-    status: planned\n\+    status: in-progress/);
  assert.match(dryRun.body.summary, /`ESM-1` Planned work \| Status: Planned → \*\*In progress\*\*/);
  assert.equal(await read(), map, "nothing written");

  const written = await call("propose_edit", { operations: [{ op: "status", id: "ESM-1", status: "in-progress" }], write: true });
  assert.equal(written.body.written, true);
  const after = await read();
  assert.match(after, /id: ESM-1\n    title: Planned work\n    activity: build\n    release: now\n    status: in-progress/);
  assert.match(after, /# Kept as it is by every edit\./, "comments are kept");

  const invalid = await call("propose_edit", { operations: [{ op: "release", id: "ESM-2", release: "never" }], write: true });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.body.written, false);
  assert.equal(invalid.body.valid, false);
  assert.equal(await read(), after, "an invalid result is never written");

  const impact = await call("propose_edit", { operations: [{ op: "release-impact", release: "now", metric: "Agents starting the same story", expected: "None" }], write: true });
  assert.equal(impact.body.written, true);
  assert.match(await read(), /expected: None\n        draft: true/, "impact an agent drafts stays a draft");
});

test("ESM-116: propose_edit refuses what edit refuses, and offers no persona edits or deletes", async t => {
  const { root, read } = await repository(t);
  const { client, call } = await connect(t, { root });

  const customer = await call("propose_edit", { operations: [{ op: "customer-title", id: "ESM-1", title: "Shiny" }], write: true });
  assert.equal(customer.isError, true);
  assert.equal(customer.body.written, false);
  assert.match(customer.body.refused.message, /customer/i);

  const cut = await call("propose_edit", { operations: [{ op: "status", id: "ESM-1", status: "cut" }], write: true });
  assert.equal(cut.isError, true);
  assert.match(cut.body.refused.message, /reason/);

  const { tools } = await client.listTools();
  const ops = tools.find(tool => tool.name === "propose_edit").inputSchema.properties.operations.items.oneOf.map(option => option.properties.op.const);
  assert.ok(ops.includes("status") && ops.includes("add") && ops.includes("release-impact"));
  for (const op of ["delete-job", "create-job", "create-persona", "set-persona", "set-persona-context", "set-job"]) assert.ok(!ops.includes(op), `${op} is not offered`);
  const deleted = await client.callTool({ name: "propose_edit", arguments: { operations: [{ op: "delete-job", job: "anything" }], write: true } });
  assert.equal(deleted.isError, true);
  assert.equal(await read(), map, "nothing was written");
});

test("ESM-116: every path a tool is given stays inside the repository root", async t => {
  const { root } = await repository(t);
  const outside = await mkdtemp(join(tmpdir(), "story-map-mcp-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "story-map.yaml"), map);
  await symlink(outside, join(root, "linked"));
  const { call } = await connect(t, { root });

  for (const [name, args] of [
    ["get_story", { ids: ["ESM-1"], map: "../story-map.yaml" }],
    ["validate_map", { map: join(outside, "story-map.yaml") }],
    ["validate_map", { plans: ["../"] }],
    ["propose_edit", { map: "linked/story-map.yaml", operations: [{ op: "title", id: "ESM-1", title: "Moved" }], write: true }],
    ["get_evidence", { history: "../history.json" }],
    ["claim_story", { id: "ESM-1", agent: "agent-a", store: "../claims" }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, true, name);
    assert.match(result.body.error, /outside the repository/, name);
  }
  assert.equal(await readFile(join(outside, "story-map.yaml"), "utf8"), map);
});

test("ESM-116: validate_map reports issues as validate --format json does", async t => {
  const { root } = await repository(t);
  await writeFile(join(root, "product/story-map.yaml"), map.replace("release: later", "release: never"));
  const { call } = await connect(t, { root });
  const result = await call("validate_map");
  assert.equal(result.body.format, "auto-story-map.validation");
  assert.equal(result.body.valid, false);
  const cliResult = cliJson(root, ["validate", "--format", "json", "product/story-map.yaml"]);
  assert.deepEqual(result.body.maps[0].issues, cliResult.maps[0].issues);

  const read = await call("get_story", { ids: ["ESM-1"] });
  assert.equal(read.isError, true, "an invalid map cannot be read");
  assert.equal(read.body.valid, false);
  assert.ok(read.body.issues.length);
});

test("ESM-159: validate_map returns each issue's rule and help link", async t => {
  const { root } = await repository(t);
  await writeFile(join(root, "product/story-map.yaml"), map.replace("release: later", "release: never"));
  const { call } = await connect(t, { root });
  const issue = (await call("validate_map")).body.maps[0].issues.find(found => found.severity === "error");
  assert.equal(issue.rule, "unknown-reference");
  assert.match(issue.help, /docs\/story-map\.md#validate-a-change$/);
});

test("ESM-116: claim_story claims a story once, and tells a second agent who holds it", async t => {
  const { root } = await repository(t);
  const { call } = await connect(t, { root });
  const store = ".story-map/claims";

  const claimed = await call("claim_story", { id: "ESM-1", agent: "agent-a", ttl: "2h", store, branch: "feat/esm-1-work" });
  assert.equal(claimed.isError, false);
  assert.equal(claimed.body.format, "auto-story-map.claim");
  assert.equal(claimed.body.claim.agent, "agent-a");
  assert.equal(Date.parse(claimed.body.claim.expiresAt) - Date.parse(claimed.body.claim.claimedAt), 2 * 60 * 60 * 1000);

  const clash = await call("claim_story", { id: "ESM-1", agent: "agent-b", store });
  assert.equal(clash.isError, true);
  assert.equal(clash.body.held.agent, "agent-a");
  assert.match(clash.body.message, /ESM-1 is claimed by agent-a/);

  const finished = await call("claim_story", { id: "ESM-3", agent: "agent-b", store });
  assert.equal(finished.isError, true, "a merged story cannot be claimed");
  assert.ok(finished.body.error);

  const evidence = await call("get_evidence", { ids: ["ESM-1"], claimsStore: store });
  assert.equal(evidence.body.stories[0].claim.agent, "agent-a");
});

test("ESM-116: get_evidence reports a story's commits and suggests a status without changing the map", async t => {
  const { root, git, read } = await repository(t);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/work.js"), "export const work = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "ESM-2: Do the work");
  const { call } = await connect(t, { root });
  const result = await call("get_evidence", { ids: ["ESM-2"] });
  assert.equal(result.isError, false);
  assert.deepEqual(result.body, cliJson(root, ["evidence", "--format", "json", "ESM-2"]));
  assert.equal(result.body.stories[0].suggestedStatus, "merged");
  assert.equal(await read(), map);
});

test("ESM-116: story-map mcp serves the tools over standard input and output", async t => {
  const { root } = await repository(t);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--read-only"], cwd: root, env, stderr: "pipe" }));
  t.after(() => client.close());
  assert.equal(client.getServerVersion().name, "story-map");
  assert.match(client.getInstructions(), /only a person confirms them/);
  const { tools } = await client.listTools();
  assert.ok(!tools.some(tool => tool.name === "propose_edit"), "read-only");
  const response = await client.callTool({ name: "get_story", arguments: { ids: ["ESM-1"] } });
  assert.equal(JSON.parse(response.content[0].text).stories[0].title, "Planned work");
});

test("ESM-116: story-map mcp exits 1 when there is no map, without starting a server", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-mcp-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  try {
    execFileSync(process.execPath, [cli, "mcp"], { cwd: root, env, encoding: "utf8", stdio: "pipe" });
    assert.fail("expected exit 1");
  } catch (error) {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /no map here/);
  }
});
