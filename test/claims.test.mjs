import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { claimRefPrefix, claimStory, gatherStoryEvidence, listStoryClaims, parseClaimTtl, releaseStoryClaim, StoryClaimError, StoryClaimHeldError } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const hour = 60 * 60 * 1000;

const map = `version: 1
id: claims-demo
title: Claims demo
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
  - id: ESM-3
    title: Already merged
    activity: build
    release: now
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

/** A bare scratch remote with two clones of a repository holding the map, as two agents would have. */
async function remote(t) {
  const base = await mkdtemp(join(tmpdir(), "story-map-claims-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const run = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  const bare = join(base, "remote.git");
  run(base, "init", "-q", "--bare", "-b", "main", bare);
  const first = join(base, "first");
  run(base, "init", "-q", "-b", "main", first);
  await mkdir(join(first, "product"), { recursive: true });
  await writeFile(join(first, "product/story-map.yaml"), map);
  run(first, "add", "-A");
  run(first, "commit", "-q", "-m", "Add the map");
  run(first, "remote", "add", "origin", bare);
  run(first, "push", "-q", "origin", "main");
  const second = join(base, "second");
  run(base, "clone", "-q", bare, second);
  run(second, "switch", "-q", "-c", "feat/esm-1-second");
  return { base, bare, first, second, git: (cwd, ...args) => run(cwd, ...args) };
}

function cliRun(cwd, args) {
  return new Promise(done => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", status => done({ status, stdout, stderr }));
  });
}

test("ESM-106: of two agents claiming a story at once against the remote, exactly one wins", async t => {
  const { first, second, bare, git } = await remote(t);
  for (let round = 0; round < 3; round++) {
    const id = ["ESM-1", "ESM-2", "ESM-1"][round];
    const results = await Promise.allSettled([
      claimStory(map, id, { root: first, agent: "agent-a" }),
      claimStory(map, id, { root: second, agent: "agent-b" }),
    ]);
    const won = results.filter(result => result.status === "fulfilled");
    const lost = results.filter(result => result.status === "rejected");
    assert.equal(won.length, 1, "exactly one claim succeeds");
    assert.ok(lost[0].reason instanceof StoryClaimHeldError, "the loser is told the claim is held");
    assert.equal(lost[0].reason.claim.agent, won[0].value.claim.agent, "the loser is told who holds it");
    assert.match(lost[0].reason.message, new RegExp(`${id} is claimed by agent-[ab]`));
    await releaseStoryClaim(id, { root: first });
  }
  assert.equal(git(bare, "for-each-ref", claimRefPrefix), "", "every claim was released");
  assert.equal(git(first, "status", "--porcelain"), "", "the map and checkout are untouched");
});

test("ESM-106: the CLI loser exits 3 and names the holder, and the claim is a parentless commit naming no person", async t => {
  const { first, second, bare, git } = await remote(t);
  const [a, b] = await Promise.all([
    cliRun(first, ["claim", "ESM-2", "--agent", "agent-a", "--ttl", "2h"]),
    cliRun(second, ["claim", "ESM-2", "--agent", "agent-b", "--ttl", "2h"]),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [0, 3]);
  const [winner, loser] = a.status === 0 ? [a, b] : [b, a];
  const holder = a.status === 0 ? "agent-a" : "agent-b";
  assert.match(winner.stdout, new RegExp(`^Claimed ESM-2 for ${holder} until `));
  assert.match(loser.stderr, new RegExp(`ESM-2 is claimed by ${holder} on (main|feat/esm-1-second)`));

  const commit = git(bare, "rev-parse", `${claimRefPrefix}ESM-2`).trim();
  assert.equal(git(bare, "rev-list", "--parents", "-n", "1", commit).trim(), commit, "no parents");
  assert.equal(git(bare, "log", "-1", "--format=%an <%ae> %cn <%ce>", commit).trim(), "story-map <story-map@claims.invalid> story-map <story-map@claims.invalid>");
  const message = JSON.parse(git(bare, "log", "-1", "--format=%B", commit));
  assert.deepEqual(Object.keys(message), ["format", "version", "id", "agent", "branch", "claimedAt", "expiresAt"]);
  assert.equal(message.format, "auto-story-map.claim");
  assert.equal(Date.parse(message.expiresAt) - Date.parse(message.claimedAt), 2 * hour);

  const json = await cliRun(second, ["claim", "ESM-2", "--agent", "agent-c", "--format", "json"]);
  assert.equal(json.status, 3);
  assert.equal(JSON.parse(json.stdout).held.agent, holder);

  const list = await cliRun(first, ["claims", "--format", "json"]);
  assert.equal(list.status, 0);
  assert.deepEqual(JSON.parse(list.stdout).claims.map(claim => [claim.id, claim.agent, claim.expired]), [["ESM-2", holder, false]]);
});

test("ESM-106: renew extends your own claim, and take over replaces only an expired one", async t => {
  const { first, second } = await remote(t);
  const start = new Date("2026-11-23T10:00:00Z");
  const later = new Date(start.getTime() + 3 * hour);
  const { claim } = await claimStory(map, "ESM-1", { root: first, agent: "agent-a", now: start, branch: "feat/esm-1-work" });
  assert.equal(claim.expiresAt, "2026-11-23T14:00:00.000Z", "4 hours by default");

  await assert.rejects(claimStory(map, "ESM-1", { root: second, agent: "agent-b", mode: "renew", now: later }), StoryClaimHeldError, "only the holder renews");
  await assert.rejects(claimStory(map, "ESM-1", { root: second, agent: "agent-b", mode: "take-over", now: later }), /has not expired, so it cannot be taken over/);
  await assert.rejects(claimStory(map, "ESM-1", { root: first, agent: "agent-a", now: later }), /If that is you, pass --renew/);

  const renewed = await claimStory(map, "ESM-1", { root: first, agent: "agent-a", mode: "renew", now: later, ttlMs: parseClaimTtl("1h") });
  assert.equal(renewed.claim.claimedAt, claim.claimedAt, "renewing keeps when it was claimed");
  assert.equal(renewed.claim.renewedAt, later.toISOString());
  assert.equal(renewed.claim.expiresAt, "2026-11-23T14:00:00.000Z");
  assert.equal(renewed.replaced.expiresAt, claim.expiresAt);

  const expired = new Date("2026-11-23T15:00:00Z");
  const [listed] = (await listStoryClaims({ root: second, now: expired })).claims;
  assert.equal(listed.expired, true, "a claim past its expiry is marked expired");
  await assert.rejects(claimStory(map, "ESM-1", { root: second, agent: "agent-b", now: expired }), /Pass --take-over to replace it/);
  const taken = await claimStory(map, "ESM-1", { root: second, agent: "agent-b", mode: "take-over", now: expired });
  assert.equal(taken.claim.agent, "agent-b");
  assert.equal(taken.claim.branch, "feat/esm-1-second", "the current branch by default");
  assert.equal(taken.replaced.agent, "agent-a");
  await assert.rejects(claimStory(map, "ESM-1", { root: first, agent: "agent-a", mode: "renew", now: expired }), StoryClaimHeldError, "the old holder can no longer renew");
  await assert.rejects(claimStory(map, "ESM-2", { root: first, agent: "agent-a", mode: "renew" }), /no claim to renew/);
});

test("ESM-106: unclaim deletes the ref, refuses another agent's claim and is fine with no claim", async t => {
  const { first, second, bare, git } = await remote(t);
  await claimStory(map, "ESM-2", { root: first, agent: "agent-a" });
  const refused = await cliRun(second, ["unclaim", "ESM-2", "--agent", "agent-b"]);
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /It is not agent-b's to release/);
  const released = await cliRun(second, ["unclaim", "ESM-2"]);
  assert.equal(released.status, 0);
  assert.match(released.stdout, /Released ESM-2, which agent-a held/);
  assert.equal(git(bare, "for-each-ref", claimRefPrefix), "");
  const again = await cliRun(second, ["unclaim", "ESM-2", "--format", "json"]);
  assert.equal(again.status, 0);
  assert.deepEqual(JSON.parse(again.stdout), { format: "auto-story-map.unclaim", version: 1 });
  assert.match((await cliRun(first, ["claims"])).stdout, /^No claims on origin\./);
});

test("ESM-106: refuses unknown or finished stories, email addresses and bad options", async t => {
  const { first } = await remote(t);
  await assert.rejects(claimStory(map, "ESM-9", { root: first, agent: "bot" }), /no story with this ID/);
  await assert.rejects(claimStory(map, "ESM-3", { root: first, agent: "bot" }), /ESM-3 is merged, so there is no work left to claim/);
  await assert.rejects(claimStory(map, "ESM-1", { root: first, agent: "alex@example.com" }), /not an email address/);
  await assert.rejects(claimStory(map, "ESM-1", { root: first, agent: "bot", remote: "upstream" }), /no Git remote called upstream/);
  await assert.rejects(claimStory(map, "ESM-1", { root: first, agent: "bot", remote: "--upload-pack=x" }), StoryClaimError);
  assert.throws(() => parseClaimTtl("31d"), /between 1 minute and 30 days/);
  assert.throws(() => parseClaimTtl("4 hours"), /such as 30m, 4h or 2d/);
  assert.equal(parseClaimTtl("30m"), 30 * 60 * 1000);

  const noAgent = await cliRun(first, ["claim", "ESM-1"]);
  assert.equal(noAgent.status, 2);
  assert.match(noAgent.stderr, /--agent needs a name/);
  const both = await cliRun(first, ["claim", "ESM-1", "--agent", "bot", "--renew", "--take-over"]);
  assert.equal(both.status, 2);
  const merged = await cliRun(first, ["claim", "ESM-3", "--agent", "bot"]);
  assert.equal(merged.status, 1);
  const badTtl = await cliRun(first, ["claim", "ESM-1", "--agent", "bot", "--ttl", "forever"]);
  assert.equal(badTtl.status, 2);
});

test("ESM-106: an unreadable claim ref is reported, and can be taken over", async t => {
  const { first, git } = await remote(t);
  const tree = git(first, "hash-object", "-t", "tree", "-w", "/dev/null").trim();
  const junk = git(first, "commit-tree", tree, "-m", "ESM-1: not a claim\u001e\u001f").trim();
  git(first, "push", "-q", "origin", `${junk}:${claimRefPrefix}ESM-1`);
  const [claim] = (await listStoryClaims({ root: first })).claims;
  assert.equal(claim.problem, "It is not valid JSON.");
  assert.equal(claim.expired, true);
  const text = await cliRun(first, ["claims"]);
  assert.match(text.stdout, /^ESM-1 {2}unreadable: It is not valid JSON\./);
  const taken = await claimStory(map, "ESM-1", { root: first, agent: "bot", mode: "take-over" });
  assert.equal(taken.replaced.problem, "It is not valid JSON.");
  assert.equal((await listStoryClaims({ root: first })).claims[0].agent, "bot");
});

test("ESM-106: the file store gives the same guarantees for agents on one machine", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-claim-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = ".story-map/claims";
  const start = new Date("2026-11-23T10:00:00Z");
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => claimStory(map, "ESM-1", { root, store, agent: `agent-${n}`, now: start })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "exactly one of eight wins");
  assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason instanceof StoryClaimHeldError));
  const winner = results.find(result => result.status === "fulfilled").value.claim.agent;
  assert.deepEqual(await readdir(join(root, store)), ["ESM-1.json"]);
  assert.equal(JSON.parse(await readFile(join(root, store, "ESM-1.json"), "utf8")).agent, winner);

  const later = new Date(start.getTime() + hour);
  const renewed = await claimStory(map, "ESM-1", { root, store, agent: winner, mode: "renew", now: later });
  assert.equal(renewed.claim.expiresAt, "2026-11-23T15:00:00.000Z");
  const expired = new Date("2026-11-23T16:00:00Z");
  const takeOvers = await Promise.allSettled(["x", "y", "z"].map(agent => claimStory(map, "ESM-1", { root, store, agent, mode: "take-over", now: expired })));
  assert.equal(takeOvers.filter(result => result.status === "fulfilled").length, 1, "exactly one take-over wins");
  const { claims } = await listStoryClaims({ root, store, now: expired });
  assert.deepEqual(claims.map(claim => [claim.id, claim.expired]), [["ESM-1", false]]);
  assert.deepEqual((await releaseStoryClaim("ESM-1", { root, store })).released.id, "ESM-1");
  assert.deepEqual(await readdir(join(root, store)), [], "no claim or lock file is left behind");

  await assert.rejects(claimStory(map, "ESM-1", { root, store: "../elsewhere", agent: "bot" }), /Points outside the repository/);
  const cliStore = await cliRun(root, ["claims", "--store", store]);
  assert.match(cliStore.stdout, /^No claims in \.story-map\/claims\./);
  const both = await cliRun(root, ["claims", "--store", store, "--remote", "origin"]);
  assert.equal(both.status, 2);
});

test("ESM-106: evidence shows claims and reports a claim on a merged story as stale", async t => {
  const { first } = await remote(t);
  await claimStory(map, "ESM-2", { root: first, agent: "agent-a" });
  // A claim made before the story merged is left behind.
  const before = map.replace("title: Already merged\n    activity: build\n    release: now\n    status: merged", "title: Already merged\n    activity: build\n    release: now\n    status: planned");
  await claimStory(before, "ESM-3", { root: first, agent: "agent-b" });

  const without = await gatherStoryEvidence(map, { root: first, ids: ["ESM-2"] });
  assert.equal(without.stories[0].claim, undefined, "claims are opt-in");
  assert.ok(!without.checked.includes("claims"));

  const result = await gatherStoryEvidence(map, { root: first, ids: ["ESM-1", "ESM-2", "ESM-3"], claims: {} });
  assert.ok(result.checked.includes("claims"));
  const [one, two, three] = result.stories;
  assert.equal(one.claim, undefined);
  assert.equal(two.claim.agent, "agent-a");
  assert.equal(two.claim.stale, false);
  assert.equal(two.suggestedStatus, "in-progress", "a claim never changes the suggestion");
  assert.match(two.reasons.join(" "), /agent-a claims the story until .*, so someone is on it/);
  assert.equal(three.claim.stale, true);
  assert.match(three.reasons.join(" "), /agent-b still claims the story, but it is merged, so the claim is stale\. Release it with story-map unclaim ESM-3/);

  const text = await cliRun(first, ["evidence", "--claims", "ESM-3"]);
  assert.match(text.stdout, /Claim: {5}agent-b on main, expires .*, stale/);
  const missing = await gatherStoryEvidence(map, { root: first, ids: ["ESM-2"], claims: { remote: "nowhere" } });
  assert.match(missing.notes.join(" "), /Claims were not read: There is no Git remote called nowhere/);
});
