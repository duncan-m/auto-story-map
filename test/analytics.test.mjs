import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stringify } from "yaml";
import {
  filterStoryMapView,
  getStoryMapForViewer,
  getStoryMapPage,
  parseStoryMap,
  parseStoryMapHistory,
  readStoryMapFilters,
  storyMapAnalytics,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

const sample = parseStoryMap(await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8"));
const engineer = { roles: ["engineer"] };
const customer = { roles: ["member"] };
// A Friday. The day window is Sat 21 to Fri 27 November, and the week window ends with the week of Monday 23 November.
const now = new Date("2026-11-27T12:00:00Z");
const first = "aaaaaa1";

/**
 * A map with the fixture's first activity and release and one story per entry:
 * [id, status, fields], with customer copy so the customer view has stories.
 */
function mapOf(stories) {
  const document = structuredClone(sample);
  const template = document.stories[0];
  document.stories = stories.map(([id, status, fields = {}]) => ({
    id,
    title: `Story ${id}`,
    activity: template.activity,
    release: template.release,
    status,
    ...(status === "blocked" || status === "cut" ? { statusReason: "Not going ahead for now." } : {}),
    customer: { title: "A public story" },
    ...fields,
  }));
  return parseStoryMap(stringify(document));
}

/** A history whose first version of the map, on 1 November, has every story in `initial`, then the given status changes. */
function historyOf(initial, changes, { complete = true } = {}) {
  return parseStoryMapHistory({
    version: 1,
    generatedAt: "2026-11-27T10:00:00.000Z",
    complete,
    events: [
      ...initial.map(([storyId, to]) => ({ storyId, type: "added", to, at: "2026-11-01T09:00:00.000Z", commit: first })),
      ...changes.map(([storyId, from, to, at, commit = "bbbbbb2"]) => from
        ? { storyId, type: "status", from, to, at, commit }
        : { storyId, type: "added", to, at, commit }),
    ],
  });
}

function analytics(map, history, options = {}) {
  return storyMapAnalytics(getStoryMapForViewer(map, engineer, { history }), { now, ...options });
}

const day = (result, date) => result.buckets.find(bucket => bucket.start.startsWith(date));

test("ESM-174: counts each completed story once, in the period of its latest completion, with today's values", () => {
  const map = mapOf([
    ["S-1", "merged", { estimate: 3, tokens: 1_000, estimatedCostUsd: 0.5 }],
    ["S-2", "shipped", { estimate: 5, tokens: 2_000, estimatedCostUsd: 1.25 }],
    ["S-3", "merged", { estimate: 8 }],
    ["S-4", "in-progress", { estimate: 2 }],
  ]);
  const history = historyOf([["S-1", "planned"], ["S-2", "planned"], ["S-3", "planned"], ["S-4", "planned"]], [
    ["S-1", "planned", "merged", "2026-11-23T10:00:00.000Z"],
    // Merged, then shipped: the merged view counts it once, when it merged.
    ["S-2", "planned", "merged", "2026-11-24T10:00:00.000Z"],
    ["S-2", "merged", "shipped", "2026-11-26T10:00:00.000Z"],
    // Reopened and merged again: counted once, at the latest merge.
    ["S-3", "planned", "merged", "2026-11-22T10:00:00.000Z"],
    ["S-3", "merged", "in-progress", "2026-11-23T10:00:00.000Z"],
    ["S-3", "in-progress", "merged", "2026-11-25T10:00:00.000Z"],
    // Merged and then reopened: not complete now, so not counted.
    ["S-4", "planned", "merged", "2026-11-24T11:00:00.000Z"],
    ["S-4", "merged", "in-progress", "2026-11-25T11:00:00.000Z"],
  ]);

  const merged = analytics(map, history);
  assert.equal(merged.period, "day");
  assert.equal(merged.milestone, "merged");
  assert.deepEqual(day(merged, "2026-11-23").storyIds, ["S-1"]);
  assert.deepEqual(day(merged, "2026-11-24").storyIds, ["S-2"]);
  assert.deepEqual(day(merged, "2026-11-25").storyIds, ["S-3"]);
  assert.deepEqual(day(merged, "2026-11-22").storyIds, []);
  assert.deepEqual(day(merged, "2026-11-26").storyIds, []);
  assert.equal(merged.totals.stories, 3);
  assert.equal(merged.totals.points, 16);
  assert.equal(merged.totals.tokens, 3_000);
  assert.equal(merged.totals.spendUsd, 1.75);
  assert.equal(merged.undated, 0);

  const shipped = analytics(map, history, { milestone: "shipped" });
  assert.deepEqual(shipped.totals.storyIds, ["S-2"]);
  assert.deepEqual(day(shipped, "2026-11-26").storyIds, ["S-2"]);
});

test("ESM-174: stories already complete when the history starts are not dated or counted", () => {
  const map = mapOf([["S-1", "shipped"], ["S-2", "merged"], ["S-3", "merged"], ["S-4", "merged"]]);
  const history = historyOf([["S-1", "shipped"], ["S-2", "planned"]], [
    ["S-2", "planned", "merged", "2026-11-26T08:00:00.000Z"],
    // Added already merged in a later change, such as the PR that built it: counted when it was added.
    ["S-3", undefined, "merged", "2026-11-25T08:00:00.000Z"],
    // S-4 is not in the history at all, as when the map changed after the file was made.
  ]);
  const result = analytics(map, history);
  assert.deepEqual(result.totals.storyIds, ["S-2", "S-3"]);
  assert.equal(result.undated, 2);
  assert.equal(result.knownFrom, "2026-11-01T09:00:00.000Z");
  assert.equal(result.complete, true);
  assert.equal(result.generatedAt, "2026-11-27T10:00:00.000Z");
});

test("ESM-174: missing estimates and tokens are counted as coverage, never as zero", () => {
  const map = mapOf([
    ["S-1", "merged", { estimate: 3, tokens: 500, estimatedCostUsd: 0.2 }],
    ["S-2", "merged"],
    ["S-3", "merged"],
  ]);
  const history = historyOf([["S-1", "planned"], ["S-2", "planned"], ["S-3", "planned"]], [
    ["S-1", "planned", "merged", "2026-11-26T08:00:00.000Z"],
    ["S-2", "planned", "merged", "2026-11-26T09:00:00.000Z"],
    ["S-3", "planned", "merged", "2026-11-27T09:00:00.000Z"],
  ]);
  const result = analytics(map, history);
  assert.deepEqual(
    [day(result, "2026-11-26"), day(result, "2026-11-27")].map(({ stories, points, estimated, tokens, tokensRecorded, spendRecorded }) => ({ stories, points, estimated, tokens, tokensRecorded, spendRecorded })),
    [
      { stories: 2, points: 3, estimated: 1, tokens: 500, tokensRecorded: 1, spendRecorded: 1 },
      { stories: 1, points: 0, estimated: 0, tokens: 0, tokensRecorded: 0, spendRecorded: 0 },
    ],
  );

  const html = renderToStaticMarkup(createElement(StoryMapBoard, {
    map: getStoryMapPage(map, engineer, { history, searchParams: new URLSearchParams("view=analytics"), now }),
    now,
    timeZone: "UTC",
  }));
  const row = date => html.match(new RegExp(`<tr[^>]*><th scope="row">${date}</th>(.*?)</tr>`))?.[1];
  // A partly estimated day shows its total and how many have one; a day with none shows a dash.
  assert.match(row("Thu 26 Nov"), /<td>3<span class="esm-analytics-cov">1 of 2 estimated<\/span><\/td>/);
  assert.match(row("Thu 26 Nov"), /<td>500<span class="esm-analytics-cov">1 of 2 recorded<\/span><\/td>/);
  assert.match(row("Fri 27 Nov"), /<td><span aria-hidden="true">—<\/span><span class="esm-analytics-cov">0 of 1 estimated<\/span><\/td>/);
  assert.match(row("Fri 27 Nov"), /<td><span aria-hidden="true">—<\/span><span class="esm-visually-hidden">None recorded<\/span><\/td>/);
  assert.match(html, /<dt>Points<\/dt><dd>3<small>1 of 3 stories estimated<\/small><\/dd>/);
});

test("ESM-174: shows the last 8 UTC days, 8 Monday weeks or 6 months, keeping empty periods", () => {
  const map = mapOf([["S-1", "merged"], ["S-2", "merged"], ["S-3", "merged"]]);
  const history = historyOf([["S-1", "planned"], ["S-2", "planned"], ["S-3", "planned"]], [
    // The last second of Sunday 22 November, and the first of Monday 23 November, in UTC.
    ["S-1", "planned", "merged", "2026-11-22T23:59:59.000Z"],
    ["S-2", "planned", "merged", "2026-11-23T00:00:00.000Z"],
    // Before the day window, inside the week window.
    ["S-3", "planned", "merged", "2026-11-05T12:00:00.000Z"],
  ]);

  const days = analytics(map, history);
  assert.deepEqual(days.buckets.map(bucket => bucket.start.slice(0, 10)), ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.equal(days.buckets.at(-1).end, "2026-11-28T00:00:00.000Z");
  assert.deepEqual(days.buckets.map(bucket => bucket.stories), [0, 0, 1, 1, 0, 0, 0, 0]);
  assert.equal(days.totals.stories, 2);

  const weeks = analytics(map, history, { period: "week" });
  assert.deepEqual(weeks.buckets.map(bucket => bucket.start.slice(0, 10)), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  assert.deepEqual(weeks.buckets.map(bucket => bucket.stories), [0, 0, 0, 0, 1, 0, 1, 1]);

  const months = analytics(map, history, { period: "month" });
  assert.deepEqual(months.buckets.map(bucket => bucket.start.slice(0, 10)), ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"]);
  assert.deepEqual(months.buckets.map(bucket => bucket.stories), [0, 0, 0, 0, 0, 3]);
});

test("ESM-174: reads the Analytics tab's parameters and keeps every story on it", () => {
  assert.deepEqual(
    readStoryMapFilters(new URLSearchParams("view=analytics&period=week&completed=shipped&chart=spend")),
    { query: undefined, status: undefined, view: "analytics", period: "week", completed: "shipped", chart: "spend" },
  );
  assert.deepEqual(
    readStoryMapFilters(new URLSearchParams("view=charts&period=year&completed=soon&chart=pie")),
    { query: undefined, status: undefined },
  );

  const map = mapOf([["S-1", "merged"], ["S-2", "cut"], ["S-3", "planned"]]);
  const internal = getStoryMapForViewer(map, engineer);
  const page = filterStoryMapView(internal, { view: "analytics", query: "S-3" });
  assert.deepEqual(page.stories.map(story => story.id), ["S-1", "S-2", "S-3"]);
  assert.equal(page.filter.view, "analytics");
  assert.equal(page.filter.query, "S-3");
  assert.deepEqual(page.filter.analytics, { period: "day", completed: "merged", chart: "stories" });
  // The story map keeps filtering as before.
  assert.deepEqual(filterStoryMapView(internal, { query: "S-3" }).stories.map(story => story.id), ["S-3"]);
});

test("ESM-174: the customer view has no Analytics tab, data or parameters", () => {
  const map = mapOf([["S-1", "merged", { estimate: 3, tokens: 1_000, estimatedCostUsd: 0.5 }]]);
  const history = historyOf([["S-1", "planned"]], [["S-1", "planned", "merged", "2026-11-26T08:00:00.000Z"]]);
  const searchParams = new URLSearchParams("view=analytics&period=week&completed=shipped&chart=tokens");
  const view = getStoryMapPage(map, customer, { history, searchParams, now });
  assert.equal(view.audience, "all-users");
  assert.equal(view.filter.view, undefined);
  assert.equal(view.filter.analytics, undefined);
  const json = JSON.stringify(view);
  for (const leak of ["analytics", "tokens", "estimatedCostUsd", "week", "shipped\"", "S-1"]) assert.ok(!json.includes(leak), leak);
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view, now }));
  assert.doesNotMatch(html, /Analytics|esm-analytics|esm-tabs/);
});

test("ESM-174: the internal board shows the Analytics tab, its options as a form, and an accessible table", () => {
  const map = mapOf([["S-1", "merged", { estimate: 3, tokens: 1_200_000, estimatedCostUsd: 2.5 }]]);
  const history = historyOf([["S-1", "planned"]], [["S-1", "planned", "merged", "2026-11-26T08:00:00.000Z"]], { complete: false });
  const render = (params, options = {}) => renderToStaticMarkup(createElement(StoryMapBoard, {
    map: getStoryMapPage(map, engineer, { history, ...options, searchParams: new URLSearchParams(params), now }),
    now,
    timeZone: "UTC",
    preservedParams: { view: "internal" },
  }));

  const mapPage = render("q=Story");
  assert.match(mapPage, /<a class="esm-tab" href="\?view=analytics&amp;q=Story">Analytics<\/a>/);
  assert.doesNotMatch(mapPage, /esm-analytics/);

  const html = render("view=analytics&q=Story&period=week&chart=spend");
  assert.match(html, /<a class="esm-tab" href="\?view=analytics&amp;q=Story" aria-current="page">Analytics<\/a>/);
  // Going back to the map keeps the search, and the form keeps it too.
  assert.match(html, /<a class="esm-tab" href="\?view=internal&amp;q=Story">Story map/);
  assert.match(html, /<form class="esm-filters" aria-label="Analytics options" method="get"><input type="hidden" name="view" value="analytics"\/><input type="hidden" name="q" value="Story"\/>/);
  assert.match(html, /<select class="esm-select" name="period" aria-label="Period"[^>]*><option value="day">Day<\/option><option value="week" selected="">Week<\/option>/);
  assert.match(html, /<option value="spend" selected="">Chart spend<\/option>/);
  assert.match(html, /<span class="esm-toolbar-count">last 8 weeks<\/span>/);
  assert.match(html, /History known from 1 Nov 2026, from a shallow clone, so earlier changes are missing, up to 27 Nov 2026, 10:00\./);
  assert.match(html, /values today, not when it was completed/);
  assert.match(html, /<caption class="esm-visually-hidden" id="[^"]+">Stories, points, tokens and spend merged or shipped each week, last 8 weeks<\/caption>/);
  assert.match(html, /<div class="esm-analytics-scroll" role="region" tabindex="0" aria-labelledby="[^"]+-analytics-caption">/);
  assert.match(html, /<th scope="row">Week of 23 Nov<\/th><td>1<\/td><td>3<\/td><td>1.2m<\/td><td>\$2.50<\/td>/);
  assert.match(html, /<tr class="esm-empty"><th scope="row">Week of 16 Nov<\/th><td>0<\/td><td>0<\/td><td>0<\/td><td>\$0.00<\/td><\/tr>/);
  assert.match(html, /<tfoot><tr><th scope="row">8 weeks<\/th><td>1<\/td>/);
  assert.match(html, /<div class="esm-analytics-chart" aria-hidden="true"/);
  // The tab replaces the story map and its panels.
  assert.doesNotMatch(html, /class="esm-grid"|esm-panel/);

  // Without a history file, the tab explains how to add one and shows nothing else.
  const setup = renderToStaticMarkup(createElement(StoryMapBoard, {
    map: getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=analytics"), now }),
    now,
  }));
  assert.match(setup, /<h3 id="[^"]+">No history yet<\/h3>/);
  assert.match(setup, /story-map history --out build\/story-map-history\.json/);
  assert.doesNotMatch(setup, /esm-analytics-table|esm-analytics-totals/);
});
