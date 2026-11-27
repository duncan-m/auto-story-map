// Model-based tests of the claims protocol in src/claims.ts (ESM-165).
//
// fast-check runs random sequences of claim, renew, take-over, unclaim and
// clock moves by three agents, against a real temporary Git remote and
// against --store, and compares what the claims say after every step with a
// small in-memory model. A "race" step runs several agents' calls at the same time
// and checks the outcome matches the calls run one after the other, in some
// order, where a call may also lose because the claim changed under it.
//
// In Git mode agents A and B have their own clones and agent C is a worktree
// of A's clone, so it shares A's refs, as parallel worktree sessions do.
//
// Every call passes `now` from the model's clock, so expiry is deterministic.
// Runs are few because each step runs Git. For a longer run:
//   FC_NUM_RUNS=200 node --test test/claims.model.test.js
// A failure prints a seed and path; pass them to fc.assert to replay it.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { claimStory, listStoryClaims, releaseStoryClaim, StoryClaimError, StoryClaimHeldError } from "auto-story-map";
import { loadStoryMap } from "../dist/schema.js";

const runs = Number(process.env.FC_NUM_RUNS) || 0;
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const minute = 60_000;
const hour = 60 * minute;

const source = `version: 1
id: claims-model
title: Claims model
activities:
  - id: build
    title: Build
releases:
  - id: now
    title: Now
stories:
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
`;
const loaded = loadStoryMap(source);
const agents = ["agent-a", "agent-b", "agent-c"];
const stories = ["ESM-1", "ESM-2"];
const ttls = [minute, 30 * minute, 4 * hour];
const branchOf = agent => `feat/${agent}`;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Alex Morgan",
  GIT_AUTHOR_EMAIL: "alex@example.com",
  GIT_COMMITTER_NAME: "Alex Morgan",
  GIT_COMMITTER_EMAIL: "alex@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
// The library runs Git with this process's environment.
for (const [key, value] of Object.entries(env)) if (key.startsWith("GIT_")) process.env[key] = value;

/** A bare remote, two clones and a worktree of the first clone, each holding the map. */
async function scratch(mode) {
  const base = await mkdtemp(join(tmpdir(), "story-map-claims-model-"));
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  const bare = join(base, "remote.git");
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  const a = join(base, "a");
  git(base, "init", "-q", "-b", "main", a);
  await mkdir(join(a, "product"), { recursive: true });
  await writeFile(join(a, "product/story-map.yaml"), source);
  git(a, "add", "-A");
  git(a, "commit", "-q", "-m", "Add the map");
  git(a, "remote", "add", "origin", bare);
  git(a, "push", "-q", "origin", "main");
  if (mode === "store") {
    // Agents on one machine share the checkout and its store folder.
    const options = { root: a, store: ".story-map/claims" };
    return { base, options: () => options, roots: () => a, cliArgs: ["--store", ".story-map/claims"] };
  }
  const b = join(base, "b");
  git(base, "clone", "-q", bare, b);
  const c = join(base, "c");
  git(a, "worktree", "add", "-q", "-b", "feat/agent-c", c);
  const roots = { "agent-a": a, "agent-b": b, "agent-c": c };
  return { base, options: agent => ({ root: roots[agent], remote: "origin" }), roots: agent => roots[agent], cliArgs: [] };
}

// The model: the clock, and each story's claim as the protocol says it should be.

const view = (claim, now) => ({
  id: claim.id,
  agent: claim.agent,
  branch: claim.branch,
  claimedAt: new Date(claim.claimedAt).toISOString(),
  ...(claim.renewedAt !== undefined ? { renewedAt: new Date(claim.renewedAt).toISOString() } : {}),
  expiresAt: new Date(claim.expiresAt).toISOString(),
  expired: claim.expiresAt <= now,
});

/**
 * Applies one call to the model. Returns its outcome, `ok`, `held` (someone
 * else holds the claim: exit 3) or `error` (exit 1), and the claims after it.
 */
function step(claims, now, op) {
  const current = claims.get(op.story);
  const next = new Map(claims);
  const fresh = { id: op.story, agent: op.agent, branch: branchOf(op.agent), claimedAt: now, expiresAt: now + op.ttl };
  switch (op.type) {
    case "claim":
      if (current) return { kind: "held", holder: current };
      next.set(op.story, fresh);
      return { kind: "ok", claims: next, claim: fresh };
    case "renew":
      if (!current) return { kind: "error" };
      if (current.agent !== op.agent) return { kind: "held", holder: current };
      next.set(op.story, { ...fresh, claimedAt: current.claimedAt, renewedAt: now });
      return { kind: "ok", claims: next, claim: next.get(op.story), replaced: current };
    case "take-over":
      if (current && current.expiresAt > now) return { kind: "held", holder: current };
      next.set(op.story, fresh);
      return { kind: "ok", claims: next, claim: fresh, replaced: current };
    case "unclaim":
      if (!current) return { kind: "ok", claims: next };
      if (op.own && current.agent !== op.agent) return { kind: "held", holder: current };
      next.delete(op.story);
      return { kind: "ok", claims: next, released: current };
  }
  throw new Error(`Unknown call ${op.type}`);
}

const describe = op => op.type === "unclaim"
  ? `${op.agent} unclaim${op.own ? " --agent" : ""} ${op.story}`
  : `${op.agent} ${op.type} ${op.story} ttl ${op.ttl / minute}m`;

/** Runs one call for real, returning its outcome in the model's terms. */
async function perform(real, now, op) {
  const at = { ...real.options(op.agent), now: new Date(now) };
  try {
    const result = op.type === "unclaim"
      ? await releaseStoryClaim(op.story, op.own ? { ...at, agent: op.agent } : at)
      : await claimStory(loaded, op.story, { ...at, agent: op.agent, ttlMs: op.ttl, mode: op.type, branch: branchOf(op.agent) });
    return { kind: "ok", result };
  } catch (error) {
    if (error instanceof StoryClaimHeldError) return { kind: "held", error };
    if (error instanceof StoryClaimError) return { kind: "error", error };
    throw error;
  }
}

/** Checks the claims every agent reads against the model. */
async function compare(real, model, label) {
  const expected = [...model.claims.values()].map(claim => view(claim, model.now)).sort((x, y) => x.id.localeCompare(y.id));
  for (const agent of new Set(agents.map(agent => real.roots(agent)))) {
    const { claims } = await listStoryClaims({ ...real.options(agents.find(name => real.roots(name) === agent)), now: new Date(model.now) });
    assert.deepEqual(claims, expected, `${label}: the claims agree with the model`);
    assert.equal(new Set(claims.map(claim => claim.id)).size, claims.length, `${label}: at most one claim per story`);
  }
}

class Call {
  constructor(op) { this.op = op; }
  check() { return true; }
  async run(model, real) {
    const label = describe(this.op);
    const expected = step(model.claims, model.now, this.op);
    const actual = await perform(real, model.now, this.op);
    assert.equal(actual.kind, expected.kind, `${label}: ${actual.error?.message ?? "succeeded"}`);
    if (expected.kind === "held") {
      // A refused claim names the holder, so the agent can pick another story or ask them.
      assert.deepEqual(actual.error.claim, view(expected.holder, model.now), `${label}: the refusal names the holder`);
      assert.match(actual.error.message, new RegExp(`${this.op.story} is claimed by ${expected.holder.agent} `));
    }
    if (expected.kind === "ok") {
      if (expected.claim) assert.deepEqual(actual.result.claim, view(expected.claim, model.now), `${label}: the new claim`);
      const before = expected.replaced ?? expected.released;
      assert.deepEqual(actual.result.replaced ?? actual.result.released, before && view(before, model.now), `${label}: the claim it replaced`);
      model.claims = expected.claims;
    }
    await compare(real, model, label);
  }
  toString() { return describe(this.op); }
}

const orders = items => items.length <= 1 ? [items] : items.flatMap((item, index) => orders(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]));

/** Several agents' calls on one story at the same time. */
class Race {
  constructor(ops) { this.ops = ops; }
  check() { return true; }
  async run(model, real) {
    const label = this.toString();
    // Staggered starts let one call read the claim, another change it, and the first then write.
    const actual = await Promise.all(this.ops.map(async op => {
      await new Promise(done => setTimeout(done, op.delay));
      return perform(real, model.now, op);
    }));
    // Find an order of the calls that explains every outcome. A call may also
    // lose, with `held`, because an earlier call changed the claim after it read it.
    const explained = [];
    for (const order of orders(this.ops.map((_, index) => index))) {
      let claims = model.claims;
      let changed = false;
      let fits = true;
      for (const index of order) {
        const expected = step(claims, model.now, this.ops[index]);
        const outcome = actual[index];
        if (outcome.kind === "ok" && expected.kind === "ok") {
          claims = expected.claims;
          changed ||= Boolean(expected.claim || expected.released);
        } else if (outcome.kind !== expected.kind && !(outcome.kind === "held" && changed)) {
          fits = false;
        }
      }
      if (fits) explained.push(claims);
    }
    const outcomes = actual.map((outcome, index) => `${describe(this.ops[index])}: ${outcome.kind}${outcome.error ? ` (${outcome.error.message})` : ""}`).join("; ");
    assert.ok(explained.length, `${label}: no order of the calls explains ${outcomes}`);
    const { claims } = await listStoryClaims({ ...real.options(this.ops[0].agent), now: new Date(model.now) });
    const fit = explained.find(candidate => {
      const expected = [...candidate.values()].map(claim => view(claim, model.now)).sort((x, y) => x.id.localeCompare(y.id));
      try { assert.deepEqual(claims, expected); return true; } catch { return false; }
    });
    assert.ok(fit, `${label}: the claims after ${outcomes} match no order of the calls: ${JSON.stringify(claims)}`);
    model.claims = fit;
    await compare(real, model, label);
  }
  toString() { return `race(${this.ops.map(op => `${describe(op)} after ${op.delay}ms`).join(" | ")})`; }
}

/** Moves the clock on, so claims expire. */
class Advance {
  constructor(ms) { this.ms = ms; }
  check() { return true; }
  async run(model, real) {
    model.now += this.ms;
    await compare(real, model, this.toString());
  }
  toString() { return `advance ${this.ms / minute}m`; }
}

/** Moves the clock to just before, or exactly to, a claim's expiry. */
class ToExpiry {
  constructor(story, offset) { this.story = story; this.offset = offset; }
  check(model) {
    const claim = model.claims.get(this.story);
    return claim !== undefined && claim.expiresAt + this.offset > model.now;
  }
  async run(model, real) {
    model.now = model.claims.get(this.story).expiresAt + this.offset;
    await compare(real, model, this.toString());
  }
  toString() { return `to ${this.story} expiry ${this.offset}ms`; }
}

/** The CLI exits 3 and names the holder when someone else holds the story. */
class CliClaim {
  constructor(agent, story) { this.agent = agent; this.story = story; }
  check(model) {
    const claim = model.claims.get(this.story);
    // The CLI judges expiry by the real clock, which is behind the model's.
    return claim !== undefined && claim.agent !== this.agent && claim.expiresAt > model.now;
  }
  async run(model, real) {
    const holder = model.claims.get(this.story);
    if (holder.expiresAt <= Date.now() + minute) return;
    const result = await new Promise(done => {
      const child = spawn(process.execPath, [cli, "claim", this.story, "--agent", this.agent, ...real.cliArgs], { cwd: real.roots(this.agent), env });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("close", status => done({ status, stderr }));
    });
    assert.equal(result.status, 3, `${this}: ${result.stderr}`);
    assert.match(result.stderr, new RegExp(`${this.story} is claimed by ${holder.agent} on ${branchOf(holder.agent)}`));
    await compare(real, model, this.toString());
  }
  toString() { return `${this.agent} cli claim ${this.story}`; }
}

const opArb = fc.record({
  type: fc.constantFrom("claim", "renew", "take-over", "unclaim"),
  agent: fc.constantFrom(...agents),
  story: fc.constantFrom(...stories),
  ttl: fc.constantFrom(...ttls),
  own: fc.boolean(),
});

const commands = fc.commands([
  opArb.map(op => new Call(op)),
  opArb.map(op => new Call(op)),
  // Two or three agents call at once on one story. Claims and take-overs,
  // which create or replace a claim, are the calls most likely to collide.
  fc.tuple(fc.constantFrom(...stories), fc.array(fc.record({
    type: fc.constantFrom("claim", "claim", "take-over", "take-over", "renew", "unclaim"),
    ttl: fc.constantFrom(...ttls),
    own: fc.boolean(),
    delay: fc.constantFrom(0, 0, 10, 30, 60, 120),
  }), { minLength: agents.length, maxLength: agents.length }), fc.integer({ min: 2, max: agents.length }))
    .map(([story, ops, count]) => new Race(ops.slice(0, count).map((op, index) => ({ ...op, story, agent: agents[index] })))),
  fc.constantFrom(30_000, minute, 30 * minute, 4 * hour).map(ms => new Advance(ms)),
  fc.tuple(fc.constantFrom(...stories), fc.constantFrom(-1, 0)).map(([story, offset]) => new ToExpiry(story, offset)),
  fc.tuple(fc.constantFrom(...agents), fc.constantFrom(...stories)).map(([agent, story]) => new CliClaim(agent, story)),
], { maxCommands: 14 });

async function check(mode, numRuns) {
  await fc.assert(
    fc.asyncProperty(commands, async cmds => {
      const real = await scratch(mode);
      try {
        // Start the model's clock at the real time, so the CLI, which reads the real clock, agrees about live claims.
        const model = { now: Math.ceil(Date.now() / 1000) * 1000, claims: new Map() };
        await fc.asyncModelRun(() => ({ model, real }), cmds);
      } finally {
        await rm(real.base, { recursive: true, force: true });
      }
    }),
    { numRuns: runs || numRuns },
  );
}

test("ESM-165: claims on a Git remote behave like the model under random calls by several agents", { timeout: 10 * minute }, async () => {
  await check("git", 12);
});

test("ESM-165: claims in a --store folder behave like the model under random calls by several agents", { timeout: 10 * minute }, async () => {
  await check("store", 25);
});
