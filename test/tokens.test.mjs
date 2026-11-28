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
// A story in this repository's map with no tokens or cost recorded yet, so each edit shows as "none → …".
const untracked = parseStoryMap(ownMap).stories.find(story => story.tokens === undefined && story.estimatedCostUsd === undefined).id;

/** One assistant log line as Claude Code writes it, one per content block. */
function response({ id, session = "s1", branch, model, speed, input = 0, output = 0, cacheWrite = 0, cacheWrite1h, cacheRead = 0, at = "2026-11-20T10:00:00.000Z" }) {
  const usage = { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead };
  if (cacheWrite1h !== undefined) usage.cache_creation = { ephemeral_5m_input_tokens: cacheWrite - cacheWrite1h, ephemeral_1h_input_tokens: cacheWrite1h };
  if (speed) usage.speed = speed;
  return JSON.stringify({
    type: "assistant", sessionId: session, gitBranch: branch, timestamp: at, requestId: `req-${id}`, uuid: `${id}-${Math.random()}`,
    message: { id, role: "assistant", ...(model ? { model } : {}), usage },
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

test("ESM-145: a branch names a story only when it contains the whole ID", () => {
  assert.equal(branchNamesStory("feat/esm-145-record-tokens", "ESM-145"), true);
  assert.equal(branchNamesStory("ESM-145", "ESM-145"), true);
  assert.equal(branchNamesStory("fix/esm-1450-other", "ESM-145"), false);
  assert.equal(branchNamesStory("fix/xesm-145", "ESM-145"), false);
  assert.equal(branchNamesStory("main", "ESM-145"), false);
});

test("ESM-145: counts each response once, on branches named for the story, in subagent logs too", async t => {
  const { logs } = await scratch(t, {
    "-repo/a.jsonl": [
      JSON.stringify({ type: "user", sessionId: "s1", gitBranch: "feat/esm-145-tokens", message: { role: "user", content: "hi" } }),
      response({ id: "m1", branch: "feat/esm-145-tokens", input: 10, output: 5, cacheWrite: 100, cacheRead: 1000 }),
      // The same response again, for its second content block, with the final output count.
      response({ id: "m1", branch: "feat/esm-145-tokens", input: 10, output: 7, cacheWrite: 100, cacheRead: 1000 }),
      response({ id: "m2", branch: "main", input: 99, output: 99 }),
      response({ id: "m3", branch: "fix/esm-1450", input: 99 }),
      "not json {\"usage\"",
    ],
    "-repo/a/subagents/agent-1.jsonl": [
      response({ id: "m4", branch: "feat/esm-145-tokens", input: 1, output: 2, at: "2026-11-21T09:00:00.000Z" }),
    ],
    "-other/b.jsonl": [
      response({ id: "m5", session: "s2", branch: "claude/generated-name", output: 50, at: "2026-11-19T08:00:00.000Z" }),
    ],
  });
  const usage = await countStoryTokens("ESM-145", { logs });
  assert.deepEqual(
    { total: usage.total, input: usage.input, output: usage.output, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead, messages: usage.messages, files: usage.files },
    { total: 11 + 9 + 100 + 1000, input: 11, output: 9, cacheWrite: 100, cacheRead: 1000, messages: 2, files: 3 },
  );
  assert.deepEqual(usage.branches, ["feat/esm-145-tokens"]);
  assert.deepEqual(usage.sessions, ["s1"]);
  assert.equal(usage.lastAt, "2026-11-21T09:00:00.000Z");

  const wider = await countStoryTokens("ESM-145", { logs, sessions: ["s2"] });
  assert.equal(wider.total, usage.total + 50);
  assert.equal(wider.firstAt, "2026-11-19T08:00:00.000Z");
  assert.equal((await countStoryTokens("ESM-145", { logs, branches: ["main"] })).input, 11 + 99);
});

test("ESM-145: a missing logs folder counts nothing", async () => {
  const usage = await countStoryTokens("ESM-145", { logs: join(tmpdir(), "story-map-no-such-folder") });
  assert.equal(usage.files, 0);
  assert.equal(usage.messages, 0);
  assert.equal(usage.total, 0);
});

test("ESM-145: story-map tokens prints the count, the PR section and JSON, and fails when it finds nothing", async t => {
  const { logs, run } = await scratch(t, { "-repo/a.jsonl": [response({ id: "m1", branch: "feat/esm-145-tokens", input: 1200, output: 34, cacheRead: 1_000_000 })] });
  const text = run("tokens", "--logs", logs, "ESM-145");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ESM-145 {2}1,001,234 tokens in 1 response across 1 session/);
  // The log names no model, so there is no cost to record.
  assert.match(text.stderr, /story-map edit ESM-145 --tokens 1001234 --write/);
  assert.match(text.stdout, /Est\. cost: +unknown: unknown has no price/);

  const markdown = run("tokens", "--format", "markdown", "--logs", logs, "ESM-145");
  assert.match(markdown.stdout, /^## Tokens used\n\nESM-145: \*\*1,001,234 tokens\*\* in 1 Claude Code session/);
  assert.match(markdown.stdout, /Branches: `feat\/esm-145-tokens`/);

  const json = JSON.parse(run("tokens", "--format=json", "--logs", logs, "ESM-145").stdout);
  assert.equal(json.format, "auto-story-map.tokens");
  assert.equal(json.total, 1_001_234);

  const none = run("tokens", "--logs", logs, "ESM-105");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /found no Claude Code usage/);
  assert.equal(none.stdout, "");

  const unknown = run("tokens", "--logs", logs, "ESM-9999");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /no story with this ID/);
  assert.equal(run("tokens", "ESM-145", "ESM-105").status, 2);
});

test("ESM-145: edit --tokens records the count, shown in the internal view and the diff but never to customers", async t => {
  const result = await proposeStoryMapEdit(ownMap, [{ op: "tokens", id: untracked, tokens: 1_843_920 }]);
  assert.equal(result.valid, true);
  assert.match(result.lineDiff, /\n\+ {4}tokens: 1843920\n/);
  assert.match(result.summary, /Tokens used: none → 1,843,920/);
  const map = parseStoryMap(result.source);
  assert.equal(getStoryMapForViewer(map, { id: "e", roles: ["engineer"] }).stories.find(story => story.id === untracked).tokens, 1_843_920);
  const customer = getStoryMapForViewer(map, { id: "c", roles: [] });
  assert.notEqual(customer.audience, "internal");
  assert.equal(JSON.stringify(customer).includes("1843920"), false);
  assert.deepEqual(diffStoryMaps(map, map).stories.updated, []);
  assert.doesNotMatch(formatStoryMapDiff(diffStoryMaps(parseStoryMap(ownMap), map)), /Customer-facing/);

  await assert.rejects(proposeStoryMapEdit(ownMap, [{ op: "tokens", id: untracked, tokens: -1 }]), /tokens/);
  const { run } = await scratch(t, {});
  assert.equal(run("edit", untracked, "--tokens", "1,843,920").status, 0);
  const bad = run("edit", untracked, "--tokens", "lots");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--tokens must be a whole number/);
});

test("ESM-145: estimates the cost per response from its model, cache duration and speed", async t => {
  const M = 1_000_000;
  const { logs } = await scratch(t, {
    "-repo/a.jsonl": [
      // Opus 5.5: $4 in, $20 out, $0.20 cache reads, 5-minute writes 1.25 times input, 1-hour writes 2 times.
      response({ id: "m1", branch: "feat/esm-145", model: "claude-opus-5-5", input: M, output: M, cacheRead: M, cacheWrite: 2 * M, cacheWrite1h: M }),
      // The context-window suffix is ignored, and fast mode doubles the price.
      response({ id: "m2", branch: "feat/esm-145", model: "claude-opus-5-5[1m]", speed: "fast", output: M }),
      // Haiku 5.5 costs more once the prompt is over 100K tokens.
      response({ id: "m3", branch: "feat/esm-145", model: "claude-haiku-5-5", input: 200_000, output: M }),
      response({ id: "m4", branch: "feat/esm-145", model: "claude-new-model", output: 500 }),
      response({ id: "m5", branch: "feat/esm-145", model: "<synthetic>" }),
    ],
  });
  const usage = await countStoryTokens("ESM-145", { logs });
  const opus = 4 + 20 + 0.2 + 5 + 8;
  const fast = 40;
  const haiku = 0.2 * 0.5 + 2.5;
  assert.equal(usage.cost.usd, Math.round((opus + fast + haiku) * 100) / 100);
  assert.equal(usage.cost.unpricedTokens, 500);
  assert.deepEqual(usage.cost.unpricedModels, ["claude-new-model"]);
  assert.deepEqual(usage.cost.models.map(row => [row.model, row.fast ?? false, row.usd]), [
    ["claude-opus-5-5[1m]", true, 40],
    ["claude-opus-5-5", false, 37.2],
    ["claude-haiku-5-5", false, 2.6],
    ["claude-new-model", false, undefined],
  ]);
  const custom = await countStoryTokens("ESM-145", { logs, prices: { "claude-new-model": { input: 0, output: 2000, cacheRead: 0 } } });
  assert.equal(custom.cost.usd, 1);
  assert.deepEqual(custom.cost.unpricedModels, ["claude-haiku-5-5", "claude-opus-5-5", "claude-opus-5-5[1m]"]);
});

test("ESM-145: story-map tokens prints the cost and --prices replaces the built-in prices", async t => {
  const { root, logs, run } = await scratch(t, { "-repo/a.jsonl": [response({ id: "m1", branch: "feat/esm-145", model: "claude-sonnet-5-5", output: 1_000_000 })] });
  const text = run("tokens", "--logs", logs, "ESM-145");
  assert.match(text.stdout, /Est\. cost: +\$10\.00 at API list prices as of \d{4}-\d{2}-\d{2}/);
  assert.match(text.stderr, /--tokens 1000000 --estimated-cost 10\.00 --write/);
  assert.match(run("tokens", "--format", "markdown", "--logs", logs, "ESM-145").stdout, /Estimated cost: \*\*\$10\.00\*\* at API list prices/);
  await writeFile(join(root, "prices.json"), JSON.stringify({ "claude-sonnet-5-5": { input: 1, output: 5, cacheRead: 0.1 } }));
  const json = JSON.parse(run("tokens", "--format", "json", "--prices", "prices.json", "--logs", logs, "ESM-145").stdout);
  assert.equal(json.cost.usd, 5);
  assert.equal(json.prices, "prices.json");
  await writeFile(join(root, "bad.json"), JSON.stringify({ "claude-sonnet-5-5": { input: "cheap" } }));
  const bad = run("tokens", "--prices", "bad.json", "--logs", logs, "ESM-145");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /input must be a price/);
});

test("ESM-145: edit --estimated-cost records dollars to the cent, internal only", async t => {
  const result = await proposeStoryMapEdit(ownMap, [{ op: "estimated-cost", id: untracked, usd: 14.274 }]);
  assert.equal(result.valid, true);
  assert.match(result.lineDiff, /\n\+ {4}estimatedCostUsd: 14\.27\n/);
  assert.match(result.summary, /Estimated cost: none → \$14\.27/);
  const map = parseStoryMap(result.source);
  assert.equal(getStoryMapForViewer(map, { id: "e", roles: ["engineer"] }).stories.find(story => story.id === untracked).estimatedCostUsd, 14.27);
  assert.equal(JSON.stringify(getStoryMapForViewer(map, { id: "c", roles: [] })).includes("14.27"), false);
  const { run } = await scratch(t, {});
  assert.equal(run("edit", untracked, "--estimated-cost", "$1,204.50").status, 0);
  const bad = run("edit", untracked, "--estimated-cost", "about ten");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--estimated-cost must be an amount in US dollars/);
});

test("ESM-186: --since and --until count only the responses in that range, such as a review", async t => {
  const branch = "feat/esm-186-review";
  const model = "claude-opus-5-5";
  const { logs, run } = await scratch(t, {
    "-repo/a.jsonl": [
      response({ id: "build", branch, model, input: 1_000_000, output: 100_000, at: "2026-11-20T09:00:00.000Z" }),
      response({ id: "review", branch, model, input: 200_000, output: 20_000, at: "2026-11-20T10:45:00.000Z" }),
      response({ id: "fix", branch, model, input: 30_000, output: 3_000, at: "2026-11-20T11:30:00.000Z" }),
      // A response with no time can't be placed in a range.
      JSON.stringify({ type: "assistant", sessionId: "s1", gitBranch: branch, requestId: "req-untimed", message: { id: "untimed", model, usage: { input_tokens: 5_000_000 } } }),
    ],
  });

  const all = await countStoryTokens("ESM-186", { logs });
  assert.equal(all.total, 6_353_000);
  assert.equal(all.since, undefined);
  const since = await countStoryTokens("ESM-186", { logs, since: new Date("2026-11-20T10:42:00Z") });
  assert.deepEqual([since.total, since.messages, since.since], [253_000, 2, "2026-11-20T10:42:00.000Z"]);
  const review = await countStoryTokens("ESM-186", { logs, since: new Date("2026-11-20T10:42:00Z"), until: new Date("2026-11-20T11:00:00Z") });
  assert.deepEqual([review.total, review.firstAt, review.until], [220_000, "2026-11-20T10:45:00.000Z", "2026-11-20T11:00:00.000Z"]);
  assert.ok(review.cost.usd > 0 && review.cost.usd < since.cost.usd);
  await assert.rejects(countStoryTokens("ESM-186", { logs, since: new Date("not a time") }), RangeError);

  // The Markdown is a line for the Review section, not the story's Tokens used section.
  const markdown = run("tokens", "--format", "markdown", "--logs", logs, "--since", "2026-11-20T10:42:00Z", "--until", "2026-11-20T11:00:00Z", "ESM-186");
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /^- Review cost: \*\*220,000 tokens\*\*, estimated \$\d+\.\d\d at API list prices as of \d{4}-\d\d-\d\d, on ESM-186 from 2026-11-20 10:42 to 2026-11-20 11:00 UTC, in 1 Claude Code session\.\n$/);
  assert.doesNotMatch(markdown.stdout, /## Tokens used/);

  // The text says not to record part of the work as the story's total.
  const text = run("tokens", "--logs", logs, "--since", "2026-11-20T10:42:00Z", "ESM-186");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ESM-186 {2}253,000 tokens in 2 responses/);
  assert.match(text.stdout, /Counted: +from 2026-11-20 10:42 to now UTC/);
  assert.match(text.stderr, /Record it in the pull request's Review section, not with story-map edit --tokens\./);
  assert.doesNotMatch(text.stderr, /--tokens 253000/);

  const json = JSON.parse(run("tokens", "--format", "json", "--logs", logs, "--until", "2026-11-20T10:00:00Z", "ESM-186").stdout);
  assert.deepEqual([json.total, json.until, json.since], [1_100_000, "2026-11-20T10:00:00.000Z", undefined]);

  // Nothing in the range fails, as for nothing found at all, and bad times are refused.
  const none = run("tokens", "--logs", logs, "--since", "2026-11-21T00:00:00Z", "ESM-186");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /found no Claude Code usage on a branch named for it from 2026-11-21 00:00 to now UTC/);
  for (const args of [["--since", "yesterday"], ["--since", "2026-13-45"], ["--since", "2026-11-20T11:00:00Z", "--until", "2026-11-20T10:00:00Z"]]) {
    const refused = run("tokens", "--logs", logs, ...args, "ESM-186");
    assert.equal(refused.status, 2, args.join(" "));
  }
});
