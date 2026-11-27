import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  checkStoryMap,
  countStoryMapActions,
  filterStoryMapActions,
  getStoryMapActions,
  getStoryMapForViewer,
  getStoryMapPage,
  parseStoryMap,
  readStoryMapFilters,
  storyMapActionKindOrder,
  storyMapActionKinds,
  storyMapWarningKinds,
  storyMapWarnings,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/** A small map that sets off every kind of warning. */
const source = `version: 1
id: kinds
title: Kinds
visibility: all-users
customer:
  title: Roadmap
personas:
  - id: builder
    title: Builder
    context:
      success: Quotes in a day
      draft: true
    jobs:
      - id: price
        situation: I am pricing a project
        motivation: to use the catalogue prices
        outcome: my estimate matches what finance pays
        draft: true
        steps:
          - title: Check
            activity: review
      - id: unused
        situation: a quote is late
        motivation: to see why
        outcome: I can tell the client
  - id: nobody
    title: Nobody
activities:
  - id: prepare
    title: Prepare
    customer:
      title: Prepare
  - id: review
    title: Review
releases:
  - id: r1
    title: First
    customer:
      title: First
    impact:
      - metric: Time to quote
        expected: Under a day
        draft: true
  - id: r2
    title: Second
stories:
  - id: S-1
    title: Price from the catalogue
    activity: prepare
    release: r1
    status: shipped
    estimate: 3
    jobs: [price]
    customer:
      title: Catalogue prices
  - id: S-2
    title: Save a draft quote
    activity: prepare
    release: r1
  - id: S-3
    title: Send the quote
    activity: prepare
    release: r2
    status: in-progress
    dependsOn: [S-4]
    personas: [builder]
  - id: S-4
    title: Quote by text message
    activity: prepare
    release: r2
    status: cut
  - id: S-6
    title: Copy a quote
    activity: prepare
    release: r2
  - id: S-7
    title: Archive a quote
    activity: prepare
    release: r2
`;

const map = parseStoryMap(source);
const tests = { version: 1, generatedAt: "2026-11-27T00:00:00.000Z", tests: [] };
const engineer = { roles: ["engineer"] };
const customer = { roles: [] };
const now = new Date("2026-11-27T09:00:00Z");
const render = (view, props = {}) => renderToStaticMarkup(createElement(StoryMapBoard, { map: view, now, ...props }));

test("ESM-128: gives every warning a kind", () => {
  const warnings = storyMapWarnings(map);
  for (const warning of warnings) assert.ok(storyMapWarningKinds.includes(warning.kind), `${warning.message} has no kind`);
  const kinds = new Set(getStoryMapActions(map, { tests }).map(group => group.kind));
  // The fixture sets off every kind, so a new warning without a kind, or a kind no warning uses, fails here.
  assert.deepEqual([...kinds].sort(), [...storyMapWarningKinds].sort());
  for (const kind of storyMapWarningKinds) {
    const info = storyMapActionKinds[kind];
    assert.ok(info.title && info.why, `${kind} has a title and a reason`);
  }
});

test("ESM-128: validate --format json includes each warning's kind, and text output does not change", async () => {
  const result = await checkStoryMap(source);
  assert.ok(result.issues.length > 0);
  for (const issue of result.issues) assert.ok(issue.kind, issue.message);
  const dir = await mkdtemp(join(tmpdir(), "esm-actions-"));
  try {
    await writeFile(join(dir, "map.yaml"), source);
    const json = spawnSync(process.execPath, [cli, "validate", "--format", "json", "map.yaml"], { cwd: dir, encoding: "utf8" });
    const issues = JSON.parse(json.stdout).maps[0].issues;
    assert.ok(issues.every(issue => storyMapWarningKinds.includes(issue.kind)));
    const text = spawnSync(process.execPath, [cli, "validate", "map.yaml"], { cwd: dir, encoding: "utf8" });
    assert.doesNotMatch(text.stderr, /missing-estimate|confirm-draft/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ESM-128: groups actions by kind in order, then by release, with who acts and the fixing command", () => {
  const groups = getStoryMapActions(map, { tests });
  const order = groups.map(group => group.kind);
  assert.deepEqual(order, storyMapActionKindOrder.filter(kind => order.includes(kind)));
  assert.deepEqual(order.slice(0, 5), ["job-without-stories", "step-without-stories", "persona-without-stories", "stories-without-personas", "persona-without-job"]);
  assert.equal(countStoryMapActions(groups), storyMapWarnings(map).length + 1);

  const byKind = Object.fromEntries(groups.map(group => [group.kind, group]));
  assert.equal(byKind["confirm-draft-job"].needsPerson, true);
  assert.equal(byKind["missing-estimate"].needsPerson, true);
  assert.equal(byKind["missing-impact"].needsPerson, false);
  assert.deepEqual(byKind["confirm-draft-job"].actions[0].item, { type: "persona", id: "builder", title: "Builder" });
  assert.equal(byKind["confirm-draft-job"].actions[0].command, "npx story-map confirm price --write");
  assert.equal(byKind["confirm-draft-context"].actions[0].command, "npx story-map confirm builder --write");
  assert.equal(byKind["confirm-draft-impact"].actions[0].command, "npx story-map confirm r1 --impact 1 --write");
  assert.equal(byKind["missing-status-reason"].actions[0].command, "npx story-map edit S-4 --status cut --reason '<why>' --write");
  assert.equal(byKind["depends-on-cut"].actions[0].command, "npx story-map edit S-3 --remove-dependency S-4 --write");
  assert.equal(byKind["job-without-stories"].actions[0].command, "npx story-map edit <story ID> --add-job unused --write");
  assert.equal(byKind["missing-estimate"].actions[0].command, undefined);
  assert.deepEqual(byKind["missing-estimate"].actions[0].item, { type: "story", id: "S-2", title: "Save a draft quote" });
  assert.equal(byKind["missing-estimate"].actions[0].release, "r1");
  assert.deepEqual(byKind["stories-without-personas"].actions[0].item, { type: "map" });
  assert.deepEqual(byKind["story-without-tests"].actions.map(action => action.item.id), ["S-3"]);

  // Within a group, releases in map order come first, and items in no release last.
  const mixed = parseStoryMap(source.replace("    title: Save a draft quote\n    activity: prepare\n    release: r1\n", "    title: Save a draft quote\n    activity: prepare\n    release: r1\n    status: blocked\n"));
  const reasons = getStoryMapActions(mixed).find(group => group.kind === "missing-status-reason").actions;
  assert.deepEqual(reasons.map(action => action.item.id), ["S-2", "S-4"]);
});

test("ESM-128: says each action's line when it can locate it, and filters by kind, release, item and who acts", async () => {
  const { loadStoryMap } = await import("../dist/schema.js");
  const loaded = loadStoryMap(source);
  const groups = getStoryMapActions(loaded.map, { locate: loaded.locate });
  const estimate = groups.find(group => group.kind === "missing-estimate").actions[0];
  assert.equal(source.split("\n")[estimate.line - 1].trim(), "- id: S-2");

  const people = filterStoryMapActions(groups, { needsPerson: true });
  assert.deepEqual(people.map(group => group.kind), ["confirm-draft-job", "confirm-draft-context", "confirm-draft-impact", "missing-estimate"]);
  assert.deepEqual(filterStoryMapActions(groups, { release: "r2" }).flatMap(group => group.actions).map(action => action.release), ["r2", "r2", "r2", "r2"]);
  assert.deepEqual(filterStoryMapActions(groups, { item: "S-3" }).map(group => group.kind), ["persona-without-job", "depends-on-cut"]);
  assert.deepEqual(filterStoryMapActions(groups, { kind: "missing-impact" }).map(group => group.kind), ["missing-impact"]);
});

test("ESM-128: reads the Actions tab's parameters, keeping only values the view has", () => {
  const filters = readStoryMapFilters(new URLSearchParams("view=actions&action-kind=missing-estimate&action-release=r1&action-item=S-2&needs-person=1"));
  assert.equal(filters.view, "actions");
  assert.deepEqual(filters.actions, { kind: "missing-estimate", release: "r1", item: "S-2", needsPerson: true });
  assert.equal(readStoryMapFilters(new URLSearchParams("action-kind=nonsense")).actions, undefined);

  const view = getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=actions&action-release=nope&action-item=S-2&needs-person=1"), now });
  assert.equal(view.filter.view, "actions");
  assert.deepEqual(view.filter.actions, { item: "S-2", needsPerson: true });
  // Customers never get the tab or its filters.
  const customerView = getStoryMapPage(map, customer, { searchParams: new URLSearchParams("view=actions&needs-person=1"), now });
  assert.equal(customerView.filter.view, undefined);
  assert.equal(customerView.filter.actions, undefined);
});

test("ESM-128: the Actions tab lists the actions in groups, with counts that ignore the board's filters", () => {
  const view = getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=actions&q=archive"), tests, now });
  const html = render(view);
  const total = countStoryMapActions(view.actions);
  assert.match(html, new RegExp(`>Actions<span class="esm-tab-count"><span aria-hidden="true">${total}</span><span class="esm-visually-hidden">, ${total} actions</span>`));
  assert.match(html, /<a class="esm-tab" href="\?q=archive&amp;view=actions" aria-current="page">Actions/);
  // The tab replaces the map, its panels and its toolbar.
  assert.doesNotMatch(html, /esm-grid|esm-toolbar|esm-detail"/);
  const headings = [...html.matchAll(/<section class="esm-action-group"[^>]*data-kind="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(headings, view.actions.map(group => group.kind));
  assert.match(html, /<h3 id="[^"]+">Confirm a drafted job <span class="esm-tab-count">1<\/span> <span class="esm-action-who" data-person="">Needs a person<\/span><\/h3>/);
  assert.match(html, /<span class="esm-action-who" data-person="">Needs a person<\/span>/);
  // Each action links to its item: a story's permalink, a release's, or a persona's page.
  // A table per kind, a row per item, linking to a story's permalink, a release's, or a persona's page.
  assert.match(html, /<th scope="row" class="esm-action-item"><a href="\?story=S-2#esm-story-S-2">S-2 Save a draft quote<\/a><\/th>/);
  assert.match(html, /<th scope="row" class="esm-action-item"><a href="\?release=r2#esm-release-r2">Second<\/a><\/th>/);
  assert.match(html, /<th scope="row" class="esm-action-item"><a href="\?q=archive&amp;persona=builder&amp;view=personas">Builder<\/a><\/th>/);
  assert.match(html, /<th scope="row" class="esm-action-item">The whole map<\/th>/);
  // Commands are never shown: each row's Copy button carries its command, and board.js shows the button.
  assert.doesNotMatch(html, /<code/);
  assert.match(html, /<button type="button" class="esm-change-copy esm-action-copy" data-esm-copy-command="npx story-map confirm price --write" title="npx story-map confirm price --write" hidden="">/);
  // Story rows say their release.
  assert.match(html, /<td class="esm-action-release">First<\/td>/);
  // A kind with several commands gets row checkboxes and Copy commands; one with none gets neither.
  const reasons = html.match(/<section class="esm-action-group"[^>]*data-kind="missing-estimate"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(reasons, /data-esm-copy|data-esm-select/);
  const several = parseStoryMap(source.replace("    title: Archive a quote\n    activity: prepare\n    release: r2\n", "    title: Archive a quote\n    activity: prepare\n    release: r2\n    status: blocked\n").replace("    title: Copy a quote\n    activity: prepare\n    release: r2\n", "    title: Copy a quote\n    activity: prepare\n    release: r2\n    status: blocked\n"));
  const reasonTable = render(getStoryMapPage(several, engineer, { searchParams: new URLSearchParams("view=actions&action-kind=missing-status-reason"), now }));
  assert.match(reasonTable, /<p class="esm-action-bulk" hidden=""><button type="button" class="esm-change-copy" data-esm-copy-selected="([^"]+)" disabled="">[\s\S]*<table class="esm-action-table" id="\1">/);
  assert.equal(reasonTable.match(/<input type="checkbox" data-esm-select="npx story-map edit S-\d /g).length, 3);
  assert.match(reasonTable, /<input type="checkbox" data-esm-select-all="" aria-label="Choose every row in Say why a story stopped"\/>/);
  assert.match(html, /Checked <time dateTime="2026-11-27T09:00:00.000Z">/);
});

test("ESM-128: the tab's filters are links that keep the board's filters and narrow the list", () => {
  const view = getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=actions&q=archive&needs-person=1&action-release=r1"), now });
  const html = render(view);
  const kinds = [...html.matchAll(/<section class="esm-action-group"[^>]*data-kind="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(kinds, ["confirm-draft-impact", "missing-estimate"]);
  assert.match(html, /<a class="esm-action-toggle" href="\?q=archive&amp;view=actions&amp;action-release=r1" aria-current="true">Needs a person<\/a>/);
  assert.match(html, /<a href="\?q=archive&amp;view=actions&amp;action-kind=missing-estimate&amp;action-release=r1&amp;needs-person=1">Agree an estimate \(1\)<\/a>/);
  assert.match(html, /<a class="esm-clear" href="\?q=archive&amp;view=actions">Clear<\/a>/);
  assert.match(html, /<span class="esm-results">2 of \d+ actions<\/span>/);
});

test("ESM-128: links each action's line under sourceBaseUrl, and shows the line without it", () => {
  const view = getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=actions&action-kind=missing-estimate"), now, mapFile: { path: "product/story-map.yaml", source } });
  const line = source.split("\n").indexOf("  - id: S-2") + 1;
  const linked = render(view, { sourceBaseUrl: "https://github.com/acme/app/blob/main/" });
  assert.match(linked, new RegExp(`<td class="esm-action-line"><a href="https://github.com/acme/app/blob/main/product/story-map.yaml#L${line}" target="_blank" rel="noopener noreferrer">${line}`));
  const plain = render(view);
  assert.match(plain, new RegExp(`<td class="esm-action-line">${line}</td>`));
  // Without the source, actions have no lines.
  const unlocated = render(getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=actions"), now }));
  assert.doesNotMatch(unlocated, /esm-action-line/);
});

test("ESM-128: an empty tab says nothing is waiting, and when the map was checked", () => {
  const clean = parseStoryMap(`version: 1
id: clean
title: Clean
activities:
  - id: a
    title: A
releases:
  - id: r
    title: R
stories: []
`);
  const html = render(getStoryMapPage(clean, engineer, { searchParams: new URLSearchParams("view=actions"), now }));
  assert.match(html, />Actions<span class="esm-tab-count"><span aria-hidden="true">0<\/span>/);
  assert.match(html, /Nothing is waiting on the map\. <span class="esm-actions-checked">Checked <time/);
  assert.doesNotMatch(html, /esm-actions-filters/);
});

test("ESM-128: story and release panels and the persona page show their own actions", () => {
  const view = getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("status=all"), tests, now });
  const html = render(view);
  const panels = html.match(/<div class="esm-detail[" ][\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$)/g);
  const panel = title => panels.find(item => item.includes(`>${title}</h3>`));
  const estimate = panel("Save a draft quote");
  assert.match(estimate, /<h4 id="[^"]+">Actions<\/h4>/);
  assert.match(estimate, /<span class="esm-action-item">Agree an estimate<\/span><span class="esm-action-who" data-person="">Needs a person<\/span>/);
  assert.doesNotMatch(estimate.match(/<section class="esm-detail-section esm-item-actions"[\s\S]*?<\/section>/)[0], /<code/);
  assert.match(estimate, /<a href="\?status=[^"]*&amp;view=actions&amp;action-item=S-2">See them on the Actions tab/);
  const send = panel("Send the quote");
  assert.match(send, /Link a story to a job[\s\S]*Tag a test[\s\S]*Replan a dependency on cut work/);
  // A story with no actions has no row, and cards show nothing new.
  assert.doesNotMatch(panel("Price from the catalogue"), /esm-item-actions/);
  assert.doesNotMatch(html.slice(0, html.indexOf('<div class="esm-detail')), /esm-action/);
  const release = panels.find(item => item.includes("esm-release-detail") && item.includes(">Second</h3>"));
  assert.match(release, /Add a release&#x27;s impact[\s\S]*npx story-map release-impact r2/);
  const releaseActions = release.match(/<section class="esm-detail-section esm-item-actions"[\s\S]*?<\/section>/)[0];
  assert.equal(releaseActions.match(/<li class="esm-action">/g).length, 1, "a release's row lists only the release's own actions");

  const personaPage = render(getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("view=personas&persona=builder"), now }));
  assert.match(personaPage, /<section class="esm-page-actions esm-item-actions"[\s\S]*Confirm a drafted job[\s\S]*Confirm a persona&#x27;s drafted context/);
  assert.match(personaPage, /href="\?persona=builder&amp;view=actions&amp;action-item=builder">See them on the Actions tab/);
});

test("ESM-128: customers never see actions, in HTML or JSON", () => {
  const view = getStoryMapForViewer(map, customer, { tests, mapFile: { path: "product/story-map.yaml", source } });
  assert.equal(view.audience, "all-users");
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /actions|mapPath|needsPerson|confirm/);
  const html = render(getStoryMapPage(map, customer, { searchParams: new URLSearchParams("view=actions"), now }));
  assert.doesNotMatch(html, /esm-tab|esm-action[ "-]|esm-item-actions|>Actions<|story-map confirm|draft/i);
});

test("ESM-128: story-map actions prints the tab's list, filtered, as text or JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "esm-actions-cli-"));
  try {
    await writeFile(join(dir, "map.yaml"), source);
    const run = (...args) => spawnSync(process.execPath, [cli, "actions", "--map", "map.yaml", ...args], { cwd: dir, encoding: "utf8" });
    const json = run("--format", "json");
    assert.equal(json.status, 0, json.stderr);
    const body = JSON.parse(json.stdout);
    assert.equal(body.format, "auto-story-map.actions");
    const expected = getStoryMapActions(map).map(group => [group.kind, group.actions.map(action => action.message)]);
    assert.deepEqual(body.groups.map(group => [group.kind, group.actions.map(action => action.message)]), expected);
    assert.ok(body.groups.every(group => group.actions.every(action => action.line > 0)));

    const people = JSON.parse(run("--format", "json", "--needs-person").stdout);
    assert.deepEqual(people.groups.map(group => group.kind), ["confirm-draft-job", "confirm-draft-context", "confirm-draft-impact", "missing-estimate"]);

    const text = run("--release", "r1");
    assert.equal(text.status, 0);
    assert.match(text.stdout, /^Confirm a release's drafted impact \(1\): needs a person\n/);
    assert.match(text.stdout, /  - r1 \(First\), line \d+: Confirm the drafted impact for “Time to quote”[^\n]*\n    npx story-map confirm r1 --impact 1 --write\n/);
    assert.match(text.stdout, /2 actions, 2 for a person only\. Agents act only on the others\.\n$/);

    await writeFile(join(dir, "quote.test.js"), `test("S-3: sends the quote", () => {});\n`);
    const tagged = JSON.parse(run("--format", "json", "--tests", "quote.test.js").stdout);
    assert.equal(tagged.groups.some(group => group.kind === "story-without-tests"), false);
    assert.equal(tagged.checkedTests, true);

    assert.equal(run("--kind", "nonsense").status, 2);
    assert.equal(run("--release", "nope").status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ESM-128: board.js copies a row's command, and the chosen rows' commands one per line", async t => {
  const written = [];
  const status = { textContent: "" };
  const fakeLabel = () => ({ textContent: "Copy", dataset: {} });
  const rowLabel = fakeLabel();
  const bulkLabel = fakeLabel();
  const boxes = ["npx story-map confirm a --write", "npx story-map confirm b --write", "npx story-map confirm c --write"]
    .map(command => ({ checked: false, dataset: { esmSelect: command }, matches: () => false }));
  const all = { checked: false, indeterminate: false, matches: selector => selector === "[data-esm-select-all]" };
  const bulk = { hidden: true };
  let wrap;
  const rowButton = { hidden: true, dataset: { esmCopyCommand: "npx story-map confirm a --write" }, querySelector: () => rowLabel, closest: () => null };
  const bulkButton = { disabled: true, dataset: {}, querySelector: () => bulkLabel, closest: selector => selector === "[data-esm-action-table]" ? wrap : null };
  wrap = {
    querySelectorAll: selector => selector === "input[data-esm-select]" ? boxes : [],
    querySelector: selector => selector === "input[data-esm-select-all]" ? all : selector === "button[data-esm-copy-selected]" ? bulkButton : null,
  };
  for (const box of [...boxes, all]) box.closest = selector => selector === "[data-esm-action-table]" ? wrap : selector.includes("input") ? box : null;
  class FakeElement {
    constructor(target) { this.target = target; }
    closest(selector) { return this.target.closest?.(selector) ?? null; }
  }
  rowButton.closest = selector => selector === "button[data-esm-copy-command]" ? rowButton : null;
  const bulkClosest = bulkButton.closest;
  bulkButton.closest = selector => selector === "button[data-esm-copy-selected]" ? bulkButton : bulkClosest(selector);
  const handlers = {};
  const board = {
    dataset: {},
    querySelector: selector => selector === "[data-esm-copy-status]" ? status : null,
    querySelectorAll: selector => selector === "button[data-esm-copy-command]" ? [rowButton] : selector === ".esm-action-bulk" ? [bulk] : [],
    addEventListener: (type, handler) => { handlers[type] = (handlers[type] ?? 0) + 1; board[`on${type}`] = handler; },
  };
  const globals = { Element: FakeElement, navigator: { clipboard: { writeText: async text => { written.push(text); } } }, document: { readyState: "complete", querySelectorAll: () => [] } };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));

  const { enhanceStoryMapActions } = await import("auto-story-map/board.js");
  enhanceStoryMapActions({ querySelectorAll: () => [board] });
  enhanceStoryMapActions({ querySelectorAll: () => [board] });
  assert.deepEqual(handlers, { change: 1, click: 1 }, "enhancing twice adds one listener of each");
  assert.equal(rowButton.hidden, false);
  assert.equal(bulk.hidden, false);
  assert.ok("esmActions" in board.dataset, "turns on the checkbox column");

  board.onclick({ target: new FakeElement(rowButton) });
  await settle();
  assert.deepEqual(written, ["npx story-map confirm a --write"]);
  assert.equal(rowLabel.textContent, "Copied");
  assert.equal(status.textContent, "Copied command");

  boxes[0].checked = true;
  boxes[2].checked = true;
  board.onchange({ target: new FakeElement(boxes[2]) });
  assert.equal(bulkButton.disabled, false);
  assert.equal(bulkLabel.textContent, "Copy 2 commands");
  assert.equal(all.indeterminate, true);
  board.onclick({ target: new FakeElement(bulkButton) });
  await settle();
  assert.equal(written[1], "npx story-map confirm a --write\nnpx story-map confirm c --write");
  assert.equal(status.textContent, "Copied 2 commands");

  all.checked = true;
  board.onchange({ target: new FakeElement(all) });
  assert.ok(boxes.every(box => box.checked));
  assert.equal(bulkLabel.textContent, "Copy 3 commands");
  all.checked = false;
  board.onchange({ target: new FakeElement(all) });
  assert.ok(boxes.every(box => !box.checked));
  assert.equal(bulkButton.disabled, true);
  assert.equal(bulkLabel.textContent, "Copy commands");
});
