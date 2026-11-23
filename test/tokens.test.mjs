import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { branchNamesStory, countStoryTokens, diffStoryMaps, getStoryMapForViewer, formatStoryMapDiff, parseStoryMap, proposeStoryMapEdit } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const ownMap = await readFile(new URL("../product/story-map.yaml", import.meta.url), "utf8");

/** One assistant log line as Claude Code writes it, one per content block. */
function response({ id, session = "s1", branch, input = 0, output = 0, cacheWrite = 0, cacheRead = 0, at = "2026-11-20T10:00:00.000Z" }) {
  return JSON.stringify({
    type: "assistant", sessionId: session, gitBranch: branch, timestamp: at, requestId: `req-${id}`, uuid: `${id}-${Math.random()}`,
    message: { id, role: "assistant", usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead } },
  });
}

/** A scratch home with a Claude Code projects folder and a copy of the map. */
async function scratch(t, files) {
  const root = await mkdtemp(join(tmpdir(), "story-map-tokens-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  for (const [path, lines] of Object.entries(files)) {
    await mkdir(join(logs, path, ".."), { recursive: true });
    await writeFile(join(logs, path), `${lines.join("\n")}\n`);
  }
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), ownMap);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  return { root, logs, run };
}

test("ESM-144: a branch names a story only when it contains the whole ID", () => {
  assert.equal(branchNamesStory("feat/esm-144-record-tokens", "ESM-144"), true);
  assert.equal(branchNamesStory("ESM-144", "ESM-144"), true);
  assert.equal(branchNamesStory("fix/esm-1440-other", "ESM-144"), false);
  assert.equal(branchNamesStory("fix/xesm-144", "ESM-144"), false);
  assert.equal(branchNamesStory("main", "ESM-144"), false);
});

test("ESM-144: counts each response once, on branches named for the story, in subagent logs too", async t => {
  const { logs } = await scratch(t, {
    "-repo/a.jsonl": [
      JSON.stringify({ type: "user", sessionId: "s1", gitBranch: "feat/esm-144-tokens", message: { role: "user", content: "hi" } }),
      response({ id: "m1", branch: "feat/esm-144-tokens", input: 10, output: 5, cacheWrite: 100, cacheRead: 1000 }),
      // The same response again, for its second content block, with the final output count.
      response({ id: "m1", branch: "feat/esm-144-tokens", input: 10, output: 7, cacheWrite: 100, cacheRead: 1000 }),
      response({ id: "m2", branch: "main", input: 99, output: 99 }),
      response({ id: "m3", branch: "fix/esm-1440", input: 99 }),
      "not json {\"usage\"",
    ],
    "-repo/a/subagents/agent-1.jsonl": [
      response({ id: "m4", branch: "feat/esm-144-tokens", input: 1, output: 2, at: "2026-11-21T09:00:00.000Z" }),
    ],
    "-other/b.jsonl": [
      response({ id: "m5", session: "s2", branch: "claude/generated-name", output: 50, at: "2026-11-19T08:00:00.000Z" }),
    ],
  });
  const usage = await countStoryTokens("ESM-144", { logs });
  assert.deepEqual(
    { total: usage.total, input: usage.input, output: usage.output, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead, messages: usage.messages, files: usage.files },
    { total: 11 + 9 + 100 + 1000, input: 11, output: 9, cacheWrite: 100, cacheRead: 1000, messages: 2, files: 3 },
  );
  assert.deepEqual(usage.branches, ["feat/esm-144-tokens"]);
  assert.deepEqual(usage.sessions, ["s1"]);
  assert.equal(usage.lastAt, "2026-11-21T09:00:00.000Z");

  const wider = await countStoryTokens("ESM-144", { logs, sessions: ["s2"] });
  assert.equal(wider.total, usage.total + 50);
  assert.equal(wider.firstAt, "2026-11-19T08:00:00.000Z");
  assert.equal((await countStoryTokens("ESM-144", { logs, branches: ["main"] })).input, 11 + 99);
});

test("ESM-144: a missing logs folder counts nothing", async () => {
  const usage = await countStoryTokens("ESM-144", { logs: join(tmpdir(), "story-map-no-such-folder") });
  assert.equal(usage.files, 0);
  assert.equal(usage.messages, 0);
  assert.equal(usage.total, 0);
});

test("ESM-144: story-map tokens prints the count, the PR section and JSON, and fails when it finds nothing", async t => {
  const { logs, run } = await scratch(t, { "-repo/a.jsonl": [response({ id: "m1", branch: "feat/esm-144-tokens", input: 1200, output: 34, cacheRead: 1_000_000 })] });
  const text = run("tokens", "--logs", logs, "ESM-144");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ESM-144 {2}1,001,234 tokens in 1 response across 1 session/);
  assert.match(text.stderr, /story-map edit ESM-144 --tokens 1001234 --write/);

  const markdown = run("tokens", "--format", "markdown", "--logs", logs, "ESM-144");
  assert.match(markdown.stdout, /^## Tokens used\n\nESM-144: \*\*1,001,234 tokens\*\* in 1 Claude Code session/);
  assert.match(markdown.stdout, /Branches: `feat\/esm-144-tokens`/);

  const json = JSON.parse(run("tokens", "--format=json", "--logs", logs, "ESM-144").stdout);
  assert.equal(json.format, "auto-story-map.tokens");
  assert.equal(json.total, 1_001_234);

  const none = run("tokens", "--logs", logs, "ESM-105");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /found no Claude Code usage/);
  assert.equal(none.stdout, "");

  const unknown = run("tokens", "--logs", logs, "ESM-9999");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /no story with this ID/);
  assert.equal(run("tokens", "ESM-144", "ESM-105").status, 2);
});

test("ESM-144: edit --tokens records the count, shown in the internal view and the diff but never to customers", async t => {
  const result = await proposeStoryMapEdit(ownMap, [{ op: "tokens", id: "ESM-105", tokens: 1_843_920 }]);
  assert.equal(result.valid, true);
  assert.match(result.lineDiff, /\n\+ {4}tokens: 1843920\n/);
  assert.match(result.summary, /Tokens used: none → 1,843,920/);
  const map = parseStoryMap(result.source);
  assert.equal(getStoryMapForViewer(map, { id: "e", roles: ["engineer"] }).stories.find(story => story.id === "ESM-105").tokens, 1_843_920);
  const customer = getStoryMapForViewer(map, { id: "c", roles: [] });
  assert.notEqual(customer.audience, "internal");
  assert.equal(JSON.stringify(customer).includes("1843920"), false);
  assert.deepEqual(diffStoryMaps(map, map).stories.updated, []);
  assert.doesNotMatch(formatStoryMapDiff(diffStoryMaps(parseStoryMap(ownMap), map)), /Customer-facing/);

  await assert.rejects(proposeStoryMapEdit(ownMap, [{ op: "tokens", id: "ESM-105", tokens: -1 }]), /tokens/);
  const { run } = await scratch(t, {});
  assert.equal(run("edit", "ESM-105", "--tokens", "1,843,920").status, 0);
  const bad = run("edit", "ESM-105", "--tokens", "lots");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--tokens must be a whole number/);
});
