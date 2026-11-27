// Property tests for the customer audience filter, the edit safeguards and the
// map diff (ESM-164, section 7 of docs/plans/rules-as-checks.md).
//
// fast-check generates valid maps with comments, customer copy on some items,
// drafts and every story field, then random filters and edits. Internal text
// carries the marker `zqx`, and every piece of approved customer copy a
// numbered token such as `pubX12X`, so a leak is a plain search of the output.
//
// CI runs the default number of cases. For a longer run, as before a release
// that touches the view, `edit` or `diff`:
//   FC_NUM_RUNS=2000 node --test test/audience-edits.property.test.js
// A failure prints a seed and path; pass them to fc.assert to replay it.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Document, isMap, isSeq, LineCounter, parseDocument } from "yaml";
import {
  createStoryMapEditServer,
  diffStoryMaps,
  estimatePoints,
  getStoryMapPage,
  hasStoryMapChanges,
  parseStoryMap,
  storyMapEditPath,
  storyPriorities,
  storyStatuses,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { localEditOperations, proposeStoryMapEdit, StoryMapEditError } from "../dist/edit.js";

const numRuns = Number(process.env.FC_NUM_RUNS) || 100;
const internal = { roles: ["engineer"] };
const customer = { roles: [] };
const activeStatuses = ["planned", "in-progress", "merged", "shipped"];

// Generators.

// Words that YAML must quote or HTML must escape, mixed into every text field.
const word = fc.constantFrom("", "plain", "a: b", "#hash", " # not a comment", "'quoted'", '"double"', "<b>bold</b>", "&amp", "- dash", "é", "🎉", "[x]", "{y}", "@team");
const maybe = arbitrary => fc.option(arbitrary, { nil: undefined });

const shape = fc.record({
  visibility: fc.constantFrom("all-users", "internal"),
  mapCustomer: fc.boolean(),
  storyIds: fc.constantFrom(undefined, "next", "lowest-free"),
  activities: fc.array(fc.record({ customer: fc.boolean(), summary: fc.boolean() }), { minLength: 1, maxLength: 4 }),
  releases: fc.array(fc.record({
    customer: fc.boolean(),
    customerSummary: fc.boolean(),
    notes: fc.boolean(),
    impact: fc.array(fc.boolean(), { maxLength: 2 }),
  }), { minLength: 1, maxLength: 4 }),
  personas: fc.array(fc.record({
    customer: fc.boolean(),
    context: fc.constantFrom(undefined, false, true),
    jobs: fc.array(fc.record({ draft: fc.boolean(), step: maybe(fc.nat()) }), { maxLength: 2 }),
  }), { maxLength: 3 }),
  stories: fc.array(fc.record({
    gap: fc.integer({ min: 1, max: 3 }),
    activity: fc.nat(),
    release: fc.nat(),
    status: fc.constantFrom(...storyStatuses),
    reason: fc.boolean(),
    customer: fc.boolean(),
    customerSummary: fc.boolean(),
    summary: fc.boolean(),
    notes: fc.boolean(),
    sources: fc.integer({ min: 0, max: 2 }),
    jobs: fc.array(fc.nat(), { maxLength: 2 }),
    personas: fc.array(fc.nat(), { maxLength: 2 }),
    dependsOn: fc.array(fc.nat(), { maxLength: 2 }),
    estimate: maybe(fc.constantFrom(...estimatePoints)),
    priority: maybe(fc.constantFrom(...storyPriorities)),
    tokens: maybe(fc.nat({ max: 10_000_000 })),
    cost: maybe(fc.integer({ min: 0, max: 100_000 }).map(cents => cents / 100)),
    updatedBy: fc.boolean(),
  }), { maxLength: 8 }),
  words: fc.array(word, { minLength: 8, maxLength: 8 }),
});

/** Builds a valid map object from a shape. Internal text has `zqx` in it, and customer copy a `pubX<n>X` token. */
function buildMap(s) {
  let token = 0;
  let wordIndex = 0;
  const say = text => `${text} ${s.words[wordIndex++ % s.words.length]}`.trim();
  const secret = label => say(`zqx ${label}`);
  const pub = () => say(`pubX${++token}X`);
  const copy = summary => ({ title: pub(), ...(summary ? { summary: pub() } : {}) });

  const activities = s.activities.map((a, i) => ({
    id: `zqx-act-${i + 1}`,
    title: secret(`activity ${i + 1}`),
    ...(a.summary ? { summary: secret("activity summary") } : {}),
    ...(a.customer ? { customer: copy(false) } : {}),
  }));
  const releases = s.releases.map((r, i) => ({
    id: `zqx-rel-${i + 1}`,
    title: secret(`release ${i + 1}`),
    ...(r.notes ? { notes: secret("release notes") } : {}),
    ...(r.impact.length ? {
      impact: r.impact.map((draft, j) => ({ metric: secret(`metric ${j + 1}`), expected: secret("expected"), ...(draft ? { draft: true } : {}) })),
    } : {}),
    ...(r.customer ? { customer: copy(r.customerSummary) } : {}),
  }));
  const jobIds = [];
  const personas = s.personas.map((p, i) => ({
    id: `zqx-per-${i + 1}`,
    title: secret(`persona ${i + 1}`),
    ...(p.context !== undefined ? { context: { success: secret("success"), ...(p.context ? { draft: true } : {}) } } : {}),
    ...(p.jobs.length ? {
      jobs: p.jobs.map((job, j) => {
        const id = `zqx-job-${i + 1}-${j + 1}`;
        jobIds.push(id);
        return {
          id,
          situation: secret("situation"),
          motivation: secret("motivation"),
          outcome: secret("outcome"),
          ...(job.draft ? { draft: true } : {}),
          ...(job.step !== undefined ? { steps: [{ title: "zqx step", activity: activities[job.step % activities.length].id }] } : {}),
        };
      }),
    } : {}),
    ...(p.customer ? { customer: copy(false) } : {}),
  }));
  const pick = (indices, list) => [...new Set(indices.filter(() => list.length).map(i => list[i % list.length]))];
  let number = 100;
  const stories = [];
  for (const st of s.stories) {
    number += st.gap;
    const id = `ZQX-${number}`;
    const activity = activities[st.activity % activities.length];
    const release = releases[st.release % releases.length];
    const jobs = pick(st.jobs, jobIds);
    const personaIds = pick(st.personas, personas.map(p => p.id));
    const dependsOn = pick(st.dependsOn, stories.map(story => story.id));
    stories.push({
      id,
      title: secret(`story ${id}`),
      activity: activity.id,
      release: release.id,
      status: st.status,
      ...(st.reason ? { statusReason: secret("reason") } : {}),
      ...(st.estimate !== undefined ? { estimate: st.estimate } : {}),
      ...(st.priority !== undefined ? { priority: st.priority } : {}),
      ...(st.tokens !== undefined ? { tokens: st.tokens } : {}),
      ...(st.cost !== undefined ? { estimatedCostUsd: st.cost } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
      ...(jobs.length ? { jobs } : {}),
      ...(personaIds.length ? { personas: personaIds } : {}),
      ...(st.updatedBy ? { updatedBy: secret("person") } : {}),
      ...(st.summary ? { summary: secret("summary") } : {}),
      ...(st.notes ? { notes: secret("notes") } : {}),
      ...(st.sources ? { sources: Array.from({ length: st.sources }, (_, k) => `docs/zqx-plan.md#part-${k + 1}`) } : {}),
      // Customer copy needs it on the story's activity and release too, or the map is not valid.
      ...(st.customer && activity.customer && release.customer ? { customer: copy(st.customerSummary) } : {}),
    });
  }
  const allUsers = s.visibility === "all-users";
  return {
    version: 1,
    id: "zqx-map",
    title: secret("map"),
    summary: secret("map summary"),
    visibility: s.visibility,
    ...(allUsers || s.mapCustomer ? { customer: copy(true) } : {}),
    ...(s.storyIds ? { settings: { storyIds: s.storyIds } } : {}),
    ...(personas.length ? { personas } : {}),
    activities,
    releases,
    stories,
  };
}

/** Writes the map as YAML with a comment before each section and story, and one after each story's ID. */
function renderMap(map) {
  const document = new Document(map);
  document.commentBefore = " keep-c header";
  for (const pair of document.contents.items) {
    const key = pair.key.value;
    if (["personas", "activities", "releases", "stories"].includes(key)) pair.key.commentBefore = ` keep-c section ${key}`;
    if (key === "stories" || key === "personas") {
      for (const item of pair.value.items) {
        const id = item.get("id");
        item.commentBefore = ` keep-c before ${id}`;
        item.get("id", true).comment = ` keep-c id ${id}`;
      }
    }
  }
  return document.toString({ lineWidth: 0 });
}

const generatedMap = shape.map(s => {
  const map = buildMap(s);
  return { map, source: renderMap(map) };
});

// The customer view.

/** Every customer token the customer view may show: approved copy on active stories, and on the groups and personas they use. */
function allowedCustomerTokens(map) {
  if (map.visibility !== "all-users" || !map.customer) return new Set();
  const tokens = text => [...(text ?? "").matchAll(/pubX\d+X/g)].map(match => match[0]);
  const copyTokens = item => [...tokens(item.customer?.title), ...tokens(item.customer?.summary)];
  const shown = map.stories.filter(story => story.customer && activeStatuses.includes(story.status));
  const activityIds = new Set(shown.map(story => story.activity));
  const releaseIds = new Set(shown.map(story => story.release));
  const jobOwners = new Map((map.personas ?? []).flatMap(persona => (persona.jobs ?? []).map(job => [job.id, persona.id])));
  const personaIds = new Set(shown.flatMap(story => [...(story.jobs ?? []).map(id => jobOwners.get(id)), ...(story.personas ?? [])]));
  return new Set([
    ...copyTokens(map),
    ...shown.flatMap(copyTokens),
    ...map.activities.filter(item => activityIds.has(item.id)).flatMap(copyTokens),
    ...map.releases.filter(item => releaseIds.has(item.id)).flatMap(copyTokens),
    ...(map.personas ?? []).filter(item => personaIds.has(item.id)).flatMap(copyTokens),
  ]);
}

/** Query strings a customer might send, including internal IDs, which must not unlock anything. */
const customerParams = fc
  .record({
    q: maybe(fc.constantFrom("pubX", "pub", "1", "e", "a")),
    status: fc.array(fc.constantFrom("all", "blocked", "cut", "merged", "stalled", ...activeStatuses), { maxLength: 3 }),
    persona: fc.array(fc.constantFrom("persona-1", "zqx-per-1", "zqx-per-2"), { maxLength: 2 }),
    job: fc.array(fc.constantFrom("zqx-job-1-1", "zqx-job-2-1"), { maxLength: 1 }),
    activity: fc.array(fc.constantFrom("activity-1", "zqx-act-1"), { maxLength: 1 }),
    story: maybe(fc.constantFrom("story-1", "ZQX-101", "ZQX-102", "ZQX-103")),
    release: maybe(fc.constantFrom("release-1", "zqx-rel-1")),
    view: maybe(fc.constantFrom("personas", "actions", "map")),
    changed: maybe(fc.constantFrom("1d", "30d")),
  })
  .map(({ q, status, persona, job, activity, story, release, view, changed }) => {
    const params = new URLSearchParams();
    if (q !== undefined) params.set("q", q);
    for (const value of status) params.append("status", value);
    for (const value of persona) params.append("persona", value);
    for (const value of job) params.append("job", value);
    for (const value of activity) params.append("activity", value);
    if (story) params.set("story", story);
    if (release) params.set("release", release);
    if (view) params.set("view", view);
    if (changed) params.set("changed", changed);
    params.set("needs-person", "1");
    return params;
  });

test("ESM-164: the customer view and page never show internal work, whatever the map and filters", () => {
  fc.assert(
    fc.property(generatedMap, customerParams, ({ map, source }, searchParams) => {
      const document = parseStoryMap(source);
      const view = getStoryMapPage(document, customer, { searchParams });
      if (map.visibility !== "all-users") {
        assert.equal(view, null, "an internal map has no customer view");
        return;
      }
      const json = JSON.stringify(view);
      const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
      const allowed = allowedCustomerTokens(map);
      for (const [name, output] of [["JSON", json], ["page", html]]) {
        assert.doesNotMatch(output, /zqx/i, `the ${name} shows internal text or an internal ID`);
        for (const [found] of output.matchAll(/pubX\d+X/g)) {
          assert.ok(allowed.has(found), `the ${name} shows ${found}, customer copy that is not for this audience`);
        }
      }
      // Only what customers may see, under public IDs, with no internal fields.
      assert.equal(view.audience, "all-users");
      const shown = map.stories.filter(story => story.customer && activeStatuses.includes(story.status));
      assert.ok(view.stories.length <= shown.length);
      for (const story of view.stories) {
        assert.deepEqual(Object.keys(story).filter(key => !["id", "title", "summary", "activity", "release", "status", "personas"].includes(key)), []);
        assert.match(story.id, /^story-\d+$/);
        assert.notEqual(story.status, "merged", "merged work is not available to customers yet");
      }
      for (const key of ["actions", "history", "mapPath", "recentUpdates", "testsIndexed", "stalledAfterWeeks"]) assert.equal(view[key], undefined, key);
      for (const persona of view.personas ?? []) assert.equal(persona.jobs, undefined, "customers never see jobs");
      assert.equal(view.filter.view, undefined, "customers have no Personas or Actions tab");
      assert.equal(view.filter.job, undefined);
    }),
    { numRuns },
  );
});

test("ESM-164: the internal view of the same map shows every story, so the customer check is not empty by accident", () => {
  fc.assert(
    fc.property(generatedMap, ({ map, source }) => {
      const view = getStoryMapPage(parseStoryMap(source), internal, { searchParams: new URLSearchParams("status=all") });
      assert.deepEqual(view.stories.map(story => story.id), map.stories.map(story => story.id));
    }),
    { numRuns },
  );
});

// Edits.

const listFields = { source: "sources", job: "jobs", persona: "personas", dependency: "dependsOn" };

/** An edit described by indices and choices, resolved against a map by `resolveEdit`. */
const editStep = fc.record({
  kind: fc.constantFrom(
    "status", "release", "activity", "title", "summary", "notes", "priority", "tokens", "estimated-cost",
    "add-source", "remove-source", "add-job", "remove-job", "add-persona", "remove-persona", "add-dependency", "remove-dependency",
    "customer-title", "customer-summary", "add", "release-impact", "set-persona", "set-job", "set-persona-context", "create-job",
  ),
  target: fc.nat(),
  other: fc.nat(),
  status: fc.constantFrom(...storyStatuses),
  priority: fc.constantFrom(...storyPriorities, "none"),
  number: fc.nat({ max: 1_000_000 }),
  text: word,
});

/** Turns an edit step into an operation on `map`, or undefined when the map has nothing it can apply to. */
function resolveEdit(map, step, index) {
  const stories = map.stories;
  const story = stories[step.target % Math.max(stories.length, 1)];
  const choose = list => (list.length ? list[step.other % list.length] : undefined);
  const text = `zqx edit ${index} ${step.text}`.trim();
  const personas = map.personas ?? [];
  const jobs = personas.flatMap(persona => (persona.jobs ?? []).map(job => job.id));
  switch (step.kind) {
    case "add":
      return { op: "add", title: text, activity: choose(map.activities).id, release: choose(map.releases).id };
    case "release-impact":
      return { op: "release-impact", release: choose(map.releases).id, metric: `zqx added metric ${index}`, expected: text };
    case "set-persona": {
      const persona = choose(personas);
      return persona && { op: "set-persona", persona: persona.id, title: text };
    }
    case "set-persona-context": {
      const persona = choose(personas);
      return persona && { op: "set-persona-context", persona: persona.id, success: text };
    }
    case "set-job": {
      const job = choose(jobs);
      return job && { op: "set-job", job, motivation: text };
    }
    case "create-job": {
      const persona = choose(personas);
      return persona && { op: "create-job", persona: persona.id, id: `zqx-new-job-${index}`, situation: text, motivation: text, outcome: text };
    }
  }
  if (!story) return undefined;
  const id = story.id;
  switch (step.kind) {
    case "status": {
      const needsReason = step.status === "blocked" || step.status === "cut";
      return { op: "status", id, status: step.status, ...(needsReason ? { reason: text } : {}) };
    }
    case "release":
      return { op: "release", id, release: choose(map.releases).id };
    case "activity":
      return { op: "activity", id, activity: choose(map.activities).id };
    case "title":
    case "summary":
    case "notes":
      return { op: step.kind, id, [step.kind]: text };
    case "priority":
      return { op: "priority", id, priority: step.priority };
    case "tokens":
      return { op: "tokens", id, tokens: step.number };
    case "estimated-cost":
      return { op: "estimated-cost", id, usd: step.number / 100 };
    case "customer-title":
      return { op: "customer-title", id, title: `pubX${900 + index}X` };
    case "customer-summary":
      return { op: "customer-summary", id, summary: `pubX${950 + index}X` };
  }
  const [verb, noun] = step.kind.split("-");
  const field = listFields[noun];
  const options = verb === "remove" ? story[field] ?? []
    : noun === "source" ? [`docs/zqx-new.md#edit-${index}`]
    : noun === "job" ? jobs
    : noun === "persona" ? personas.map(persona => persona.id)
    : stories.filter(other => other.id !== id).map(other => other.id);
  const value = choose(options);
  return value && { op: step.kind, id, [noun]: value };
}

const generatedEdit = fc
  .tuple(generatedMap, fc.array(editStep, { minLength: 1, maxLength: 4 }), fc.boolean(), fc.boolean())
  .map(([{ map, source }, steps, allowCustomer, onBehalf]) => {
    // Apply the steps to a copy, so later steps see stories that earlier ones add.
    const operations = steps.map((step, index) => resolveEdit(map, step, index)).filter(Boolean);
    return { map, source, operations, options: { allowCustomer, ...(onBehalf ? { updatedBy: "zqx Someone Else" } : {}) } };
  })
  .filter(({ operations }) => operations.length > 0);

const ids = list => (list ?? []).map(item => item.id);
const jobIdsOf = map => (map.personas ?? []).flatMap(persona => ids(persona.jobs));
const comments = source => [...source.matchAll(/keep-c[^\n]*/g)].map(match => match[0]).sort();

/** Line numbers, from 0, that the YAML node at `path` covers in `source`. */
function linesOf(source, path) {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  const node = document.getIn(path, true);
  if (!node?.range) return [];
  const first = lineCounter.linePos(node.range[0]).line - 1;
  const last = lineCounter.linePos(Math.max(node.range[0], node.range[1] - 1)).line - 1;
  return Array.from({ length: last - first + 1 }, (_, k) => first + k);
}

/** True when `needles` appear in `haystack` in the same order. */
function isSubsequence(needles, haystack) {
  let at = 0;
  for (const line of haystack) if (at < needles.length && line === needles[at]) at++;
  return at === needles.length;
}

/** The map items the operations are allowed to change: stories by ID, releases and personas by index. */
function touchedItems(map, operations) {
  const stories = new Set();
  const releases = new Set();
  const personas = new Set();
  for (const operation of operations) {
    if (operation.op === "add") continue;
    if (operation.op === "release-impact") releases.add(map.releases.findIndex(release => release.id === operation.release));
    else if (operation.persona && operation.op !== "add-persona" && operation.op !== "remove-persona") {
      personas.add(map.personas.findIndex(persona => persona.id === operation.persona));
    } else if (operation.op === "set-job") personas.add(map.personas.findIndex(persona => persona.jobs?.some(job => job.id === operation.job)));
    else stories.add(operation.id);
  }
  return { stories, releases, personas };
}

test("ESM-164: edit and add change only the stories named, keep every ID, draft and comment, and report exactly what changed", async () => {
  let saved = 0;
  await fc.assert(
    fc.asyncProperty(generatedEdit, async ({ map, source, operations, options }) => {
      let result;
      try {
        result = await proposeStoryMapEdit(source, operations, options);
      } catch (error) {
        assert.ok(error instanceof StoryMapEditError, `only a StoryMapEditError may refuse an edit: ${error?.stack}`);
        // The only refusals these edits can meet: customer copy without approval, a summary
        // before a title, removing an item twice, and adding to a map whose stories have no numbers to follow.
        assert.match(error.message, /Customer-facing copy needs approval|has no customer title|has no (source|job|persona|dependency) |no numbered story IDs|no stories list/, error.message);
        return;
      }
      saved++;
      const after = parseDocument(result.source).toJS();
      const touched = touchedItems(map, operations);

      // Every ID stays, in order, and new stories get IDs nobody has used.
      for (const field of ["activities", "releases", "personas"]) {
        assert.deepEqual(ids(after[field]).slice(0, ids(map[field]).length), ids(map[field]), `${field} keep their IDs and order`);
      }
      assert.deepEqual(jobIdsOf(after).filter(id => jobIdsOf(map).includes(id)), jobIdsOf(map), "jobs keep their IDs and order");
      assert.deepEqual(ids(after.stories).filter(id => !result.addedIds.includes(id)), ids(map.stories), "stories keep their IDs and order");
      assert.equal(after.stories.length, map.stories.length + result.addedIds.length);
      for (const id of result.addedIds) assert.ok(!ids(map.stories).includes(id), `${id} was already used`);
      assert.equal(new Set(ids(after.stories)).size, after.stories.length, "no ID is given twice");

      // Stories that were not named are exactly as they were.
      for (const story of map.stories) {
        if (touched.stories.has(story.id)) continue;
        assert.deepEqual(after.stories.find(item => item.id === story.id), story, `${story.id} was not named but changed`);
      }

      // No edit removes draft.
      map.releases.forEach((release, i) => (release.impact ?? []).forEach((item, j) => {
        if (item.draft) assert.equal(after.releases[i].impact[j].draft, true, `${release.id} impact ${j + 1} lost draft`);
      }));
      for (const item of after.releases.flatMap(release => release.impact ?? []).filter(item => item.metric.startsWith("zqx added metric"))) {
        assert.equal(item.draft, true, "an impact item that edit adds is a draft");
      }
      (map.personas ?? []).forEach((persona, i) => {
        if (persona.context?.draft) assert.equal(after.personas[i].context.draft, true, `${persona.id} context lost draft`);
        (persona.jobs ?? []).forEach((job, j) => {
          if (job.draft) assert.equal(after.personas[i].jobs[j].draft, true, `${job.id} lost draft`);
        });
      });

      // Comments stay, and so does every line outside the items the edit changes.
      assert.deepEqual(comments(result.source), comments(source), "comments are kept");
      const changedLines = new Set([
        ...[...touched.stories].flatMap(id => linesOf(source, ["stories", map.stories.findIndex(story => story.id === id)])),
        ...[...touched.releases].flatMap(index => linesOf(source, ["releases", index])),
        ...[...touched.personas].flatMap(index => linesOf(source, ["personas", index])),
      ]);
      const kept = source.split("\n").filter((_, line) => !changedLines.has(line));
      assert.ok(isSubsequence(kept, result.source.split("\n")), "a line outside the edited items changed");

      assert.equal(result.changed, result.source !== source);
      if (!result.valid) return;
      // The diff names exactly the stories that changed.
      const changed = map.stories.filter(story => !isDeepStrictEqual(after.stories.find(item => item.id === story.id), story)).map(story => story.id);
      assert.deepEqual(result.diff.stories.added.map(story => story.id).sort(), [...result.addedIds].sort());
      assert.deepEqual(result.diff.stories.removed, []);
      assert.deepEqual(result.diff.stories.updated.map(story => story.id).sort(), changed.sort());
    }),
    { numRuns },
  );
  assert.ok(saved >= numRuns / 2, `only ${saved} of ${numRuns} generated edits could be made, so the property checks too little`);
});

test("ESM-164: edit refuses customer copy without approval, a reason that does not fit the status, a used ID and a draft field", async () => {
  const refusal = fc.oneof(
    // Customer copy needs --customer, and the whole edit is refused with it.
    generatedEdit.map(({ source, map, operations }) => {
      const id = map.stories[0]?.id;
      return id && { source, operations: [{ op: "customer-title", id, title: "pubX1X" }, ...operations], expect: /^Edit 1: Customer-facing copy needs approval/ };
    }),
    // Blocked and cut need a reason, and other statuses take none.
    fc.tuple(generatedMap, fc.constantFrom(...storyStatuses), fc.nat()).map(([{ source, map }, status, n]) => {
      const story = map.stories[n % Math.max(map.stories.length, 1)];
      const needsReason = status === "blocked" || status === "cut";
      return story && {
        source,
        operations: [{ op: "status", id: story.id, status, ...(needsReason ? {} : { reason: "zqx why" }) }],
        expect: needsReason ? /needs a reason/ : /only for blocked and cut/,
      };
    }),
    // An ID is never reused, even a cut story's.
    fc.tuple(generatedMap, fc.nat()).map(([{ source, map }, n]) => {
      const story = map.stories[n % Math.max(map.stories.length, 1)];
      return story && { source, operations: [{ op: "add", id: story.id, title: "zqx again", activity: map.activities[0].id, release: map.releases[0].id }], expect: /already in the map/ };
    }),
    // No operation takes draft, so an edit cannot confirm one.
    fc.tuple(generatedMap, fc.constantFrom("set-job", "set-persona-context", "release-impact")).map(([{ source, map }, op]) => {
      const persona = map.personas?.find(item => op === "set-job" ? item.jobs : true);
      const operation = op === "release-impact" ? { op, release: map.releases[0].id, metric: "zqx m", expected: "zqx e", draft: false }
        : op === "set-job" ? persona && { op, job: persona.jobs[0].id, motivation: "zqx m", draft: false }
        : persona && { op, persona: persona.id, success: "zqx s", draft: false };
      return operation && { source, operations: [operation], expect: /Unrecognized key|unrecognized/i };
    }),
  ).filter(Boolean);
  await fc.assert(
    fc.asyncProperty(refusal, async ({ source, operations, expect }) => {
      await assert.rejects(proposeStoryMapEdit(source, operations), error => {
        assert.ok(error instanceof StoryMapEditError, String(error));
        assert.match(error.message, expect);
        return true;
      });
    }),
    { numRuns },
  );
});

test("ESM-164: the local edit server saves only persona edits and story changes, and leaves the file alone otherwise", async t => {
  const directory = await mkdtemp(join(tmpdir(), "story-map-property-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "story-map.yaml");
  const base = "http://localhost:3000";
  const local = new Set(localEditOperations);
  await fc.assert(
    fc.asyncProperty(generatedEdit, async ({ source, operations }) => {
      await writeFile(file, source);
      const server = createStoryMapEditServer({ map: file, authorize: () => true, enabled: true });
      const { editing } = await server.read(new Request(`${base}/story-map`, { headers: { Host: "localhost:3000" } }));
      const response = await server.handleRequest(new Request(`${base}${storyMapEditPath}`, {
        method: "POST",
        headers: { Host: "localhost:3000", Origin: base, "Content-Type": "application/json", "X-Story-Map-Token": editing.token },
        body: JSON.stringify({ revision: editing.revision, operations }),
      }));
      const written = await readFile(file, "utf8");
      if (!operations.every(operation => local.has(operation.op))) {
        assert.equal(response.status, 400, `${operations.map(operation => operation.op).join(", ")} must be refused`);
        assert.equal(written, source, "a refused save writes nothing");
        return;
      }
      if (response.status !== 200) {
        assert.equal(response.status, 422);
        assert.equal(written, source, "a refused save writes nothing");
        return;
      }
      // What it saved is what edit proposes, with every comment.
      assert.equal(written, (await proposeStoryMapEdit(source, operations)).source);
      assert.deepEqual(comments(written), comments(source));
    }),
    { numRuns: Math.max(10, Math.round(numRuns / 4)) },
  );
});

// The diff.

/** A change to one story field, applied to a copy of the map by `mutate`. */
const storyChange = fc.record({
  target: fc.nat(),
  field: fc.constantFrom(
    "title", "activity", "release", "status", "statusReason", "estimate", "priority", "tokens", "estimatedCostUsd",
    "dependsOn", "jobs", "personas", "updatedBy", "summary", "notes", "sources", "customer", "remove", "add",
  ),
  value: fc.nat({ max: 1000 }),
});

function mutate(map, changes) {
  const next = structuredClone(map);
  changes.forEach(({ target, field, value }, index) => {
    if (field === "add") {
      next.stories.push({ id: `NEW-${index}`, title: `zqx new ${index}`, activity: next.activities[0].id, release: next.releases[0].id, status: "planned" });
      return;
    }
    if (!next.stories.length) return;
    const at = target % next.stories.length;
    const story = next.stories[at];
    if (field === "remove") {
      next.stories.splice(at, 1);
      return;
    }
    const choose = list => list[value % list.length];
    const values = {
      title: `zqx changed ${value}`,
      activity: choose(next.activities).id,
      release: choose(next.releases).id,
      status: choose(storyStatuses),
      statusReason: value % 2 ? undefined : `zqx reason ${value}`,
      estimate: value % 2 ? undefined : choose(estimatePoints),
      priority: value % 2 ? undefined : choose(storyPriorities),
      tokens: value % 2 ? undefined : value,
      estimatedCostUsd: value % 2 ? undefined : value / 100,
      dependsOn: value % 2 ? undefined : [choose(next.stories).id],
      jobs: value % 2 ? undefined : [`zqx-job-${value}`],
      personas: value % 2 ? undefined : [`zqx-per-${value}`],
      updatedBy: value % 2 ? undefined : `zqx person ${value}`,
      summary: value % 2 ? undefined : `zqx summary ${value}`,
      notes: value % 2 ? undefined : `zqx notes ${value}`,
      sources: value % 2 ? undefined : [`docs/zqx-${value}.md`],
      customer: value % 2 ? undefined : { title: `pubX${value}X` },
    };
    if (values[field] === undefined) delete story[field];
    else story[field] = values[field];
  });
  return next;
}

test("ESM-164: a map compared with itself has no changes", () => {
  fc.assert(
    fc.property(generatedMap, ({ source }) => {
      const document = parseStoryMap(source);
      assert.equal(hasStoryMapChanges(diffStoryMaps(document, parseStoryMap(source))), false);
    }),
    { numRuns },
  );
});

test("ESM-164: the diff lists every story that was added, removed or changed, and no other", () => {
  fc.assert(
    fc.property(generatedMap, fc.array(storyChange, { minLength: 1, maxLength: 4 }), ({ source }, changes) => {
      const before = parseStoryMap(source);
      const after = mutate(before, changes);
      const diff = diffStoryMaps(before, after);
      const old = new Map(before.stories.map(story => [story.id, story]));
      const current = new Map(after.stories.map(story => [story.id, story]));
      assert.deepEqual(diff.stories.added.map(story => story.id), ids(after.stories).filter(id => !old.has(id)));
      assert.deepEqual(diff.stories.removed.map(story => story.id), ids(before.stories).filter(id => !current.has(id)));
      const changed = after.stories.filter(story => old.has(story.id) && !isDeepStrictEqual(old.get(story.id), story)).map(story => story.id);
      assert.deepEqual(diff.stories.updated.map(story => story.id), changed);
      assert.equal(hasStoryMapChanges(diff), !isDeepStrictEqual(before.stories, after.stories));
    }),
    { numRuns },
  );
});
