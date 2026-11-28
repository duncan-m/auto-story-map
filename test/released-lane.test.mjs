import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse as parseYaml, stringify } from "yaml";
import { filterStoryMapView, getStoryMapForViewer, getStoryMapPage, parseStoryMap, readStoryMapFilters } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

const fixture = parseYaml(await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8"));

/**
 * The fixture with BUILDER-101 and FINANCE-201 shipped. builder-mvp keeps BUILDER-102 and BUILDER-103,
 * finance-follow-up has only a shipped story, and reconciliation-internal only a cut one.
 */
function shippedMap(change = () => {}) {
  const document = structuredClone(fixture);
  for (const story of document.stories) if (story.id === "BUILDER-101" || story.id === "FINANCE-201") story.status = "shipped";
  change(document);
  return parseStoryMap(stringify(document));
}

const engineer = { roles: ["engineer"] };
const member = { roles: ["member"] };
const page = (map, query, viewer = engineer) => getStoryMapPage(map, viewer, { canViewInternal: user => user.roles.includes("engineer"), searchParams: new URLSearchParams(query) });
const render = (view, props = {}) => renderToStaticMarkup(createElement(StoryMapBoard, { map: view, showVersion: false, ...props }));
const laneNames = html => [...html.matchAll(/<span class="esm-release-name"><span class="esm-release-dot" aria-hidden="true"><\/span>(?:<button[^>]*>)?([^<]+)/g)].map(match => match[1]);
const lane = (html, id) => {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `no lane ${id}`);
  const end = html.indexOf('<div class="esm-row esm-lane', start + 1);
  return html.slice(start, end === -1 ? html.indexOf("</div></div></div>", start) : end);
};
const cardIds = html => [...html.matchAll(/id="esm-story-([^"]+)"/g)].map(match => match[1]);

test("ESM-205: reads released=1 and keeps it on internal views only", () => {
  assert.equal(readStoryMapFilters(new URLSearchParams("released=1")).released, true);
  for (const query of ["", "released=0", "released=yes", "released="]) {
    assert.equal(Object.hasOwn(readStoryMapFilters(new URLSearchParams(query)), "released"), false, query);
  }
  const map = shippedMap();
  assert.equal(page(map, "released=1").filter.released, true);
  assert.equal(Object.hasOwn(page(map, "").filter, "released"), false);
  // Customers never get it, so their board is the same either way.
  assert.equal(Object.hasOwn(page(map, "released=1", member).filter, "released"), false);
  assert.equal(render(page(map, "released=1", member)), render(page(map, "", member)));
  // It changes the layout, not which stories the view keeps.
  assert.deepEqual(page(map, "released=1").stories, page(map, "").stories);
  assert.deepEqual(filterStoryMapView(getStoryMapForViewer(map, engineer, { canViewInternal: () => true }), { released: true }).filter.released, true);
});

test("ESM-205: the switch is off by default, on with released=1, and only on internal boards", () => {
  const map = shippedMap();
  const off = render(page(map, ""));
  assert.match(off, /<label class="esm-released-switch">Shipped as Released<input type="checkbox" role="switch" aria-describedby="[^"]+" name="released" value="1"\/><\/label><button type="submit" class="esm-button esm-apply">/);
  assert.match(render(page(map, "released=1")), /<input type="checkbox" role="switch" aria-describedby="[^"]+" name="released" checked="" value="1"\/>/);
  assert.doesNotMatch(render(page(map, "", member)), /esm-released-switch/);
  assert.doesNotMatch(off, /esm-released-lane/, "no Released lane while it is off");
});

test("ESM-205: shipped stories move to one Released lane first, and releases they empty drop out", () => {
  const map = shippedMap();
  const html = render(page(map, "released=1"));
  // reconciliation-internal had no shown stories to begin with, so it stays, as it does without the switch.
  assert.deepEqual(laneNames(html), ["Released", "Builder workflow", "Reconciliation discovery"]);
  assert.deepEqual(laneNames(render(page(map, ""))), ["Builder workflow", "Finance follow-up", "Reconciliation discovery"]);
  const released = lane(html, "esm-released");
  assert.deepEqual(cardIds(released), ["BUILDER-101", "FINANCE-201"]);
  assert.match(released, /<span class="esm-release-summary">Shipped stories from 2 releases\.<\/span><span class="esm-release-count">2 stories<\/span>/);
  assert.match(released, /<input type="checkbox" class="esm-collapse-input" aria-label="Collapse Released" value=":released"\/>/);
  assert.doesNotMatch(released, /esm-release-button|esm-impact/, "no release panel or impact line");
  assert.deepEqual(cardIds(lane(html, "esm-release-builder-mvp")), ["BUILDER-102", "BUILDER-103"]);
  assert.doesNotMatch(html, /id="esm-release-finance-follow-up"/);
  // Lane colours start with the Released lane.
  assert.deepEqual([...html.matchAll(/class="esm-row esm-lane[^"]*" role="row" id="[^"]+" data-lane="(\d)"/g)].map(match => match[1]), ["0", "1", "2"]);
});

test("ESM-205: each story keeps its own release in its panel and permalink", () => {
  const html = render(page(shippedMap(), "released=1"));
  const panelId = /id="esm-story-FINANCE-201" aria-haspopup="dialog" popoverTarget="([^"]+)"/.exec(html)[1];
  const start = html.indexOf(`<div class="esm-detail" id="${panelId}"`);
  const panel = html.slice(start, html.indexOf('<div class="esm-detail"', start + 1));
  assert.match(panel, /<dt>Release<\/dt><dd>Finance follow-up<\/dd>/);
  assert.match(panel, /\?story=FINANCE-201#esm-story-FINANCE-201/);
  // The release panels are for the lanes still shown.
  assert.doesNotMatch(html, /esm-release-finance-follow-up/);
  assert.match(html, /id="esm-story-FINANCE-201"/);
});

test("ESM-205: works with the status and persona filters, and links keep it", () => {
  const map = shippedMap();
  // Without Shipped in the status filter, nothing is shipped, so there is no Released lane.
  const unshipped = render(page(map, "released=1&status=planned&status=in-progress"));
  assert.doesNotMatch(unshipped, /esm-released-lane/);
  assert.deepEqual(laneNames(unshipped).length, 1);
  // Search narrows the Released lane like any other.
  const searched = render(page(map, "released=1&q=draft"));
  assert.deepEqual(cardIds(lane(searched, "esm-released")), ["BUILDER-101"]);
  // A map where everything shown has shipped still draws the board.
  const allShipped = render(page(map, "released=1&status=shipped"));
  assert.deepEqual(laneNames(allShipped), ["Released"]);
  // With the persona filter, only that persona's shipped stories are in the Released lane.
  const withPersonas = shippedMap(document => {
    document.personas = [
      { id: "builder", title: "Builder", jobs: [{ id: "price-materials", situation: "I am pricing a project", motivation: "to use the catalogue prices", outcome: "my estimate matches what finance pays" }] },
      { id: "finance", title: "Finance reviewer", jobs: [{ id: "approve-estimate", situation: "an estimate arrives", motivation: "to see the prices the builder saw", outcome: "I can approve it without asking" }] },
    ];
    for (const story of document.stories) story.jobs = [story.id.startsWith("BUILDER") ? "price-materials" : "approve-estimate"];
  });
  const finance = render(page(withPersonas, "released=1&persona=finance"));
  assert.deepEqual(cardIds(lane(finance, "esm-released")), ["FINANCE-201"]);
  assert.deepEqual(laneNames(finance), ["Released"]);
  // Tab links carry it, so going to the Personas tab and back keeps it.
  assert.match(render(page(map, "released=1")), /class="esm-tab" href="\?released=1&amp;view=personas"/);
});

test("ESM-205: board.js applies the switch as soon as it changes, and not a menu checkbox", async t => {
  class FakeElement {}
  class FakeInput extends FakeElement {
    constructor(name, role) { super(); this.name = name; this.role = role; }
    getAttribute(attribute) { return attribute === "role" ? this.role ?? null : null; }
  }
  const storage = new Map();
  const globals = {
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: class {},
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
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
  const form = {
    dataset: {},
    elements: { namedItem: () => null },
    querySelector: () => null,
    addEventListener: (type, handler) => { listeners[type] = handler; },
    requestSubmit: () => submitted++,
  };
  const { enhanceStoryMapFilters } = await import("auto-story-map/board.js");
  enhanceStoryMapFilters({ querySelectorAll: () => [form] });
  listeners.change({ target: new FakeInput("status") });
  assert.equal(submitted, 0, "menu checkboxes wait for the menu to close");
  listeners.change({ target: new FakeInput("released", "switch") });
  assert.equal(submitted, 1);
  assert.equal(storage.get("esm-filter-focus"), "released");
});
