import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { proposeDraftConfirmation, proposeStoryMapEdit, StoryMapEditError } from "auto-story-map";
import { personConfirms } from "../dist/commands/confirm.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// A small map of its own, so the tests do not depend on which drafts this repository's map still has.
const map = `version: 1
id: confirm-demo
title: Confirm Demo Story Map
visibility: internal
personas:
  - id: estimator
    title: Estimator
    context:
      success: Sends a priced estimate the same day.
      usesToday:
        - Spreadsheets
      draft: true
    jobs:
      # Drafted from the support inbox.
      - id: price-a-job
        situation: a builder asks for a price
        motivation: to price the job from current rates
        outcome: I can send the estimate the same day
        draft: true
        steps:
          - title: Pick the rates
            activity: estimate
      - id: check-margins
        situation: an estimate is ready to send
        motivation: to check its margin
        outcome: I do not send a loss-making price
      - id: chase-approvals
        situation: an estimate has had no reply for a week
        motivation: to remind the builder
        outcome: fewer estimates go stale
        draft: true
activities:
  - id: estimate
    title: Estimate
releases:
  - id: r1
    title: First release
    impact:
      - metric: Estimate turnaround time
        expected: Same day
      - metric: Estimates returned for corrections
        expected: Halved
        draft: true # agent draft
stories:
  - id: DEMO-1
    title: Price a job
    activity: estimate
    release: r1
    status: planned
    jobs:
      - price-a-job
`;

/** The map without the lines at these 1-based line numbers. */
const withoutLines = (...numbers) => map.split("\n").filter((_, index) => !numbers.includes(index + 1)).join("\n");

async function scratch(t, source = map) {
  const root = await mkdtemp(join(tmpdir(), "story-map-confirm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), source);
  // A pipe for standard input, as when an agent runs the command.
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input: "" });
  const read = () => readFile(join(root, "product/story-map.yaml"), "utf8");
  return { run, read };
}

test("ESM-110: the dry run shows a drafted job as the reader sees it and writes nothing", async t => {
  const { run, read } = await scratch(t);
  const result = run("confirm", "price-a-job");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Job price-a-job \(Estimator\): When a builder asks for a price, I want to price the job from current rates, so that I can send the estimate the same day\./);
  assert.match(result.stdout, /Step: Pick the rates/);
  assert.match(result.stdout, /^- {8}draft: true$/m);
  assert.match(result.stdout, /Confirmed drafted job `price-a-job` \(Estimator\)/);
  assert.match(result.stderr, /Dry run: nothing written/);
  assert.equal(await read(), map);
});

test("ESM-110: the dry run shows a persona's drafted context and a drafted impact item", async t => {
  const { run } = await scratch(t);
  const context = run("confirm", "estimator");
  assert.equal(context.status, 0, context.stderr);
  assert.match(context.stdout, /Context of persona estimator \(Estimator\):\n {2}Success:\n {4}Sends a priced estimate the same day\.\n {2}Uses today:\n {4}- Spreadsheets/);
  const impact = run("confirm", "r1", "--impact", "2");
  assert.equal(impact.status, 0, impact.stderr);
  assert.match(impact.stdout, /Impact 2 of r1 \(First release\): Estimates returned for corrections\n {2}Expected: Halved/);
});

test("ESM-110: confirming removes only the draft lines and keeps comments", async () => {
  const draftLines = map.split("\n").flatMap((line, index) => (line.trim().startsWith("draft: true") ? [index + 1] : []));
  const [contextLine, priceLine, chaseLine, impactLine] = draftLines;
  const cases = [
    [{ id: "price-a-job" }, [priceLine], "jobs"],
    [{ id: "estimator" }, [contextLine], "personaContexts"],
    [{ release: "r1", impact: 2 }, [impactLine], "releases"],
    [{ allJobsOf: "estimator" }, [priceLine, chaseLine], "jobs"],
  ];
  for (const [target, lines, section] of cases) {
    const result = await proposeDraftConfirmation(map, target);
    assert.equal(result.valid, true);
    assert.equal(result.source, withoutLines(...lines), JSON.stringify(target));
    assert.match(result.source, /# Drafted from the support inbox\./);
    if (section === "jobs") assert.deepEqual(result.diff.jobs.confirmed.map(ref => ref.id), "allJobsOf" in target ? ["price-a-job", "chase-approvals"] : ["price-a-job"]);
    if (section === "personaContexts") assert.deepEqual(result.diff.personaContexts.confirmed.map(ref => ref.id), ["estimator"]);
    if (section === "releases") assert.match(result.summary, /confirmed drafted impact “Estimates returned for corrections”/);
  }
});

test("ESM-110: --all-in lists every drafted job of the persona and skips confirmed ones", async () => {
  const result = await proposeDraftConfirmation(map, { allJobsOf: "estimator" });
  assert.deepEqual(result.drafts.map(draft => draft.job.id), ["price-a-job", "chase-approvals"]);
});

test("ESM-110: --write refuses without a terminal and writes nothing", async t => {
  const { run, read } = await scratch(t);
  const result = run("confirm", "price-a-job", "--write");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs a terminal/);
  assert.equal(await read(), map);
  // JSON is for agents, so it never goes with --write.
  assert.equal(run("confirm", "price-a-job", "--write", "--format", "json").status, 2);
});

test("ESM-110: only the exact ID typed back confirms", async () => {
  const answer = text => async () => text;
  assert.equal(await personConfirms("price-a-job", answer("price-a-job\n")), true);
  assert.equal(await personConfirms("price-a-job", answer("price-a-jo")), false);
  assert.equal(await personConfirms("price-a-job", answer("")), false);
  assert.equal(await personConfirms("price-a-job", answer("y")), false);
  let asked;
  await personConfirms("estimator", async question => (asked = question));
  assert.equal(asked, "Type estimator to confirm: ");
});

test("ESM-110: the JSON dry run describes the drafts for agents", async t => {
  const { run } = await scratch(t);
  const result = run("confirm", "chase-approvals", "--format", "json");
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.format, "auto-story-map.confirm");
  assert.equal(body.written, false);
  assert.equal(body.drafts[0].kind, "job");
  assert.equal(body.drafts[0].job.id, "chase-approvals");
});

test("ESM-110: a confirmed item, an unknown ID and a missing impact item are reported", async t => {
  const { run } = await scratch(t);
  const confirmed = run("confirm", "check-margins");
  assert.equal(confirmed.status, 0);
  assert.match(confirmed.stderr, /Nothing to confirm: check-margins is not a draft\./);
  assert.match(run("confirm", "r1", "--impact", "1").stderr, /Nothing to confirm: impact 1 of r1 is not a draft\./);

  const unknown = run("confirm", "price-a-jb");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /There is no job or persona price-a-jb\. Did you mean price-a-job\?/);
  assert.match(run("confirm", "r1", "--impact", "3").stderr, /r1 has 2 impact items, so give a number from 1 to 2\./);
  assert.match(run("confirm", "r2", "--impact", "1").stderr, /There is no release r2\. Did you mean r1\?/);
  assert.match(run("confirm", "--all-in", "estimatr").stderr, /There is no persona estimatr\. Did you mean estimator\?/);
  assert.equal(run("confirm", "r1", "--impact", "two").status, 2);
});

test("ESM-110: an ID that is both a job and a persona is refused", async () => {
  const shared = map.replace("id: check-margins", "id: estimator");
  await assert.rejects(proposeDraftConfirmation(shared, { id: "estimator" }), error => error instanceof StoryMapEditError && /both a job and a persona/.test(error.message));
});

test("ESM-110: edits from a file still cannot remove draft", async () => {
  for (const op of ["confirm", "confirm-draft", "remove-draft"]) {
    await assert.rejects(proposeStoryMapEdit(map, [{ op, job: "price-a-job" }]), StoryMapEditError);
  }
  const reworded = await proposeStoryMapEdit(map, [{ op: "set-job", job: "price-a-job", outcome: "I can send it within the hour" }]);
  assert.match(reworded.source, /outcome: I can send it within the hour\n {8}draft: true/);
});
