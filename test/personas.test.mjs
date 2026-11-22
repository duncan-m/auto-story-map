import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import fc from "fast-check";
import { stringify } from "yaml";
import {
  diffStoryMaps,
  formatStoryMapDiff,
  hasStoryMapChanges,
  jobStatement,
  parseStoryMap,
  proposeStoryMapEdit,
  storyMapWarnings,
  storyPersonas,
  StoryMapValidationError,
} from "auto-story-map";

const fixture = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
const plain = parseStoryMap(fixture);
const numRuns = Number(process.env.FC_NUM_RUNS) || 100;

const personas = [
  {
    id: "builder",
    title: "Builder",
    summary: "Prices and orders the materials for a project.",
    jobs: [
      { id: "price-materials", situation: "I am pricing a project", motivation: "to use the catalogue prices", outcome: "my estimate matches what finance pays" },
      { id: "send-estimate", situation: "my estimate is ready", motivation: "to send it for approval in one step", outcome: "I do not chase finance by email", draft: true },
    ],
  },
  {
    id: "finance",
    title: "Finance reviewer",
    jobs: [
      { id: "approve-estimate", situation: "an estimate arrives", motivation: "to see the prices the builder saw", outcome: "I can approve it without asking" },
    ],
    customer: { title: "Finance teams" },
  },
];

/** The fixture with personas, and every active story tagged, so it has no persona warnings. */
function tagged(edit = () => {}) {
  const document = structuredClone(plain);
  document.personas = structuredClone(personas);
  const tags = {
    "BUILDER-101": { jobs: ["price-materials"] },
    "BUILDER-102": { jobs: ["price-materials", "approve-estimate"] },
    "BUILDER-103": { jobs: ["send-estimate"] },
    "FINANCE-201": { personas: ["finance"], jobs: ["approve-estimate"] },
  };
  for (const story of document.stories) Object.assign(story, tags[story.id] ?? {});
  edit(document);
  return document;
}

const parse = document => parseStoryMap(stringify(document));
const personaWarnings = map => storyMapWarnings(map).filter(warning => warning.path[0] === "personas" || warning.path.includes("personas"));

function issuesOf(document) {
  try {
    parse(document);
  } catch (error) {
    assert.ok(error instanceof StoryMapValidationError);
    return error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
  }
  assert.fail("expected the map to be invalid");
}

test("ESM-901: accepts personas, jobs and story tags, and resolves each story's personas", () => {
  const map = parse(tagged());
  assert.equal(map.personas.length, 2);
  assert.deepEqual(map.stories.find(story => story.id === "BUILDER-102").jobs, ["price-materials", "approve-estimate"]);
  assert.deepEqual(personaWarnings(map), []);

  // Owners of its jobs in job order come first, then the personas it lists, without repeats.
  assert.deepEqual(storyPersonas(map, { jobs: ["approve-estimate", "price-materials"] }), ["finance", "builder"]);
  assert.deepEqual(storyPersonas(map, { jobs: ["price-materials"], personas: ["finance", "builder"] }), ["builder", "finance"]);
  assert.deepEqual(storyPersonas(map, {}), []);
  assert.deepEqual(storyPersonas(plain, { jobs: ["price-materials"] }), []);

  assert.equal(jobStatement(personas[0].jobs[0]), "When I am pricing a project, I want to use the catalogue prices, so my estimate matches what finance pays.");
  assert.equal(jobStatement({ situation: "a", motivation: "b", outcome: "c." }), "When a, I want b, so c.");
  assert.equal(jobStatement({ situation: "a", motivation: "b", outcome: "c?!." }), "When a, I want b, so c.");
  // Many marks that do not end the text stay quick: the check scans back from the end once.
  const marks = "!".repeat(200_000);
  const started = performance.now();
  assert.equal(jobStatement({ situation: "a", motivation: "b", outcome: `${marks}x` }), `When a, I want b, so ${marks}x.`);
  assert.ok(performance.now() - started < 200, "linear in the outcome's length");
});

test("ESM-901: rejects duplicate, unknown and repeated persona and job IDs", () => {
  const issues = issuesOf(tagged(document => {
    document.personas.push({ id: "builder", title: "Second builder" });
    document.personas[1].jobs.push({ id: "price-materials", situation: "a", motivation: "b", outcome: "c" });
    const story = document.stories[0];
    story.jobs = ["price-materials", "price-materials", "invent-job"];
    story.personas = ["nobody"];
  }));
  assert.deepEqual(issues.sort(), [
    "personas.1.jobs.1.id: Duplicate job ID 'price-materials'. Job IDs are unique across the map.",
    "personas.2.id: Duplicate ID 'builder'.",
    "stories.0.jobs.1: Job 'price-materials' is listed twice.",
    "stories.0.jobs.2: Unknown job 'invent-job'.",
    "stories.0.personas.0: Unknown persona 'nobody'.",
  ]);
});

test("ESM-901: limits personas, jobs, tags and job statements", () => {
  const job = index => ({ id: `job-${index}`, situation: "a", motivation: "b", outcome: "c" });
  const issues = issuesOf(tagged(document => {
    document.personas[0].jobs = Array.from({ length: 9 }, (_, index) => job(index));
    document.personas[1].jobs[0].outcome = "x".repeat(201);
    delete document.personas[1].jobs[0].situation;
    document.stories[0].jobs = ["job-0", "job-1", "job-2", "job-3", "job-4"];
  }));
  const crowded = issuesOf(tagged(document => {
    for (let index = 0; index < 11; index++) document.personas.push({ id: `extra-${index}`, title: `Extra ${index}` });
  }));
  assert.deepEqual(crowded, ["personas: Too big: expected array to have <=12 items"]);
  for (const path of ["personas.0.jobs", "personas.1.jobs.0.situation", "personas.1.jobs.0.outcome", "stories.0.jobs"]) {
    assert.ok(issues.some(issue => issue.startsWith(`${path}: `)), `${path} in ${issues.join("\n")}`);
  }
});

test("ESM-901: warns about personas and jobs no story uses, untagged stories, unmatched personas and shipped drafts", () => {
  const map = parse(tagged(document => {
    document.personas.push({ id: "auditor", title: "Auditor" });
    for (const story of document.stories) {
      if (story.id !== "FINANCE-201") story.status = story.status === "cut" ? "cut" : "shipped";
    }
    const finance = document.stories.find(story => story.id === "FINANCE-201");
    delete finance.jobs;
    // Cut stories do not serve a job, so approve-estimate keeps only BUILDER-102.
    document.stories.find(story => story.id === "BUILDER-102").jobs = ["price-materials"];
    delete document.stories.find(story => story.id === "BUILDER-101").jobs;
    document.stories.find(story => story.id === "FINANCE-202").jobs = ["approve-estimate"];
  }));
  const messages = personaWarnings(map).map(warning => `${warning.path.join(".")} (${warning.itemId ?? "map"}): ${warning.message}`);
  assert.deepEqual(messages.sort(), [
    "personas.1.jobs.0 (finance): Job approve-estimate (Finance reviewer) has no stories.",
    "personas.2 (auditor): No story is for Auditor. Tag the stories that serve them, or remove the persona.",
    "personas.0.jobs.1.draft (builder): Confirm the drafted job send-estimate and remove draft: true. Stories that serve it have shipped.",
    "stories.3.personas.0 (FINANCE-201): For Finance reviewer, but serves none of their jobs, so it may not match a known need. Add the job it serves, or draft one.",
  ].sort());

  // More than half untagged: the map-wide warning.
  const untagged = parse(tagged(document => {
    for (const story of document.stories.slice(0, 3)) delete story.jobs;
  }));
  assert.ok(personaWarnings(untagged).some(warning => warning.message === "3 of 4 active stories do not say who they are for. Add the jobs each serves, or its personas."));
});

test("ESM-901: maps without personas, and personas with no active stories yet, get no persona warnings", () => {
  assert.deepEqual(personaWarnings(plain), []);
  const unstarted = parse(tagged(document => {
    for (const story of document.stories) {
      story.status = "cut";
      story.statusReason = "Not this year.";
    }
  }));
  assert.deepEqual(personaWarnings(unstarted), []);
});

test("ESM-901: diffs report persona, job and story tag changes", () => {
  const before = parse(tagged());
  const after = parse(tagged(document => {
    document.personas[0].title = "Site builder";
    document.personas[0].jobs[0].outcome = "my estimate is right first time";
    delete document.personas[0].jobs[1].draft;
    document.personas[1].jobs.push(document.personas[0].jobs.splice(0, 1)[0]);
    document.personas.push({ id: "auditor", title: "Auditor", jobs: [{ id: "audit", situation: "a quarter ends", motivation: "to see who approved what", outcome: "audits take a day" }] });
    document.personas[1].customer = { title: "Finance" };
    const story = document.stories.find(item => item.id === "BUILDER-101");
    story.jobs = ["send-estimate"];
    story.personas = ["auditor"];
  }));
  const diff = diffStoryMaps(before, after);
  assert.deepEqual(diff.personas.added, [{ id: "auditor", title: "Auditor" }]);
  assert.deepEqual(diff.personas.renamed, [{ id: "builder", title: "Site builder", from: "Builder" }]);
  assert.deepEqual(diff.personas.customerLabelChanged, [{ id: "finance", title: "Finance reviewer" }]);
  assert.deepEqual(diff.jobs.added.map(job => job.id), ["audit"]);
  assert.deepEqual(diff.jobs.moved, [{ id: "price-materials", persona: "Finance reviewer", from: "Builder", statement: "When I am pricing a project, I want to use the catalogue prices, so my estimate is right first time." }]);
  assert.deepEqual(diff.jobs.reworded.map(job => job.id), ["price-materials"]);
  assert.deepEqual(diff.jobs.confirmed.map(job => job.id), ["send-estimate"]);
  assert.deepEqual(diff.jobs.removed, []);
  const update = diff.stories.updated.find(item => item.id === "BUILDER-101");
  assert.deepEqual(update.jobs, { from: ["price-materials"], to: ["send-estimate"] });
  assert.deepEqual(update.personas, { from: [], to: ["auditor"] });

  const markdown = formatStoryMapDiff(diff);
  assert.match(markdown, /### Personas and jobs/);
  assert.match(markdown, /- Added persona `auditor` Auditor/);
  assert.match(markdown, /- Renamed persona `builder` from “Builder” to “Site builder”/);
  assert.match(markdown, /- Changed the customer-facing label of persona `finance` Finance reviewer/);
  assert.match(markdown, /- Added job `audit` \(Auditor\): When a quarter ends, I want to see who approved what, so audits take a day\./);
  assert.match(markdown, /- Moved job `price-materials` from Builder to Finance reviewer/);
  assert.match(markdown, /- Reworded job `price-materials` \(Finance reviewer\)/);
  assert.match(markdown, /- Confirmed drafted job `send-estimate` \(Site builder\)/);
  assert.match(markdown, /Jobs: `price-materials` → `send-estimate`<br>Personas: none → `auditor`/);

  const removed = diffStoryMaps(before, parse(tagged(document => {
    document.personas.reverse();
    document.personas[1].jobs.pop();
    document.stories.find(item => item.id === "BUILDER-103").jobs = ["price-materials"];
  })));
  assert.deepEqual(removed.jobs.removed.map(job => job.id), ["send-estimate"]);
  assert.equal(removed.personas.reordered, true);
  assert.match(formatStoryMapDiff(removed), /- Reordered the personas\n- Removed job `send-estimate` \(Builder\)/);

  assert.equal(hasStoryMapChanges(diffStoryMaps(before, before)), false);
  assert.equal(hasStoryMapChanges(diffStoryMaps(before, parse(tagged(document => { document.personas[0].jobs[0].draft = true; })))), true);
});

test("ESM-901: story-map edit adds and removes jobs and personas", async () => {
  const source = stringify(tagged());
  const added = await proposeStoryMapEdit(source, [
    { op: "add-job", id: "BUILDER-101", job: "send-estimate" },
    { op: "add-persona", id: "BUILDER-101", persona: "finance" },
    { op: "remove-job", id: "FINANCE-201", job: "approve-estimate" },
  ]);
  assert.equal(added.valid, true);
  const map = parseStoryMap(added.source);
  assert.deepEqual(map.stories.find(story => story.id === "BUILDER-101").jobs, ["price-materials", "send-estimate"]);
  assert.deepEqual(map.stories.find(story => story.id === "BUILDER-101").personas, ["finance"]);
  assert.equal(map.stories.find(story => story.id === "FINANCE-201").jobs, undefined);
  assert.match(added.summary, /Jobs: `price-materials` → `price-materials`, `send-estimate`/);
  assert.ok(added.newIssues.some(issue => issue.itemId === "FINANCE-201" && /serves none of their jobs/.test(issue.message)));

  const unknown = await proposeStoryMapEdit(source, [{ op: "add-job", id: "BUILDER-101", job: "invent-job" }]);
  assert.equal(unknown.valid, false);
  assert.ok(unknown.newIssues.some(issue => issue.message === "Unknown job 'invent-job'."));

  await assert.rejects(proposeStoryMapEdit(source, [{ op: "remove-persona", id: "BUILDER-101", persona: "finance" }]), /BUILDER-101 has no persona finance\./);

  const story = await proposeStoryMapEdit(source, [{ op: "add", title: "Approve in bulk", activity: "submit", release: "builder-mvp", jobs: ["approve-estimate"] }]);
  assert.deepEqual(parseStoryMap(story.source).stories.find(item => item.id === story.addedIds[0]).jobs, ["approve-estimate"]);
});

test("ESM-901: every persona and job reference survives a parse round trip", () => {
  const slug = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
  const words = fc.stringMatching(/^[A-Za-z][A-Za-z ,'-]{0,40}[A-Za-z]$/);
  const persona = fc.record({
    id: slug,
    title: words,
    jobs: fc.option(fc.array(fc.record({ id: slug, situation: words, motivation: words, outcome: words, draft: fc.option(fc.constant(true), { nil: undefined }) }, { requiredKeys: ["id", "situation", "motivation", "outcome"] }), { maxLength: 3 }), { nil: undefined }),
  }, { requiredKeys: ["id", "title"] });
  const unique = list => {
    const seen = new Set();
    return list.filter(item => !seen.has(item.id) && seen.add(item.id));
  };
  fc.assert(fc.property(fc.array(persona, { minLength: 1, maxLength: 5 }), fc.array(fc.nat(), { minLength: 5, maxLength: 20 }), (raw, picks) => {
    const seenJobs = new Set();
    const generated = unique(raw).map(item => ({
      ...item,
      ...(item.jobs ? { jobs: item.jobs.filter(job => !seenJobs.has(job.id) && seenJobs.add(job.id)) } : {}),
    }));
    const jobIds = generated.flatMap(item => (item.jobs ?? []).map(job => job.id));
    const personaIds = generated.map(item => item.id);
    const document = structuredClone(plain);
    document.personas = generated;
    document.stories.forEach((story, index) => {
      const pick = (ids, offset) => [...new Set(ids.length ? [ids[picks[(index + offset) % picks.length] % ids.length]] : [])];
      if (picks[index] % 3 !== 0) story.jobs = pick(jobIds, 1);
      if (picks[index] % 2 === 0) story.personas = pick(personaIds, 2);
      if (!story.jobs?.length) delete story.jobs;
      if (!story.personas?.length) delete story.personas;
    });
    const once = parse(document);
    const twice = parseStoryMap(stringify(once));
    assert.deepEqual(twice.personas, once.personas);
    assert.deepEqual(twice.stories.map(story => [story.jobs, story.personas]), document.stories.map(story => [story.jobs, story.personas]));
    for (const story of twice.stories) assert.deepEqual(storyPersonas(twice, story), storyPersonas(once, story));
  }), { numRuns });
});
