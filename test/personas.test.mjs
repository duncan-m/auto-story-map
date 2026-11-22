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
  personaCoreJob,
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

  assert.equal(jobStatement(personas[0].jobs[0]), "When I am pricing a project, I want to use the catalogue prices, so that my estimate matches what finance pays.");
  assert.equal(jobStatement({ situation: "a", motivation: "b", outcome: "c." }), "When a, I want b, so that c.");
  assert.equal(jobStatement({ situation: "a", motivation: "b", outcome: "c?!." }), "When a, I want b, so that c.");
  // Many marks that do not end the text stay quick: the check scans back from the end once.
  const marks = "!".repeat(200_000);
  const started = performance.now();
  assert.equal(jobStatement({ situation: "a", motivation: "b", outcome: `${marks}x` }), `When a, I want b, so that ${marks}x.`);
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
    "personas.1.jobs.0 (finance): Core job approve-estimate (Finance reviewer) has no stories.",
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
  assert.deepEqual(diff.jobs.moved, [{ id: "price-materials", persona: "Finance reviewer", from: "Builder", statement: "When I am pricing a project, I want to use the catalogue prices, so that my estimate is right first time." }]);
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
  assert.match(markdown, /- Added job `audit` \(Auditor\): When a quarter ends, I want to see who approved what, so that audits take a day\./);
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

  // Customers see approved persona copy only (ESM-905), and never jobs.
  const customer = JSON.stringify(getStoryMapForViewer(map, { roles: ["member"] }));
  assert.doesNotMatch(customer, /"jobs"|price-materials|Finance reviewer|"Builder"|"finance"/);
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
  assert.match(panel, /<dt>For<\/dt><dd class="esm-persona-row"><button type="button" class="esm-persona-chip" aria-haspopup="dialog" popoverTarget="[^"]+-persona-0"><span class="esm-avatar" data-persona="0" aria-hidden="true">BU<\/span>Builder<\/button>/);
  assert.match(panel, /<dt>Jobs<\/dt><dd><ul class="esm-story-jobs"><li><b>When<\/b> I am pricing a project, <b>I want<\/b> to use the catalogue prices, <b>so that<\/b> my estimate matches what finance pays\. <span class="esm-story-job-persona">· Builder<\/span> <span class="esm-core-label">Core job<\/span><\/li>/);
  assert.ok(panel.indexOf("<dt>For</dt>") < panel.indexOf("<dt>Activity</dt>"), "For comes first");
  assert.match(panelFor(html, "Submit the estimate to finance"), /so that<\/b> I do not chase finance by email\. <span class="esm-story-job-persona">· Builder<\/span> <span class="esm-draft"/);
});

test("ESM-902: a map without personas renders as before", () => {
  const view = getStoryMapForViewer(plain, engineer);
  assert.equal(Object.hasOwn(view, "personas"), false);
  assert.ok(view.stories.every(story => !Object.hasOwn(story, "personas") && !Object.hasOwn(story, "jobs")));
  const html = render(view);
  assert.doesNotMatch(html, /esm-avatar|esm-card-tags|esm-persona|esm-story-jobs|<dt>For<\/dt>|<dt>Jobs<\/dt>/);
  // A tagged map's customer board shows no avatars or persona filter, even with an approved persona (ESM-905).
  assert.doesNotMatch(render(getStoryMapForViewer(parse(tagged()), { roles: ["member"] })), /esm-avatar|esm-persona/);
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
  // The only chosen persona's chip opens their panel (ESM-904), and Show everyone goes back.
  assert.match(strip, /<button type="button" class="esm-persona-chip" aria-current="true" aria-haspopup="dialog" popoverTarget="[^"]+-persona-0"><span class="esm-avatar" data-persona="0" aria-hidden="true">BU<\/span>Builder<span class="esm-persona-count"><span aria-hidden="true">3<\/span><span class="esm-visually-hidden">, 3 stories<\/span><\/span><\/button>/);
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
  assert.match(html, /Showing 1 of 5 stories\. Stories serving the job “<b>When<\/b> my estimate is ready, <b>I want<\/b> to send it for approval in one step, <b>so that<\/b> I do not chase finance by email\.” <span class="esm-story-job-persona">\(Builder\)<\/span>\. <a href="\?persona=builder">Show every job<\/a>/);
  // The chosen persona's chip clears the job too, and Show everyone clears both.
  assert.match(html, /<a class="esm-persona-chip" href="\?persona=builder" aria-current="true">/);
  assert.match(html, /<a class="esm-persona-clear" href="\?">Show everyone<\/a>/);
  // Show them, for hidden blocked and cut stories, keeps the persona and job.
  const cut = parse(tagged(document => { document.stories.find(story => story.id === "FINANCE-202").jobs = ["send-estimate"]; }));
  assert.match(render(page(cut, "persona=builder&job=send-estimate")), /1 cut hidden\. <a href="\?status=all&amp;persona=builder&amp;job=send-estimate">Show them<\/a>/);
});

/** The persona panel whose title is `title`. */
const personaPanelFor = (html, title) => {
  const panel = panelFor(html, title);
  assert.match(panel, /^<div class="esm-detail esm-persona-detail"/);
  return panel;
};
/** The list item of the job whose statement starts with `situation`. */
const jobFor = (panel, situation) => panel.match(new RegExp(`<li class="esm-job(?: esm-job-core)?">(?:(?!</li>).)*${situation}(?:(?!</li>).)*</li>`))?.[0];

test("ESM-904: counts the stories that serve each job by status, before any filter", () => {
  const map = parse(tagged(document => { document.stories.find(story => story.id === "FINANCE-202").jobs = ["approve-estimate"]; }));
  const view = getStoryMapForViewer(map, engineer);
  const counts = id => view.personas.flatMap(persona => persona.jobs).find(job => job.id === id).storyCounts;
  assert.deepEqual(counts("price-materials"), { planned: 1, "in-progress": 1, merged: 0, shipped: 0, blocked: 0, cut: 0 });
  assert.deepEqual(counts("approve-estimate"), { planned: 2, "in-progress": 0, merged: 0, shipped: 0, blocked: 0, cut: 1 });
  // Filters do not change the counts.
  assert.deepEqual(page(map, "persona=builder&q=submit").personas, view.personas);
});

test("ESM-904: the persona panel shows each job's coverage, drafts and gaps, with links to its stories", () => {
  const map = parse(tagged(document => {
    document.personas.push({ id: "auditor", title: "Auditor", summary: "Checks approved estimates.", jobs: [
      { id: "trace-approval", situation: "an approval is questioned", motivation: "to see who approved it", outcome: "I can answer the auditor" },
    ] });
    document.stories.find(story => story.id === "FINANCE-202").jobs = ["approve-estimate", "trace-approval"];
  }));
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: page(map, "q=estimate"), preservedParams: { tab: "roadmap" } }));

  const builder = personaPanelFor(html, "Builder");
  assert.match(builder, /<div class="esm-persona-head"><span class="esm-avatar esm-avatar-lg" data-persona="0" aria-hidden="true">BU<\/span><div><p class="esm-card-id">Persona<\/p><h3 id="[^"]+">Builder<\/h3>/);
  assert.match(builder, /<p class="esm-detail-summary">Prices and orders the materials for a project\.<\/p>/);
  assert.match(builder, /<h4 id="[^"]+">Jobs to be done<\/h4>/);
  // Bar segments in order, done first, and a count by status; the links keep the other filters but not the persona.
  const price = jobFor(builder, "I am pricing a project");
  assert.match(price, /<span class="esm-bar" aria-hidden="true"><span data-status="in-progress" style="width:50%"><\/span><span data-status="planned" style="width:50%"><\/span><\/span><span>2 stories: 1 in progress, 1 planned<\/span>/);
  assert.match(price, /<a href="\?tab=roadmap&amp;q=estimate&amp;job=price-materials" aria-describedby="([^"]+)">Show stories<\/a>/);
  assert.match(price, new RegExp(`<p class="esm-job-statement" id="${price.match(/aria-describedby="([^"]+)"/)[1]}">`));
  // Drafted jobs are labelled.
  assert.match(jobFor(builder, "my estimate is ready"), /<\/b> I do not chase finance by email\. <span class="esm-draft"[^>]*>Draft<\/span><\/p>.*<span>1 story planned<\/span>/);
  assert.match(builder, /<a href="\?tab=roadmap&amp;q=estimate&amp;persona=builder">Show only this persona’s stories<\/a>/);

  // Cut stories are left out of the bar and the count, and a job with only those has no stories yet.
  const approve = jobFor(personaPanelFor(html, "Finance reviewer"), "an estimate arrives");
  assert.match(approve, /<span data-status="planned" style="width:100%"><\/span><\/span><span>2 stories planned<\/span>.*<span class="esm-job-left">1 cut not counted<\/span>/);
  const trace = jobFor(personaPanelFor(html, "Auditor"), "an approval is questioned");
  assert.match(trace, /<span class="esm-job-gap">No stories yet<\/span><span class="esm-job-left">1 cut not counted<\/span>/);
  assert.doesNotMatch(trace, /esm-bar|Show stories/);
  // A persona with no jobs says so.
  const plainMap = parse(tagged(document => document.personas.push({ id: "buyer", title: "Buyer" })));
  assert.match(personaPanelFor(render(page(plainMap, "")), "Buyer"), /No jobs to be done yet\./);
});

test("ESM-904: the persona panel works without JavaScript, from chips, avatars and the story panel", () => {
  const map = parse(tagged());
  const html = render(page(map, "persona=builder"));
  const panel = personaPanelFor(html, "Builder");
  const id = panel.match(/^<div class="esm-detail esm-persona-detail" id="([^"]+)" popover="auto" role="dialog" aria-labelledby="\1-title">/)?.[1];
  assert.ok(id, "a popover dialog named by its title");
  assert.match(panel, new RegExp(`class="esm-close" aria-label="Close" autofocus="" popoverTarget="${id}" popoverTargetAction="hide"`));
  // Openers: the only chosen persona's chip, each activity avatar and the story panel's For row.
  const openers = html.match(new RegExp(`<button type="button" class="[^"]+"[^>]*popoverTarget="${id}"(?! popoverTargetAction)`, "g"));
  assert.ok(openers.some(opener => opener.includes('class="esm-persona-chip" aria-current="true"')));
  assert.ok(openers.some(opener => opener.includes('class="esm-avatar-button" aria-haspopup="dialog" aria-label="Builder: open persona"')));
  assert.ok(openers.some(opener => opener.includes('class="esm-persona-chip" aria-haspopup="dialog"') && !opener.includes("aria-current")));
  // Card avatars sit inside the card's button, so they stay plain.
  assert.doesNotMatch(cardFor(html, "Submit the estimate to finance"), /esm-avatar-button/);

  // Without the host's filters, the panel has no filter links. Customers get no persona panels.
  const unfiltered = personaPanelFor(render(getStoryMapForViewer(map, engineer)), "Builder");
  assert.doesNotMatch(unfiltered, /Show stories|Show only/);
  assert.doesNotMatch(render(page(map, "", { roles: ["member"] })), /esm-persona-detail|esm-avatar-button/);
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

const member = { roles: ["member"] };

test("ESM-905: customers see only approved personas that a shown story is for, with public IDs", () => {
  const map = parse(tagged(document => {
    // Approved, but only on a cut story, so customers never see it.
    document.personas.push({ id: "auditor", title: "Auditor", customer: { title: "Audit teams" } });
    document.stories.find(story => story.id === "FINANCE-202").personas = ["auditor"];
    // Approved, but only on a story with no customer copy.
    document.personas.push({ id: "buyer", title: "Buyer", customer: { title: "Buyers", summary: "People who order materials." } });
    document.stories.push({ id: "BUYER-301", title: "Order materials", activity: "purchase", release: "finance-follow-up", status: "planned", personas: ["buyer"] });
  }));
  const view = getStoryMapForViewer(map, member);
  assert.deepEqual(view.personas, [{ id: "persona-1", title: "Finance teams", summary: undefined }]);
  const story = title => view.stories.find(item => item.title === title);
  // BUILDER-102 serves a Finance reviewer job, so it is for Finance teams without listing the persona.
  assert.deepEqual(story("Find material prices").personas, ["persona-1"]);
  assert.deepEqual(story("Track approved purchases").personas, ["persona-1"]);
  // Builder has no customer copy, so BUILDER-101 is for no one customers can see.
  assert.equal(Object.hasOwn(story("Draft a project estimate"), "personas"), false);

  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /"jobs"|"finance"|"builder"|"auditor"|"buyer"|Finance reviewer|Audit teams|Buyers|approve-estimate|catalogue prices|statement/);
});

test("ESM-905: a map whose personas have no approved copy gives customers none", () => {
  const map = parse(tagged(document => { delete document.personas[1].customer; }));
  const view = getStoryMapForViewer(map, member);
  assert.equal(Object.hasOwn(view, "personas"), false);
  assert.ok(view.stories.every(story => !Object.hasOwn(story, "personas")));
  assert.doesNotMatch(render(view), /<dt>For<\/dt>/);
});

test("ESM-905: the customer story panel shows a For line, with no avatars", () => {
  const html = render(getStoryMapForViewer(parse(tagged()), member));
  assert.match(panelFor(html, "Find material prices"), /<dt>For<\/dt><dd>Finance teams<\/dd><dt>Activity<\/dt>/);
  // A story tagged only with internal personas shows no For line.
  assert.doesNotMatch(panelFor(html, "Draft a project estimate"), /<dt>For<\/dt>/);
  assert.doesNotMatch(html, /esm-avatar|esm-personas|esm-persona-menu|Finance reviewer/);
});

test("ESM-905: customers get the persona filter with two or more personas, by public ID", () => {
  const map = parse(tagged(document => {
    document.personas[0].customer = { title: "Builders" };
  }));
  const everything = page(map, "", member);
  assert.deepEqual(everything.personas.map(persona => persona.title), ["Builders", "Finance teams"]);
  const finance = page(map, "persona=persona-2", member);
  assert.deepEqual(finance.stories.map(story => story.title), ["Find material prices", "Track approved purchases"]);
  assert.deepEqual(finance.filter.persona, ["persona-2"]);
  // Internal IDs and jobs do nothing for customers.
  for (const query of ["persona=finance", "job=approve-estimate", "q=finance reviewer"]) {
    const view = page(map, query, member);
    assert.equal(Object.hasOwn(view.filter, "persona"), false, query);
    assert.equal(Object.hasOwn(view.filter, "job"), false, query);
  }

  const html = render(finance);
  const menu = html.slice(html.indexOf('<details class="esm-menu esm-persona-menu"'), html.indexOf("</details>", html.indexOf("esm-persona-menu")));
  assert.match(menu, /For: <\/span>Finance teams<\/summary>/);
  assert.match(menu, /<input type="checkbox" name="persona" value="persona-1"\/>Builders<\/label>/);
  assert.match(menu, /<input type="checkbox" name="persona" checked="" value="persona-2"\/>Finance teams<\/label>/);
  assert.doesNotMatch(html, /esm-avatar|<nav class="esm-personas"/, "no avatars or strip for customers");
  assert.match(html, /Showing 2 of 4 stories\./);
  assert.match(panelFor(html, "Find material prices"), /<dt>For<\/dt><dd>Builders and Finance teams<\/dd>/);
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
  assert.equal(price.statement, "When I am pricing a project, I want to use the catalogue prices, so that my estimate matches what finance pays.");
  assert.equal(price.activeStories, 2);
  assert.deepEqual(price.storyCounts, { planned: 1, "in-progress": 1, merged: 0, shipped: 0, blocked: 0, cut: 0 });
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
  assert.match(story.stdout, /  For:       builder \(Builder\)\n  Jobs:\n    send-estimate  When my estimate is ready, I want to send it for approval in one step, so that I do not chase finance by email\. \(Builder\) \[draft\]\n/);
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

const builderContext = {
  success: "Estimates approved the day they are sent",
  usesToday: ["Supplier price lists", "A spreadsheet", "Phoning finance"],
  constraints: ["Prices jobs on site, often on a phone", "Cannot see finance's approval queue"],
  draft: true,
};

/** The tagged fixture, with context on the Builder and, optionally, the Finance reviewer. */
function withContext(edit = () => {}) {
  return tagged(document => {
    document.personas[0].context = structuredClone(builderContext);
    edit(document);
  });
}

test("ESM-907: accepts persona context with any of its parts", () => {
  const map = parse(withContext(document => {
    document.personas[1].context = { constraints: ["Approves on a laptop, never on site"] };
  }));
  assert.deepEqual(map.personas[0].context, builderContext);
  assert.deepEqual(map.personas[1].context, { constraints: ["Approves on a laptop, never on site"] });
  assert.deepEqual(personaWarnings(map), []);
});

test("ESM-907: rejects empty context, unknown fields and parts over their limits", () => {
  const empty = issuesOf(withContext(document => { document.personas[0].context = { draft: true }; }));
  assert.deepEqual(empty, ["personas.0.context: Context needs at least one of success, usesToday and constraints."]);

  const issues = issuesOf(withContext(document => {
    Object.assign(document.personas[0].context, {
      success: "x".repeat(201),
      usesToday: Array.from({ length: 9 }, (_, index) => `Tool ${index}`),
      constraints: Array.from({ length: 7 }, (_, index) => `Constraint ${index}`),
      pains: ["Not a context field"],
    });
    document.personas[1].context = { usesToday: ["y".repeat(61)], constraints: [""] };
  }));
  for (const path of ["personas.0.context.success", "personas.0.context.usesToday", "personas.0.context.constraints", "personas.0.context.pains", "personas.1.context.usesToday.0", "personas.1.context.constraints.0"]) {
    assert.ok(issues.some(issue => issue.startsWith(`${path}: `)), `${path} in ${issues.join("\n")}`);
  }
});

test("ESM-907: warns about drafted context on a persona that a shipped story is for", () => {
  const draft = "personas.0.context.draft (builder): Confirm the drafted context for Builder and remove draft: true. Stories for them have shipped.";
  const warnings = map => personaWarnings(map).map(warning => `${warning.path.join(".")} (${warning.itemId ?? "map"}): ${warning.message}`);
  assert.ok(!warnings(parse(withContext())).includes(draft));
  const shipped = withContext(document => { document.stories.find(story => story.id === "BUILDER-101").status = "shipped"; });
  assert.ok(warnings(parse(shipped)).includes(draft));
  delete shipped.personas[0].context.draft;
  assert.ok(!warnings(parse(shipped)).includes(draft));
});

test("ESM-907: internal views and the JSON export carry context, and customers never see it", () => {
  const map = parse(withContext(document => {
    document.personas[1].context = { success: "Approvals cleared by Friday", draft: true };
  }));
  const internal = getStoryMapForViewer(map, engineer);
  assert.deepEqual(internal.personas[0].context, builderContext);

  const json = JSON.parse(storyMapToJson(internal, { now: new Date("2026-11-20T09:00:00Z") }));
  assert.deepEqual(json.personas[0].context, builderContext);
  assert.ok(json.provenance.notes.some(note => /Persona context with draft: true/.test(note)));
  const noContext = JSON.parse(storyMapToJson(getStoryMapForViewer(parse(tagged()), engineer)));
  assert.ok(!("context" in noContext.personas[0]));
  assert.ok(!noContext.provenance.notes.some(note => /Persona context/.test(note)));

  // Finance reviewer has approved customer copy, but its context stays internal.
  const customer = getStoryMapForViewer(map, member);
  assert.ok(customer.personas.length);
  assert.doesNotMatch(JSON.stringify(customer), /context|Approvals cleared|Supplier price lists|on a phone/);
});

test("ESM-907: search does not match persona context", () => {
  const map = parse(withContext());
  assert.deepEqual(ids(page(map, "q=supplier price lists")), []);
});

test("ESM-907: diffs report added, changed, confirmed and removed context", () => {
  const before = parse(withContext());
  const after = parse(withContext(document => {
    document.personas[0].context.usesToday.push("Email");
    document.personas[1].context = { success: "Approvals cleared by Friday" };
  }));
  const diff = diffStoryMaps(before, after);
  assert.deepEqual(diff.personaContexts, {
    added: [{ id: "finance", title: "Finance reviewer" }],
    changed: [{ id: "builder", title: "Builder" }],
    removed: [],
    confirmed: [],
  });
  const markdown = formatStoryMapDiff(diff);
  assert.match(markdown, /### Personas and jobs/);
  assert.match(markdown, /- Added context for persona `finance` Finance reviewer/);
  assert.match(markdown, /- Changed the context of persona `builder` Builder/);

  const confirmed = diffStoryMaps(before, parse(withContext(document => { delete document.personas[0].context.draft; })));
  assert.deepEqual(confirmed.personaContexts.confirmed, [{ id: "builder", title: "Builder" }]);
  assert.deepEqual(confirmed.personaContexts.changed, []);
  assert.match(formatStoryMapDiff(confirmed), /- Confirmed the drafted context of persona `builder` Builder/);

  const removed = diffStoryMaps(before, parse(tagged()));
  assert.deepEqual(removed.personaContexts.removed, [{ id: "builder", title: "Builder" }]);
  assert.match(formatStoryMapDiff(removed), /- Removed the context of persona `builder` Builder/);

  // A removed persona is reported once, under personas, not again for its context.
  const auditor = { id: "auditor", title: "Auditor", context: { success: "Audits take a day" } };
  const gone = diffStoryMaps(parse(withContext(document => {
    document.personas.push(auditor);
    document.stories[0].personas = ["auditor"];
  })), before);
  assert.deepEqual(gone.personas.removed, [{ id: "auditor", title: "Auditor" }]);
  assert.deepEqual(gone.personaContexts.removed, []);
  assert.equal(hasStoryMapChanges(diffStoryMaps(before, before)), false);
  assert.equal(hasStoryMapChanges(diffStoryMaps(before, parse(withContext(document => { document.personas[0].context.constraints.pop(); })))), true);
});

test("ESM-908: the first job is the core job in the view and the JSON export", () => {
  const view = getStoryMapForViewer(parse(tagged()), engineer);
  assert.deepEqual(view.personas.map(persona => persona.jobs.map(job => [job.id, job.core])), [
    [["price-materials", true], ["send-estimate", undefined]],
    // A persona with one job treats it as core.
    [["approve-estimate", true]],
  ]);
  assert.ok(!("core" in view.personas[0].jobs[1]), "only the core job carries the flag");
  assert.equal(personaCoreJob(view.personas[0]).id, "price-materials");
  assert.equal(personaCoreJob({ jobs: [] }), undefined);
  assert.equal(personaCoreJob({}), undefined);

  const json = JSON.parse(storyMapToJson(view, { now: new Date("2026-11-20T09:00:00Z") }));
  assert.deepEqual(json.personas.map(persona => persona.jobs.filter(job => job.core).map(job => job.id)), [["price-materials"], ["approve-estimate"]]);
  assert.equal(json.personas[0].jobs[1].core, undefined);
  assert.ok(json.provenance.notes.some(note => /first job is their core job, marked core: true/.test(note)));
});

test("ESM-908: the persona panel labels the core job and heads the rest as Other jobs, and the story panel marks it", () => {
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: page(parse(tagged()), "") }));
  const builder = personaPanelFor(html, "Builder");
  const core = builder.match(/<li class="esm-job esm-job-core">(?:(?!<\/li>).)*<\/li>/)?.[0];
  assert.ok(core, "the core job is set apart");
  assert.match(core, /^<li class="esm-job esm-job-core"><span class="esm-core-label">Core job<\/span><p class="esm-job-statement"[^>]*><b>When<\/b> I am pricing a project/);
  assert.match(builder, /<\/ul><h5 class="esm-jobs-subhead" id="([^"]+)">Other jobs<\/h5><ul class="esm-jobs" aria-labelledby="\1"><li class="esm-job"><p class="esm-job-statement"[^>]*><b>When<\/b> my estimate is ready/);
  assert.equal(builder.match(/Core job/g).length, 1);
  // With one job there is nothing else to head.
  const finance = personaPanelFor(html, "Finance reviewer");
  assert.match(finance, /esm-job-core/);
  assert.doesNotMatch(finance, /Other jobs/);

  // BUILDER-102 serves both personas' core jobs; BUILDER-103 serves a job that is not core.
  assert.equal(panelFor(html, "Look up prices in the material catalogue").match(/<span class="esm-core-label">Core job<\/span>/g).length, 2);
  assert.doesNotMatch(panelFor(html, "Submit the estimate to finance"), /Core job/);
});

test("ESM-908: validate warns when a core job has no stories, in place of the usual warning", () => {
  const map = parse(tagged(document => {
    for (const story of document.stories) story.jobs = story.jobs?.filter(job => job !== "price-materials");
    document.stories.find(story => story.id === "BUILDER-101").jobs = ["send-estimate"];
  }));
  const messages = personaWarnings(map).map(warning => warning.message);
  assert.ok(messages.includes("Core job price-materials (Builder) has no stories."), messages.join("\n"));
  assert.ok(!messages.some(message => message.startsWith("Job price-materials")));

  // A job that is not core keeps the usual warning.
  const other = parse(tagged(document => {
    document.stories.find(story => story.id === "BUILDER-103").jobs = ["price-materials"];
  }));
  assert.ok(personaWarnings(other).some(warning => warning.message === "Job send-estimate (Builder) has no stories."));
});

test("ESM-908: diff reports a change of core job when jobs are reordered", () => {
  const before = parse(tagged());
  const after = parse(tagged(document => { document.personas[0].jobs.reverse(); }));
  const diff = diffStoryMaps(before, after);
  assert.deepEqual(diff.jobs.coreChanged, [{ id: "builder", persona: "Builder", from: "price-materials", to: "send-estimate" }]);
  assert.deepEqual(diff.jobs.reworded, []);
  assert.equal(hasStoryMapChanges(diff), true);
  assert.match(formatStoryMapDiff(diff), /### Personas and jobs\n\n- Builder's core job: `price-materials` → `send-estimate`\n/);

  // Removing the core job makes the next one core; a new persona has no earlier core job to compare.
  const removed = diffStoryMaps(before, parse(tagged(document => {
    document.personas[0].jobs.shift();
    for (const story of document.stories) story.jobs = story.jobs?.filter(job => job !== "price-materials");
    document.personas.push({ id: "auditor", title: "Auditor", jobs: [{ id: "audit", situation: "a quarter ends", motivation: "to see who approved what", outcome: "audits take a day" }] });
  })));
  assert.deepEqual(removed.jobs.coreChanged, [{ id: "builder", persona: "Builder", from: "price-materials", to: "send-estimate" }]);
  assert.deepEqual(diffStoryMaps(before, before).jobs.coreChanged, []);
});

test("ESM-908: story-map story marks the core job", async t => {
  const directory = await mkdtemp(join(tmpdir(), "story-map-core-job-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mapPath = join(directory, "map.yaml");
  await writeFile(mapPath, stringify(tagged()));
  const story = spawnSync(process.execPath, [cli, "story", "BUILDER-102", "--map", mapPath], { encoding: "utf8" });
  assert.equal(story.status, 0, story.stderr);
  assert.match(story.stdout, /    price-materials  When I am pricing a project, .*\. \(Builder\) \[core job\]\n    approve-estimate  .*\(Finance reviewer\) \[core job\]\n/);
});
