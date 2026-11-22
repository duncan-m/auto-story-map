import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stringify } from "yaml";
import {
  diffStoryMaps,
  formatStoryMapDiff,
  hasStoryMapChanges,
  jobStatement,
  filterStoryMapView,
  getStoryMapForViewer,
  getStoryMapPage,
  parseStoryMap,
  personaInitials,
  proposeStoryMapEdit,
  readStoryMapFilters,
  storyMapToCsv,
  storyMapToJson,
  storyMapToVsdx,
  storyMapWarnings,
  storyPersonas,
  StoryMapValidationError,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

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

const engineer = { roles: ["engineer"] };
const render = view => renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));

/** The markup of the story panel whose title is `title`. */
function panelFor(html, title) {
  const panels = html.match(/<div class="esm-detail[" ][\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$)/g) ?? [];
  return panels.find(panel => panel.includes(`>${title}</h3>`));
}

/** The markup of the card whose title is `title`. */
function cardFor(html, title) {
  const end = html.indexOf(`<span class="esm-card-title">${title}</span>`);
  return html.slice(html.lastIndexOf('<button type="button" class="esm-card"', end), end);
}

test("ESM-902: takes avatar initials from the persona title", () => {
  assert.equal(personaInitials("Product manager"), "PM");
  assert.equal(personaInitials("Engineer"), "EN");
  assert.equal(personaInitials("Coding agent (CI)"), "CA");
  assert.equal(personaInitials("  über-user "), "ÜU");
  assert.equal(personaInitials("Ö"), "Ö");
  assert.equal(personaInitials("!!!"), "?");
});

test("ESM-902: internal views carry personas and each story's personas and jobs", () => {
  const map = parse(tagged(document => {
    document.personas.push(...Array.from({ length: 6 }, (_, index) => ({ id: `extra-${index}`, title: `Extra ${index}` })));
    document.stories.find(story => story.id === "BUILDER-101").personas = ["extra-5"];
  }));
  const view = getStoryMapForViewer(map, engineer);
  assert.deepEqual(view.personas.slice(0, 2).map(({ id, title, initials, colour }) => ({ id, title, initials, colour })), [
    { id: "builder", title: "Builder", initials: "BU", colour: 0 },
    { id: "finance", title: "Finance reviewer", initials: "FR", colour: 1 },
  ]);
  assert.equal(view.personas.at(-1).colour, 1, "the seventh persona starts the colours again");
  assert.deepEqual(view.personas[0].jobs.map(job => job.id), ["price-materials", "send-estimate"]);
  const story = id => view.stories.find(item => item.id === id);
  assert.deepEqual([story("BUILDER-101").personas, story("BUILDER-101").jobs], [["builder", "extra-5"], ["price-materials"]]);
  assert.deepEqual([story("BUILDER-102").personas, story("BUILDER-102").jobs], [["builder", "finance"], ["price-materials", "approve-estimate"]]);
  assert.equal(Object.hasOwn(story("FINANCE-202"), "personas"), false);
  assert.equal(Object.hasOwn(story("FINANCE-202"), "jobs"), false);

  const customer = JSON.stringify(getStoryMapForViewer(map, { roles: ["member"] }));
  assert.doesNotMatch(customer, /"personas"|"jobs"|price-materials|Finance reviewer|"Builder"/);
});

test("ESM-902: cards, activities and the story panel show who a story is for", () => {
  const map = parse(tagged(document => {
    document.personas.push({ id: "auditor", title: "Auditor" }, { id: "buyer", title: "Buyer" });
    document.stories.find(story => story.id === "BUILDER-102").personas = ["auditor", "buyer"];
    document.stories.find(story => story.id === "BUILDER-103").estimate = 3;
  }));
  const html = render(getStoryMapForViewer(map, engineer));

  // Up to three avatars, then “+N”, with the titles for screen readers instead of the initials.
  const crowded = cardFor(html, "Look up prices in the material catalogue");
  assert.match(crowded, /<span class="esm-card-head"><span class="esm-card-id">BUILDER-102<\/span><span class="esm-card-tags"><span class="esm-avatars" title="For Builder, Finance reviewer, Auditor and Buyer">/);
  assert.equal(crowded.match(/class="esm-avatar" data-persona/g).length, 3);
  assert.match(crowded, /<span class="esm-avatar esm-avatar-more" aria-hidden="true">\+1<\/span><span class="esm-visually-hidden">For Builder, Finance reviewer, Auditor and Buyer<\/span>/);
  assert.match(crowded, /<span class="esm-avatar" data-persona="0" aria-hidden="true">BU<\/span>/);

  // Avatars sit beside the estimate when the story has one.
  assert.match(cardFor(html, "Submit the estimate to finance"), /<span class="esm-card-tags"><span class="esm-avatars" title="For Builder">.*<\/span><span class="esm-estimate"/);

  // Activity avatars come from the activity's active stories.
  const activity = html.slice(html.indexOf(">Prepare estimate<"), html.indexOf(">Submit for finance review<"));
  assert.match(activity, /title="For Builder, Finance reviewer, Auditor and Buyer"/);
  const exceptions = html.slice(html.indexOf(">Finance exception handling<"), html.indexOf("esm-lane"));
  assert.doesNotMatch(exceptions, /esm-avatar/, "a cut story does not count for its activity");

  const panel = panelFor(html, "Look up prices in the material catalogue");
  assert.match(panel, /<dt>For<\/dt><dd class="esm-persona-row"><span class="esm-persona-chip"><span class="esm-avatar" data-persona="0" aria-hidden="true">BU<\/span>Builder<\/span>/);
  assert.match(panel, /<dt>Jobs<\/dt><dd><ul class="esm-story-jobs"><li><b>When<\/b> I am pricing a project, <b>I want<\/b> to use the catalogue prices, <b>so<\/b> my estimate matches what finance pays\. <span class="esm-story-job-persona">· Builder<\/span><\/li>/);
  assert.ok(panel.indexOf("<dt>For</dt>") < panel.indexOf("<dt>Activity</dt>"), "For comes first");
  assert.match(panelFor(html, "Submit the estimate to finance"), /so<\/b> I do not chase finance by email\. <span class="esm-story-job-persona">· Builder<\/span> <span class="esm-draft"/);
});

test("ESM-902: a map without personas renders as before", () => {
  const view = getStoryMapForViewer(plain, engineer);
  assert.equal(Object.hasOwn(view, "personas"), false);
  assert.ok(view.stories.every(story => !Object.hasOwn(story, "personas") && !Object.hasOwn(story, "jobs")));
  const html = render(view);
  assert.doesNotMatch(html, /esm-avatar|esm-card-tags|esm-persona|esm-story-jobs|<dt>For<\/dt>|<dt>Jobs<\/dt>/);
  // A tagged map's customer board shows nothing about personas.
  assert.doesNotMatch(render(getStoryMapForViewer(parse(tagged()), { roles: ["member"] })), /esm-avatar|esm-persona|<dt>For<\/dt>/);
});

const ids = view => view.stories.map(story => story.id);
const page = (map, query, viewer = engineer, options = {}) => getStoryMapPage(map, viewer, { searchParams: new URLSearchParams(query), ...options });

test("ESM-903: reads repeated persona and job parameters", () => {
  const filters = readStoryMapFilters(new URLSearchParams("persona=builder&persona=finance&persona=builder&persona=bad%20id&job=price-materials&q=x"));
  assert.deepEqual(filters.persona, ["builder", "finance"]);
  assert.deepEqual(filters.job, ["price-materials"]);
  assert.equal(Object.hasOwn(readStoryMapFilters(new URLSearchParams("q=x")), "persona"), false);
  assert.equal(readStoryMapFilters(new URLSearchParams(Array.from({ length: 30 }, (_, index) => `persona=p${index}`).join("&"))).persona.length, 20);
});

test("ESM-903: filters by persona and job, alone and with the other filters", () => {
  const map = parse(tagged());
  // Any chosen persona: BUILDER-102 is for both, FINANCE-201 for Finance reviewer.
  assert.deepEqual(ids(page(map, "persona=finance")), ["BUILDER-102", "FINANCE-201"]);
  assert.deepEqual(ids(page(map, "persona=finance&persona=builder")), ["BUILDER-101", "BUILDER-102", "BUILDER-103", "FINANCE-201"]);
  assert.deepEqual(page(map, "persona=finance&persona=builder").filter.persona, ["builder", "finance"], "in map order");
  assert.deepEqual(ids(page(map, "job=price-materials")), ["BUILDER-101", "BUILDER-102"]);
  assert.deepEqual(ids(page(map, "job=price-materials&persona=finance")), ["BUILDER-102"]);
  assert.deepEqual(ids(page(map, "persona=builder&status=planned&q=submit the estimate")), ["BUILDER-103"]);

  // Unknown IDs are ignored, so the board is not narrowed by them.
  const unknown = page(map, "persona=nobody&job=invent-job");
  assert.equal(unknown.stories.length, 4);
  assert.equal(Object.hasOwn(unknown.filter, "persona"), false);
  assert.equal(Object.hasOwn(unknown.filter, "job"), false);

  // A persona with no stories narrows to nothing.
  const empty = parse(tagged(document => document.personas.push({ id: "auditor", title: "Auditor" })));
  assert.deepEqual(ids(page(empty, "persona=auditor")), []);
  assert.match(render(page(empty, "persona=auditor")), /No stories match these filters\./);
  // A job with no active stories narrows to nothing, and blocked and cut stories stay hidden by default.
  const cutOnly = parse(tagged(document => { document.stories.find(story => story.id === "FINANCE-202").jobs = ["send-estimate"]; }));
  assert.deepEqual(ids(page(cutOnly, "job=send-estimate")), ["BUILDER-103"]);
  assert.deepEqual(ids(page(cutOnly, "job=send-estimate&status=all")), ["BUILDER-103", "FINANCE-202"]);

  // Called directly, a single value works too.
  assert.deepEqual(ids(filterStoryMapView(getStoryMapForViewer(map, engineer), { persona: "finance" })), ["BUILDER-102", "FINANCE-201"]);
});

test("ESM-903: search matches persona titles and job statements for internal viewers", () => {
  const map = parse(tagged());
  assert.deepEqual(ids(page(map, "q=finance reviewer")), ["BUILDER-102", "FINANCE-201"]);
  assert.deepEqual(ids(page(map, "q=chase finance by email")), ["BUILDER-103"]);
});

test("ESM-903: customers' persona and job parameters do not reach internal personas", () => {
  const map = parse(tagged());
  const customer = { roles: ["member"] };
  const everything = page(map, "", customer);
  for (const query of ["persona=finance", "persona=builder&job=price-materials", "job=approve-estimate", "q=finance reviewer"]) {
    const view = page(map, query, customer);
    if (query.startsWith("q=")) {
      assert.equal(view.stories.length, 0, "customer search does not match internal persona titles");
      continue;
    }
    assert.deepEqual(view.stories, everything.stories, query);
    assert.equal(Object.hasOwn(view.filter, "persona"), false);
    assert.equal(Object.hasOwn(view.filter, "job"), false);
  }
  assert.doesNotMatch(render(page(map, "persona=finance", customer)), /esm-personas|esm-persona-menu|Show everyone/);
});

test("ESM-903: the persona strip and menu set the persona parameter and keep the other filters", () => {
  const map = parse(tagged(document => document.personas.push({ id: "auditor", title: "Auditor" })));
  const html = renderToStaticMarkup(createElement(StoryMapBoard, {
    map: page(map, "q=estimate&status=planned&status=in-progress&persona=builder"),
    preservedParams: { tab: "roadmap" },
  }));
  const strip = html.slice(html.indexOf('<nav class="esm-personas"'), html.indexOf("</nav>"));
  // Counts are active stories before any filter.
  assert.match(strip, /<a class="esm-persona-chip" href="\?tab=roadmap&amp;q=estimate&amp;status=planned&amp;status=in-progress" aria-current="true"><span class="esm-avatar" data-persona="0" aria-hidden="true">BU<\/span>Builder<span class="esm-persona-count"><span aria-hidden="true">3<\/span><span class="esm-visually-hidden">, 3 stories<\/span><\/span><\/a>/);
  assert.match(strip, /href="\?tab=roadmap&amp;q=estimate&amp;status=planned&amp;status=in-progress&amp;persona=finance">.*Finance reviewer<span class="esm-persona-count"><span aria-hidden="true">2</);
  assert.match(strip, /Auditor<span class="esm-persona-count"><span aria-hidden="true">0</);
  assert.match(strip, /<a class="esm-persona-clear" href="\?tab=roadmap&amp;q=estimate&amp;status=planned&amp;status=in-progress">Show everyone<\/a>/);

  const menu = html.slice(html.indexOf('<details class="esm-menu esm-persona-menu"'), html.indexOf("</details>", html.indexOf("esm-persona-menu")));
  assert.match(menu, /<summary class="esm-select esm-menu-button" data-esm-focus="persona" aria-describedby="[^"]+"><span class="esm-visually-hidden">For: <\/span>Builder<\/summary>/);
  assert.match(menu, /<input type="checkbox" name="persona" checked="" value="builder"\/>/);
  assert.match(menu, /<input type="checkbox" name="persona" value="finance"\/>/);
  assert.match(html, /Showing 3 of 5 stories\./);

  // Without a chosen persona: no current chip, no Show everyone, and the menu says Everyone.
  const plainHtml = render(page(map, ""));
  assert.doesNotMatch(plainHtml, /aria-current="true"|Show everyone/);
  assert.match(plainHtml, /For: <\/span>Everyone<\/summary>/);
  // Maps without personas get neither.
  assert.doesNotMatch(render(page(plain, "persona=builder")), /esm-personas|esm-persona-menu/);
});

test("ESM-903: the job filter is kept by the form and named in the filter summary", () => {
  const map = parse(tagged());
  const html = render(page(map, "persona=builder&job=send-estimate"));
  assert.match(html, /<input type="hidden" name="job" value="send-estimate"\/>/);
  assert.match(html, /Showing 1 of 5 stories\. Stories serving the job “<b>When<\/b> my estimate is ready, <b>I want<\/b> to send it for approval in one step, <b>so<\/b> I do not chase finance by email\.” <span class="esm-story-job-persona">\(Builder\)<\/span>\. <a href="\?persona=builder">Show every job<\/a>/);
  // The chosen persona's chip clears the job too, and Show everyone clears both.
  assert.match(html, /<a class="esm-persona-chip" href="\?persona=builder" aria-current="true">/);
  assert.match(html, /<a class="esm-persona-clear" href="\?">Show everyone<\/a>/);
  // Show them, for hidden blocked and cut stories, keeps the persona and job.
  const cut = parse(tagged(document => { document.stories.find(story => story.id === "FINANCE-202").jobs = ["send-estimate"]; }));
  assert.match(render(page(cut, "persona=builder&job=send-estimate")), /1 cut hidden\. <a href="\?status=all&amp;persona=builder&amp;job=send-estimate">Show them<\/a>/);
});

test("ESM-903: board.js applies the persona menu when it closes, and returns focus to it", async t => {
  class FakeNode {}
  class FakeElement extends FakeNode {}
  const storage = new Map();
  const globals = {
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLInputElement: class {},
    HTMLSelectElement: class {},
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { readyState: "complete", querySelectorAll: () => [], addEventListener: () => {} },
  };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  let submitted = 0;
  const listeners = {};
  const menu = Object.assign(new FakeElement(), {
    open: true,
    closest: () => ({ requestSubmit: () => submitted++ }),
    contains: () => true,
    querySelector: selector => selector === "[data-esm-focus]" ? { dataset: { esmFocus: "persona" } } : {},
    addEventListener: (type, handler) => { listeners[type] = handler; },
  });
  const { enhanceStoryMapMenus } = await import("auto-story-map/board.js");
  enhanceStoryMapMenus({ querySelectorAll: () => [menu] });
  listeners.change();
  menu.open = false;
  listeners.toggle();
  assert.equal(submitted, 1);
  assert.equal(storage.get("esm-filter-focus"), "persona");
});

/** Parses RFC 4180 CSV, as written by storyMapToCsv, into rows of fields. */
function csvRows(text) {
  assert.ok(text.startsWith("\uFEFF"));
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 1; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\r" && text[index + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; index++; }
    else field += char;
  }
  return rows;
}

test("ESM-906: the CSV export adds Personas and Jobs columns when the map has personas", () => {
  const rows = csvRows(storyMapToCsv(getStoryMapForViewer(parse(tagged()), engineer)));
  assert.deepEqual(rows[0], ["Activity", "Release", "ID", "Title", "Estimate", "Personas", "Jobs"]);
  const row = id => rows.find(item => item[2] === id);
  assert.deepEqual(row("BUILDER-102").slice(5), ["Builder; Finance reviewer", "price-materials; approve-estimate"]);
  assert.deepEqual(row("BUILDER-103").slice(5), ["Builder", "send-estimate"]);
  assert.deepEqual(row("FINANCE-202").slice(5), ["", ""]);
  assert.ok(rows.every(item => item.length === 7));

  // Collapsed lanes keep the column count.
  const collapsed = csvRows(storyMapToCsv(getStoryMapForViewer(parse(tagged()), engineer), { collapsedReleases: ["builder-mvp"] }));
  assert.deepEqual(collapsed.find(item => item[1] === "Builder workflow").slice(5), ["", ""]);

  // Maps without personas keep the old columns.
  assert.deepEqual(csvRows(storyMapToCsv(getStoryMapForViewer(plain, engineer)))[0], ["Activity", "Release", "ID", "Title", "Estimate"]);
});

test("ESM-906: the CSV export escapes persona titles", () => {
  const map = parse(tagged(document => {
    document.personas[0].title = 'Builder, "site" lead';
    document.personas[1].title = "=Finance";
  }));
  const csv = storyMapToCsv(getStoryMapForViewer(map, engineer));
  assert.match(csv, /,"Builder, ""site"" lead; =Finance",/);
  assert.deepEqual(csvRows(csv).find(item => item[2] === "BUILDER-102")[5], 'Builder, "site" lead; =Finance');
  // A title that starts the field is guarded against formulas.
  assert.equal(csvRows(csv).find(item => item[2] === "FINANCE-201")[5], "'=Finance");
});

test("ESM-906: the JSON export lists personas with job statements and coverage, and each story's personas and jobs", () => {
  const json = JSON.parse(storyMapToJson(getStoryMapForViewer(parse(tagged()), engineer), { now: new Date("2026-11-20T09:00:00Z") }));
  assert.deepEqual(json.personas.map(({ id, title, activeStories }) => ({ id, title, activeStories })), [
    { id: "builder", title: "Builder", activeStories: 3 },
    { id: "finance", title: "Finance reviewer", activeStories: 2 },
  ]);
  const [price, send] = json.personas[0].jobs;
  assert.equal(price.statement, "When I am pricing a project, I want to use the catalogue prices, so my estimate matches what finance pays.");
  assert.equal(price.activeStories, 2);
  assert.equal(send.draft, true);
  assert.ok(!("initials" in json.personas[0]) && !("colour" in json.personas[0]));
  const story = json.stories.find(item => item.id === "BUILDER-102");
  assert.deepEqual([story.personas, story.jobs], [["builder", "finance"], ["price-materials", "approve-estimate"]]);
  assert.ok(json.provenance.notes.some(note => /Jobs with draft: true/.test(note)));

  // A job with no active stories counts 0, so an agent can find the gap; a cut story does not count.
  const gap = JSON.parse(storyMapToJson(getStoryMapForViewer(parse(tagged(document => {
    document.stories.find(item => item.id === "BUILDER-103").jobs = ["price-materials"];
    document.stories.find(item => item.id === "FINANCE-202").jobs = ["send-estimate"];
  })), engineer)));
  assert.equal(gap.personas[0].jobs.find(job => job.id === "send-estimate").activeStories, 0);

  // Maps without personas have no personas field or persona notes.
  const none = JSON.parse(storyMapToJson(getStoryMapForViewer(plain, engineer)));
  assert.ok(!("personas" in none));
  assert.ok(!none.provenance.notes.some(note => /persona|Jobs with/i.test(note)));
});

test("ESM-906: Visio cards carry Personas and Jobs shape data", () => {
  const xml = Buffer.from(storyMapToVsdx(getStoryMapForViewer(parse(tagged()), engineer), { now: new Date("2026-11-20T09:00:00Z") })).toString("utf8");
  assert.match(xml, /<Cell N="Value" V="Builder; Finance reviewer" U="STR"\/><Cell N="Label" V="Personas"\/>/);
  assert.match(xml, /<Cell N="Value" V="price-materials; approve-estimate" U="STR"\/><Cell N="Label" V="Jobs"\/>/);
  const none = Buffer.from(storyMapToVsdx(getStoryMapForViewer(plain, engineer))).toString("utf8");
  assert.doesNotMatch(none, /V="Personas"|V="Jobs"/);
});

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("ESM-906: story-map story shows personas and jobs, and stories filters by them", async t => {
  const directory = await mkdtemp(join(tmpdir(), "story-map-personas-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mapPath = join(directory, "map.yaml");
  await writeFile(mapPath, stringify(tagged()));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--map", mapPath], { encoding: "utf8" });

  const story = run("story", "BUILDER-103");
  assert.equal(story.status, 0, story.stderr);
  assert.match(story.stdout, /  For:       builder \(Builder\)\n  Jobs:\n    send-estimate  When my estimate is ready, I want to send it for approval in one step, so I do not chase finance by email\. \(Builder\) \[draft\]\n/);
  const json = JSON.parse(run("story", "BUILDER-102", "--format", "json").stdout);
  assert.deepEqual(json.stories[0].personas, ["builder", "finance"]);

  const ids = result => result.stdout.trim().split("\n").map(line => line.split(/\s+/)[0]);
  assert.deepEqual(ids(run("stories", "--persona", "finance")), ["BUILDER-102", "FINANCE-201"]);
  assert.deepEqual(ids(run("stories", "--job", "price-materials,send-estimate")), ["BUILDER-101", "BUILDER-102", "BUILDER-103"]);
  assert.deepEqual(ids(run("stories", "--persona", "finance", "--job", "price-materials")), ["BUILDER-102"]);
  const filtered = JSON.parse(run("stories", "--persona", "finance", "--format", "json").stdout);
  assert.deepEqual(filtered.filter.persona, ["finance"]);

  for (const [flag, id] of [["--persona", "nobody"], ["--job", "invent-job"]]) {
    const result = run("stories", flag, id);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${flag} ${id}: no ${flag.slice(2)} with this ID`));
  }
});
