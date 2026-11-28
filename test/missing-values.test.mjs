import assert from "node:assert/strict";
import test from "node:test";
import {
  diffStoryMaps,
  formatStoryMapDiff,
  getStoryMapForViewer,
  parseStoryMap,
  proposeDraftConfirmation,
  proposeStoryMapEdit,
  storyMapBrief,
  StoryMapEditError,
} from "auto-story-map";
import { present } from "../dist/present.js";

const map = `version: 1
id: missing-values
title: Missing values
visibility: all-users
customer:
  title: Roadmap
activities:
  - id: plan
    title: Plan
    customer:
      title: Planning
releases:
  - id: r1
    title: Only release
    customer:
      title: Next
personas:
  - id: pm
    title: Product manager
    jobs:
      - id: plan-release
        situation: a release is being planned
        motivation: to agree its scope
        outcome: everyone starts from the same list
        draft: true
stories:
  - id: S-1
    title: Plan a release
    activity: plan
    release: r1
    status: planned
    jobs: [plan-release]
`;

const editError = pattern => error => error instanceof StoryMapEditError && pattern.test(error.message);

test("ESM-190: editing, deleting or confirming a job that is not in the map names it and suggests the closest", async () => {
  await assert.rejects(proposeStoryMapEdit(map, [{ op: "set-job", job: "plan-relase", outcome: "done" }]), editError(/^Edit 1: There is no job plan-relase\. Did you mean plan-release\?$/));
  await assert.rejects(proposeStoryMapEdit(map, [{ op: "delete-job", job: "plan-relase" }]), editError(/^Edit 1: There is no job plan-relase\. Did you mean plan-release\?$/));
  await assert.rejects(proposeDraftConfirmation(map, { id: "plan-relase" }), editError(/There is no job or persona plan-relase\. Did you mean plan-release\?/));
  // A persona with no jobs list at all is not a match either.
  const noJobs = map.replace(/ {4}jobs:\n(?: {6,}.+\n)+/, "").replace("    jobs: [plan-release]\n", "");
  await assert.rejects(proposeStoryMapEdit(noJobs, [{ op: "delete-job", job: "plan-release" }]), editError(/^Edit 1: There is no job plan-release\.$/));

  // The job that is there still edits and confirms as before.
  const deleted = await proposeStoryMapEdit(map, [{ op: "delete-job", job: "plan-release" }]);
  assert.ok(deleted.valid);
  assert.doesNotMatch(deleted.source, /plan-release/);
  const confirmed = await proposeDraftConfirmation(map, { id: "plan-release" });
  assert.deepEqual(confirmed.drafts.map(draft => draft.kind), ["job"]);
  assert.doesNotMatch(confirmed.source, /draft: true/);
});

test("ESM-190: a release brief works for a release with no release before or after it", () => {
  const view = getStoryMapForViewer(parseStoryMap(map), { roles: ["engineer"] });
  const brief = storyMapBrief(view, { release: "r1", mapPath: "map.yaml" });
  assert.match(brief, /^<brief map="map.yaml" scope="release" target="r1">$/m);
  assert.match(brief, /^S-1 {2}Plan a release$/m);
  assert.doesNotMatch(brief, /release undefined/);
});

test("ESM-190: the diff names stories customers start or stop seeing, also against a map that did not exist", () => {
  const shown = map.replace("    jobs: [plan-release]\n", "    jobs: [plan-release]\n    customer:\n      title: Plan your release\n");
  const before = parseStoryMap(map);
  const after = parseStoryMap(shown);

  assert.deepEqual(diffStoryMaps(before, after).customer.map(change => [change.id, change.change, change.title]), [["S-1", "now-visible", "Plan your release"]]);
  assert.deepEqual(diffStoryMaps(after, before).customer.map(change => [change.id, change.change, change.title]), [["S-1", "no-longer-visible", "Plan your release"]]);
  assert.deepEqual(diffStoryMaps(null, after).customer.map(change => change.change), ["now-visible"]);

  // A story that stops being blocked says which status it left.
  const blocked = parseStoryMap(map.replace("status: planned", "status: blocked\n    statusReason: Waiting on design"));
  assert.match(formatStoryMapDiff(diffStoryMaps(blocked, before)), /- \*\*No longer blocked:\*\* `S-1` Plan a release, now Planned\./);
});

test("ESM-190: a value the code relies on that is missing gives an internal error naming it", () => {
  assert.equal(present(0, "a count"), 0);
  assert.equal(present("", "a title"), "");
  assert.throws(() => present(undefined, "the panel of story S-1"), {
    message: "Internal error: the panel of story S-1 is missing. Please report this as a bug in Auto Story Map.",
  });
  assert.throws(() => present(null, "a release"), /^Error: Internal error: a release is missing\./);
});
