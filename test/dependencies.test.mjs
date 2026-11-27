import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stringify } from "yaml";
import {
  diffStoryMaps,
  filterStoryMapView,
  formatStoryMapDiff,
  getStoryMapForViewer,
  parseStoryMap,
  proposeStoryMapEdit,
  readStoryMapFilters,
  storyDependsOnMaxItems,
  StoryMapEditError,
  storyMapToJson,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { makeStoryMapResponse } from "../example/host.mjs";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const sample = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
const map = parseStoryMap(sample);
const engineer = { roles: ["engineer"] };
const regular = { roles: ["member"] };

/** The sample map with each story's `dependsOn` set from `dependencies`, by story ID. */
function withDependencies(dependencies, base = map) {
  const document = structuredClone(base);
  for (const story of document.stories) {
    if (dependencies[story.id]) story.dependsOn = dependencies[story.id];
  }
  return stringify(document);
}

// BUILDER-103 needs the estimate and the prices, and finance needs the submission.
const chained = {
  "BUILDER-102": ["BUILDER-101"],
  "BUILDER-103": ["BUILDER-101", "BUILDER-102"],
  "FINANCE-201": ["BUILDER-103"],
};

async function loadIssues(source) {
  const { loadStoryMap } = await import("../dist/schema.js");
  try {
    const loaded = loadStoryMap(source);
    return { errors: [], warnings: loaded.warnings };
  } catch (error) {
    return { errors: error.issues, warnings: [] };
  }
}

const describe = issues => issues.map(({ path, itemId, message }) => [path.join("."), itemId, message]);

test("ESM-129: stories record the stories they depend on", async () => {
  const parsed = parseStoryMap(withDependencies(chained));
  assert.deepEqual(parsed.stories.find(story => story.id === "BUILDER-103").dependsOn, ["BUILDER-101", "BUILDER-102"]);
  assert.equal(parsed.stories.find(story => story.id === "BUILDER-101").dependsOn, undefined);
  assert.deepEqual((await loadIssues(withDependencies(chained))).warnings, []);
  assert.equal(storyDependsOnMaxItems, 10);
});

test("ESM-129: validation rejects unknown, repeated and self dependencies", async () => {
  const { errors } = await loadIssues(withDependencies({
    "BUILDER-101": ["BUILDER-101"],
    "BUILDER-102": ["BUILDER-101", "BUILDER-999", "BUILDER-101"],
  }));
  assert.deepEqual(describe(errors), [
    ["stories.0.dependsOn.0", "BUILDER-101", "A story cannot depend on itself. Remove the dependency."],
    ["stories.1.dependsOn.1", "BUILDER-102", "Unknown story 'BUILDER-999'. Use a story ID from the map."],
    ["stories.1.dependsOn.2", "BUILDER-102", "Story 'BUILDER-101' is listed twice. Remove one."],
  ]);
  assert.ok(errors.every(error => error.line > 0));

  const tooMany = await loadIssues(withDependencies({ "BUILDER-101": Array.from({ length: 11 }, (_, index) => `X-${index}`) }));
  assert.ok(tooMany.errors.some(error => error.path.join(".") === "stories.0.dependsOn"), JSON.stringify(describe(tooMany.errors)));
});

test("ESM-129: validation reports each dependency cycle once", async () => {
  const pair = await loadIssues(withDependencies({ "BUILDER-101": ["BUILDER-102"], "BUILDER-102": ["BUILDER-101"] }));
  assert.deepEqual(describe(pair.errors), [
    ["stories.1.dependsOn.0", "BUILDER-102", "Dependency cycle: BUILDER-101 → BUILDER-102 → BUILDER-101. Remove one of these dependencies."],
  ]);

  // A longer loop, with a story outside it that depends on the loop, which is not itself a cycle.
  const loop = await loadIssues(withDependencies({
    "BUILDER-101": ["BUILDER-103"],
    "BUILDER-102": ["BUILDER-101"],
    "BUILDER-103": ["BUILDER-102"],
    "FINANCE-201": ["BUILDER-101"],
  }));
  assert.deepEqual(describe(loop.errors), [
    ["stories.1.dependsOn.0", "BUILDER-102", "Dependency cycle: BUILDER-101 → BUILDER-103 → BUILDER-102 → BUILDER-101. Remove one of these dependencies."],
  ]);

  // A long chain is checked without recursion, so it cannot overflow the stack.
  const long = structuredClone(map);
  const template = long.stories[1];
  long.stories = long.stories.slice(0, 1);
  for (let index = 0; index < 999; index++) {
    long.stories.push({ ...structuredClone(template), id: `CHAIN-${index}`, dependsOn: [index ? `CHAIN-${index - 1}` : "BUILDER-101"], customer: undefined });
  }
  for (const story of long.stories) delete story.customer;
  assert.deepEqual((await loadIssues(stringify(long))).errors, []);
});

test("ESM-129: validation warns when a story depends on a cut story", async () => {
  const { warnings } = await loadIssues(withDependencies({ "FINANCE-201": ["FINANCE-202"] }));
  assert.deepEqual(describe(warnings), [
    ["stories.3.dependsOn.0", "FINANCE-201", "Depends on FINANCE-202, which is cut, so that work will not land. Remove the dependency, or cut or replan this story."],
  ]);
  // A cut story depending on another cut story says nothing new.
  const bothCut = structuredClone(map);
  Object.assign(bothCut.stories.find(story => story.id === "FINANCE-201"), { status: "cut", statusReason: "Finance moved to another tool.", customer: undefined });
  bothCut.stories.find(story => story.id === "FINANCE-201").dependsOn = ["FINANCE-202"];
  assert.deepEqual((await loadIssues(stringify(bothCut))).warnings.filter(warning => /cut, so/.test(warning.message)), []);
});

test("ESM-129: internal views list dependencies and the stories waiting, whatever the filter", () => {
  const view = getStoryMapForViewer(parseStoryMap(withDependencies(chained)), engineer);
  const story = id => view.stories.find(item => item.id === id);
  assert.deepEqual(story("BUILDER-103").dependsOn, [
    { id: "BUILDER-101", title: "Draft an estimate against a project", status: "in-progress", release: "builder-mvp" },
    { id: "BUILDER-102", title: "Look up prices in the material catalogue", status: "planned", release: "builder-mvp" },
  ]);
  assert.deepEqual(story("BUILDER-101").dependents.map(item => item.id), ["BUILDER-102", "BUILDER-103"]);
  assert.deepEqual(story("BUILDER-103").dependents.map(item => item.id), ["FINANCE-201"]);
  assert.ok(!("dependsOn" in story("BUILDER-101")));
  assert.ok(!("dependents" in story("FINANCE-201")));

  // Filtering hides stories from the board, not from a story's dependencies.
  const filtered = filterStoryMapView(view, { query: "BUILDER-103" });
  assert.deepEqual(filtered.stories.map(item => item.id), ["BUILDER-103"]);
  assert.equal(filtered.stories[0].dependsOn.length, 2);
  assert.equal(filtered.stories[0].dependents.length, 1);
});

test("ESM-129: customers never see dependencies", async () => {
  const document = parseStoryMap(withDependencies(chained));
  const view = getStoryMapForViewer(document, regular);
  assert.ok(view.stories.length > 0);
  assert.ok(view.stories.every(story => !("dependsOn" in story) && !("dependents" in story)));
  for (const path of ["/story-map", "/api/story-map"]) {
    const payload = await makeStoryMapResponse(path, document, regular).text();
    assert.doesNotMatch(payload, /dependsOn|dependents|esm-dependency|Depends on|Waiting for this story/);
  }
});

test("ESM-129: cards show a count of the stories they depend on, to the right of the status", () => {
  const view = getStoryMapForViewer(parseStoryMap(withDependencies(chained)), engineer);
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
  const card = id => html.match(new RegExp(`<button type="button" class="esm-card" id="esm-story-${id}"[\\s\\S]*?</button>`))[0];

  assert.match(card("BUILDER-103"), /Planned<\/span><span class="esm-dependency-count" title="Depends on 2 stories: BUILDER-101, BUILDER-102">[\s\S]*?<span aria-hidden="true">2<\/span><span class="esm-visually-hidden">Depends on 2 stories: BUILDER-101, BUILDER-102<\/span><\/span>/);
  assert.match(card("BUILDER-102"), /title="Depends on 1 story: BUILDER-101"/);
  // Only what the story depends on: the stories waiting for BUILDER-101 show in its panel, not on its card.
  assert.doesNotMatch(card("BUILDER-101"), /esm-dependency-count/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer) })), /esm-dependency|Dependencies/);
});

test("ESM-129: cards count only the dependencies not yet merged or shipped, and panels still list them all", () => {
  const document = parseStoryMap(withDependencies(chained));
  document.stories.find(story => story.id === "BUILDER-101").status = "merged";
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(document, engineer) }));
  const card = id => html.match(new RegExp(`<button type="button" class="esm-card" id="esm-story-${id}"[\\s\\S]*?</button>`))[0];
  const panels = html.match(/<div class="esm-detail" id="[^"]+-story-\d+"[\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$)/g);
  const panel = id => panels.find(item => item.includes(`<p class="esm-card-id">${id}</p>`));

  // Every dependency delivered: no count on the card.
  assert.doesNotMatch(card("BUILDER-102"), /esm-dependency-count/);
  // One of two delivered: the card counts the other, and says so.
  assert.match(card("BUILDER-103"), /<span class="esm-dependency-count" title="Depends on 1 story not yet merged or shipped: BUILDER-102">[\s\S]*?<span aria-hidden="true">1<\/span>/);

  // The panels keep the full count and list every dependency with its status.
  assert.match(panel("BUILDER-102"), /title="Depends on 1 story: BUILDER-101"/);
  assert.match(panel("BUILDER-102"), /Depends on<\/h5>[\s\S]*?BUILDER-101[\s\S]*?data-status="merged"/);
  assert.match(panel("BUILDER-103"), /title="Depends on 2 stories: BUILDER-101, BUILDER-102"/);

  // Shipped counts as delivered too; blocked and cut do not.
  for (const [status, shown] of [["shipped", false], ["blocked", true], ["cut", true]]) {
    document.stories.find(story => story.id === "BUILDER-101").status = status;
    const board = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(document, engineer) }));
    const found = board.match(/<button type="button" class="esm-card" id="esm-story-BUILDER-102"[\s\S]*?<\/button>/)[0];
    assert.equal(/esm-dependency-count/.test(found), shown, status);
  }
});

test("ESM-129: story panels list what they depend on and what is waiting for them", () => {
  const view = getStoryMapForViewer(parseStoryMap(withDependencies(chained)), engineer);
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
  const panels = html.match(/<div class="esm-detail" id="[^"]+-story-\d+"[\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$)/g);
  const panel = id => panels.find(item => item.includes(`<p class="esm-card-id">${id}</p>`));
  const panelId = id => /id="([^"]+)"/.exec(panel(id))[1];

  const middle = panel("BUILDER-103");
  // The same count beside the status, then the section before History.
  assert.match(middle, /Planned<\/span><span class="esm-dependency-count" title="Depends on 2 stories: BUILDER-101, BUILDER-102">/);
  // The readiness line from ESM-139 comes first, then the lists.
  assert.match(middle, /<h4 id="[^"]+-dependencies">Dependencies<\/h4><p class="esm-readiness-note"[\s\S]*?<\/p><h5 class="esm-dependencies-heading" id="[^"]+-dependencies-on">Depends on<\/h5>/);
  assert.ok(middle.indexOf("Dependencies</h4>") < middle.indexOf("History</h4>") || !middle.includes("History</h4>"));
  // Each story opens its own panel, with its status and release.
  assert.match(middle, new RegExp(`<button type="button" class="esm-dependency-link" aria-haspopup="dialog" popoverTarget="${panelId("BUILDER-101")}"><span class="esm-card-id">BUILDER-101</span><span class="esm-dependency-title">Draft an estimate against a project</span></button><span class="esm-dependency-meta"><span class="esm-status" data-status="in-progress">[\\s\\S]*?In progress</span><span class="esm-dependency-release">Builder workflow</span></span>`));
  assert.match(middle, /Waiting for this story<\/h5>[\s\S]*?FINANCE-201/);

  const first = panel("BUILDER-101");
  assert.doesNotMatch(first, /esm-dependency-count/);
  assert.doesNotMatch(first, />Depends on</);
  assert.match(first, /Waiting for this story<\/h5><ul class="esm-dependencies"[^>]*><li>[\s\S]*?BUILDER-102[\s\S]*?BUILDER-103/);

  // A story hidden by a filter has no panel to open, so it is listed as text.
  const filtered = renderToStaticMarkup(createElement(StoryMapBoard, { map: filterStoryMapView(view, readStoryMapFilters(new URLSearchParams("q=BUILDER-103"))) }));
  assert.match(filtered, /<span class="esm-dependency-link"><span class="esm-card-id">BUILDER-101<\/span>/);
  assert.doesNotMatch(filtered, /<button type="button" class="esm-dependency-link"/);
});

test("ESM-129: exports and the story command carry dependencies", async t => {
  const document = parseStoryMap(withDependencies(chained));
  const json = JSON.parse(storyMapToJson(getStoryMapForViewer(document, engineer), { now: new Date("2026-01-01T00:00:00Z") }));
  assert.deepEqual(json.stories.find(story => story.id === "BUILDER-102").dependsOn.map(item => item.id), ["BUILDER-101"]);
  assert.deepEqual(json.stories.find(story => story.id === "BUILDER-102").dependents.map(item => item.id), ["BUILDER-103"]);

  const root = await mkdtemp(join(tmpdir(), "story-map-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), withDependencies(chained));
  const result = spawnSync(process.execPath, [cli, "story", "BUILDER-103"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\n  Depends on: BUILDER-101 \(in-progress\), BUILDER-102 \(planned\)\n/);
  assert.match(result.stdout, /\n  Waiting for it: FINANCE-201 \(planned\)\n/);
});

test("ESM-129: diffs show dependencies added and removed", () => {
  const before = parseStoryMap(withDependencies({ "BUILDER-103": ["BUILDER-101"] }));
  const after = parseStoryMap(withDependencies({ "BUILDER-102": ["BUILDER-101"], "BUILDER-103": ["BUILDER-102"] }));
  const diff = diffStoryMaps(before, after);
  const updates = Object.fromEntries(diff.stories.updated.map(update => [update.id, update]));
  assert.deepEqual(updates["BUILDER-102"].dependsOn, { from: [], to: ["BUILDER-101"] });
  assert.deepEqual(updates["BUILDER-103"].dependsOn, { from: ["BUILDER-101"], to: ["BUILDER-102"] });
  assert.equal(diff.customer.length, 0);
  const markdown = formatStoryMapDiff(diff);
  assert.match(markdown, /Depends on: none → `BUILDER-101`/);
  assert.match(markdown, /Depends on: `BUILDER-101` → `BUILDER-102`/);
});

test("ESM-129: edit and add record dependencies without touching other lines", async () => {
  const source = withDependencies({ "BUILDER-103": ["BUILDER-101"] });

  const added = await proposeStoryMapEdit(source, [{ op: "add-dependency", id: "BUILDER-102", dependency: "BUILDER-101" }]);
  assert.equal(added.valid, true);
  // A new field goes after the status, before the jobs and summary.
  assert.match(added.lineDiff, /\n     status: planned\n\+    dependsOn:\n\+      - BUILDER-101\n/);
  assert.equal(added.lineDiff.split("\n").filter(line => /^[+-][^+-]/.test(line)).length, 2);

  const appended = await proposeStoryMapEdit(source, [{ op: "add-dependency", id: "BUILDER-103", dependency: "BUILDER-102" }]);
  assert.deepEqual(parseStoryMap(appended.source).stories.find(story => story.id === "BUILDER-103").dependsOn, ["BUILDER-101", "BUILDER-102"]);
  // Adding one it already has changes nothing.
  assert.equal((await proposeStoryMapEdit(source, [{ op: "add-dependency", id: "BUILDER-103", dependency: "BUILDER-101" }])).changed, false);

  const removed = await proposeStoryMapEdit(source, [{ op: "remove-dependency", id: "BUILDER-103", dependency: "BUILDER-101" }]);
  assert.equal(parseStoryMap(removed.source).stories.find(story => story.id === "BUILDER-103").dependsOn, undefined);
  await assert.rejects(proposeStoryMapEdit(source, [{ op: "remove-dependency", id: "BUILDER-102", dependency: "BUILDER-101" }]),
    error => error instanceof StoryMapEditError && /BUILDER-102 has no dependency BUILDER-101/.test(error.message));

  // An unknown story or a cycle is reported, and the result cannot be written.
  const unknown = await proposeStoryMapEdit(source, [{ op: "add-dependency", id: "BUILDER-102", dependency: "BUILDER-999" }]);
  assert.equal(unknown.valid, false);
  assert.match(unknown.newIssues[0].message, /Unknown story 'BUILDER-999'/);
  const cycle = await proposeStoryMapEdit(source, [{ op: "add-dependency", id: "BUILDER-101", dependency: "BUILDER-103" }]);
  assert.equal(cycle.valid, false);
  assert.match(cycle.newIssues[0].message, /^Dependency cycle: /);

  const story = await proposeStoryMapEdit(source, [{ op: "add", id: "BUILDER-104", title: "Send the order to the supplier", activity: "purchase", release: "builder-mvp", dependsOn: ["BUILDER-103"] }]);
  assert.equal(story.valid, true);
  assert.match(story.lineDiff, /\+    status: planned\n\+    dependsOn:\n\+      - BUILDER-103\n/);
});

test("ESM-129: the edit and add commands take dependency options", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  const file = join(root, "product/story-map.yaml");
  await writeFile(file, sample);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

  let result = run("edit", "BUILDER-103", "--add-dependency", "BUILDER-101", "--add-dependency", "BUILDER-102", "--write");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Depends on: none → `BUILDER-101`, `BUILDER-102`/);
  assert.deepEqual(parseStoryMap(await readFile(file, "utf8")).stories.find(story => story.id === "BUILDER-103").dependsOn, ["BUILDER-101", "BUILDER-102"]);

  result = run("edit", "BUILDER-103", "--remove-dependency", "BUILDER-101", "--write");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseStoryMap(await readFile(file, "utf8")).stories.find(story => story.id === "BUILDER-103").dependsOn, ["BUILDER-102"]);

  result = run("add", "--id", "BUILDER-104", "--title", "Send the order to the supplier", "--activity", "purchase", "--release", "builder-mvp", "--dependency", "BUILDER-103", "--write");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(parseStoryMap(await readFile(file, "utf8")).stories.find(story => story.id === "BUILDER-104").dependsOn, ["BUILDER-103"]);

  // BUILDER-104 waits for 103, which waits for 102, so 102 cannot wait for 104.
  result = run("edit", "BUILDER-102", "--add-dependency", "BUILDER-104", "--write");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency cycle: BUILDER-102 → BUILDER-104 → BUILDER-103 → BUILDER-102/);
  assert.equal(parseStoryMap(await readFile(file, "utf8")).stories.find(story => story.id === "BUILDER-102").dependsOn, undefined);

  assert.match(run("help", "edit").stdout, /--add-dependency, --remove-dependency <ID>/);
  assert.match(run("help", "add").stdout, /--dependency <ID>/);
});
