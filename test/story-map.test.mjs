import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stringify } from "yaml";
import { z } from "zod";
import {
  filterStoryMapView,
  getStoryMapForViewer,
  parseStoryMap,
  readStoryMapFilters,
  StoryMapValidationError,
  storyMapSchema,
} from "embedded-story-map";
import { StoryMapBoard } from "embedded-story-map/react";
import { makeStoryMapResponse } from "../example/host.mjs";

const sample = await readFile(new URL("../product/story-map.yaml", import.meta.url), "utf8");
const map = parseStoryMap(sample);
const regular = { roles: ["member"] };
const engineer = { roles: ["engineer"] };
const superAdmin = { roles: ["super-admin"] };
const sourceBaseUrl = "https://docs.example.test/repository/";

test("applies internal and planned defaults to new content", () => {
  const document = structuredClone(map);
  delete document.visibility;
  delete document.stories[0].status;
  const parsed = parseStoryMap(stringify(document));
  assert.equal(parsed.visibility, "internal");
  assert.equal(parsed.stories[0].status, "planned");
});

test("rejects duplicate YAML keys, duplicate IDs and dangling references", () => {
  assert.throws(() => parseStoryMap(sample + "version: 1\n"), /unique/i);
  const invalid = structuredClone(map);
  invalid.stories.push({ ...invalid.stories[0], release: "missing" });
  assert.throws(() => parseStoryMap(stringify(invalid)), /Duplicate ID[\s\S]*Unknown release/);
});

test("requires approved labels for groups that contain published stories", () => {
  const invalid = structuredClone(map);
  delete invalid.activities[0].customer;
  assert.throws(() => parseStoryMap(stringify(invalid)), /customer-facing copy for its activity/);
});

test("enforces audience permissions on the page and JSON", async () => {
  const privateMap = { ...map, visibility: "internal" };
  for (const path of ["/story-map", "/api/story-map"]) {
    assert.equal(makeStoryMapResponse(path, map, null).status, 401);
    assert.equal(makeStoryMapResponse(path, privateMap, regular).status, 403);
    assert.equal(makeStoryMapResponse(path, privateMap, engineer).status, 200);
    assert.equal(makeStoryMapResponse(path, privateMap, superAdmin).status, 200);
  }
  assert.equal(getStoryMapForViewer(map, engineer).stories.length, 5);
});

test("customer HTML and JSON only contain the customer projection", async () => {
  for (const path of ["/story-map", "/api/story-map"]) {
    const response = makeStoryMapResponse(path, map, regular, { sourceBaseUrl });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const payload = await response.text();
    assert.match(payload, /Find material prices/);
    assert.doesNotMatch(payload, /BUILDER-102|FINANCE-202|Reconciliation discovery|Finance exception|Confirm how|docs\/example-builder|Look up prices/);
    assert.doesNotMatch(payload, /updatedBy|Last updated by|Alex Morgan|Sam Patel|Taylor Reed/);
    assert.doesNotMatch(payload, /Engineering overview|#builder-workflow/);
  }
  const internal = await makeStoryMapResponse("/story-map", map, engineer).text();
  assert.match(internal, /BUILDER-102/);
  assert.match(internal, /Confirm how a catalogue price/);
  assert.match(internal, /Explore duplicate approval handling/);

  const view = await makeStoryMapResponse("/api/story-map", map, regular).json();
  assert.equal(view.stories.length, 4);
  assert.equal(view.activities.length, 3);
  assert.equal(view.releases.length, 2);
  assert.ok(view.stories.every(story => view.activities.some(activity => activity.id === story.activity)));
});

test("shows the recorded editor on internal cards and accepts older records", async () => {
  const document = structuredClone(map);
  delete document.stories[0].updatedBy;
  document.stories[1].updatedBy = "  Jamie Chen  ";
  const parsed = parseStoryMap(stringify(document));

  for (const viewer of [engineer, superAdmin]) {
    const view = await makeStoryMapResponse("/api/story-map", parsed, viewer).json();
    assert.equal(Object.hasOwn(view.stories[0], "updatedBy"), false);
    assert.equal(view.stories[1].updatedBy, "Jamie Chen");
    const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
    assert.doesNotMatch(panelFor(html, "Draft an estimate against a project"), /Last updated by/);
    assert.match(panelFor(html, "Look up prices in the material catalogue"), /Last updated by Jamie Chen/);
  }
});

function cardsIn(html) {
  return html.match(/<button type="button" class="esm-card"[\s\S]*?<\/button>/g) ?? [];
}

function panelFor(html, text) {
  const panels = html.match(/<div class="esm-detail"[\s\S]*?(?=<div class="esm-detail"|<\/section>$|<\/section><\/main>)/g) ?? [];
  return panels.find(panel => panel.includes(text));
}

test("card faces show only the ID, title and status", async () => {
  const internal = await makeStoryMapResponse("/story-map", map, engineer).text();
  const card = cardsIn(internal).find(card => card.includes("BUILDER-101"));
  assert.match(card, /Draft an estimate against a project/);
  assert.match(card, /In progress/);
  assert.doesNotMatch(card, /Record material quantities|Last updated by|Alex Morgan/);
  assert.equal(cardsIn(internal).length, 5);

  const customer = await makeStoryMapResponse("/story-map", map, regular).text();
  const customerCard = cardsIn(customer).find(card => card.includes("Draft a project estimate"));
  assert.doesNotMatch(customerCard, /List materials and quantities|story-1/);
});

test("each card opens its own detail panel through the popover API", async () => {
  const html = await makeStoryMapResponse("/story-map", map, engineer).text();
  const targets = cardsIn(html).map(card => card.match(/popoverTarget="([^"]+)"/i)[1]);
  assert.equal(new Set(targets).size, targets.length);
  for (const target of targets) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(html, new RegExp(`<div class="esm-detail" id="${escaped}" popover="auto" role="dialog"`));
    assert.match(html, new RegExp(`aria-label="Close" autofocus="" popoverTarget="${escaped}" popoverTargetAction="hide"`, "i"));
  }
});

test("detail panels hold the summary, placement and audience-appropriate engineering details", async () => {
  const internal = await makeStoryMapResponse("/story-map", map, engineer, { sourceBaseUrl }).text();
  const draft = panelFor(internal, "Draft an estimate against a project");
  assert.match(draft, /Record material quantities and units against a project\./);
  assert.match(draft, /<dt>Activity<\/dt><dd>Prepare estimate<\/dd><dt>Release<\/dt><dd>Builder workflow<\/dd>/);
  assert.match(draft, /Last updated by Alex Morgan/);
  const lookup = panelFor(internal, "Look up prices in the material catalogue");
  assert.match(lookup, /<h4[^>]*>Engineering<\/h4>/);
  assert.match(lookup, /Confirm how a catalogue price/);

  const customer = await makeStoryMapResponse("/story-map", map, regular, { sourceBaseUrl }).text();
  const prices = panelFor(customer, "Find material prices");
  assert.match(prices, /Use the price catalogue while preparing an estimate\./);
  assert.match(prices, /<dt>Activity<\/dt><dd>Prepare an estimate<\/dd><dt>Release<\/dt><dd>Builder workflow<\/dd>/);
  assert.doesNotMatch(prices, /Engineering|esm-card-id|Last updated by/);
});

test("renders one Markdown overview link and lists the other sources", async () => {
  const document = structuredClone(map);
  const story = document.stories.find(story => story.sources?.length);
  story.sources.unshift("source/lib/ap/controls.ts", "docs/engineering-overview.md", "Agreed in the March planning call");
  story.sources.push("docs/another-overview.md#decisions");

  const view = await makeStoryMapResponse("/api/story-map", document, engineer).json();
  assert.deepEqual(view.stories.find(card => card.id === story.id).sources, story.sources);

  const html = await makeStoryMapResponse("/story-map", document, engineer, { sourceBaseUrl }).text();
  const overviewLinks = [...html.matchAll(/<a class="esm-overview-link" href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(overviewLinks, [sourceBaseUrl + "docs/example-builder-estimate-plan.md#builder-workflow"]);
  const panel = panelFor(html, story.title);
  assert.match(panel, new RegExp(`<a href="${sourceBaseUrl}source/lib/ap/controls.ts"><code>source/lib/ap/controls.ts</code></a>`));
  assert.match(panel, new RegExp(`<a href="${sourceBaseUrl}docs/another-overview.md#decisions">`));
  assert.match(panel, /<li><code>Agreed in the March planning call<\/code><\/li>/);
});

test("absolute Markdown section links work without a source base URL", async () => {
  const document = structuredClone(map);
  const story = document.stories.find(story => story.sources?.length);
  story.sources = ["https://docs.example.test/ENGINEERING-OVERVIEW.md#controls", "javascript:alert(1)"];
  const html = await makeStoryMapResponse("/story-map", document, superAdmin).text();
  assert.match(html, /class="esm-overview-link" href="https:\/\/docs\.example\.test\/ENGINEERING-OVERVIEW\.md#controls"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<code>javascript:alert\(1\)<\/code>/);
});

test("renders source-only engineering details after a JSON round trip", async () => {
  const document = structuredClone(map);
  const story = document.stories.find(story => story.sources?.length);
  story.sources = ["docs/example-builder-estimate-plan.md"];
  delete story.notes;
  const view = await makeStoryMapResponse("/api/story-map", document, engineer).json();
  const card = view.stories.find(card => card.id === story.id);
  assert.equal(Object.hasOwn(card, "notes"), false);
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view, sourceBaseUrl }));
  const panel = panelFor(html, story.title);
  assert.match(panel, /<h4[^>]*>Engineering<\/h4>/);
  assert.doesNotMatch(panel, /esm-overview-link|esm-notes/);
  assert.ok(panel.includes(story.sources[0]));
});

test("reads only known filter parameters", () => {
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("q=%20price%20&status=shipped")), { query: "price", status: "shipped" });
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("q=&status=done")), { query: undefined, status: undefined });
  assert.equal(readStoryMapFilters(new URLSearchParams(`q=${"x".repeat(500)}`)).query.length, 100);
});

test("filters search only what the viewer can see", () => {
  const internal = getStoryMapForViewer(map, engineer);
  assert.deepEqual(filterStoryMapView(internal, { query: "builder-102" }).stories.map(story => story.id), ["BUILDER-102"]);
  assert.deepEqual(filterStoryMapView(internal, { query: "catalogue price" }).stories.map(story => story.id), ["BUILDER-102"]);
  assert.deepEqual(filterStoryMapView(internal, { status: "in-progress" }).stories.map(story => story.id), ["BUILDER-101"]);
  assert.deepEqual(filterStoryMapView(internal).filter, { query: undefined, status: undefined, total: 5 });

  const customer = getStoryMapForViewer(map, regular);
  assert.equal(filterStoryMapView(customer, { query: "BUILDER-102" }).stories.length, 0);
  assert.equal(filterStoryMapView(customer, { query: "catalogue price" }).stories.length, 0);
  assert.equal(filterStoryMapView(customer, { query: "story-1" }).stories.length, 0);
  assert.deepEqual(filterStoryMapView(customer, { query: "PRICE" }).stories.map(story => story.title), ["Find material prices"]);
});

test("the filter toolbar submits a GET form and keeps host parameters", async () => {
  const plain = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer) }));
  assert.doesNotMatch(plain, /esm-toolbar/);

  const response = makeStoryMapResponse("/story-map?q=estimate&status=planned", map, engineer, { preservedParams: { as: "engineer" } });
  const html = await response.text();
  assert.match(html, /<form class="esm-filters"[^>]* role="search"[^>]* method="get">/);
  assert.match(html, /<input type="hidden" name="as" value="engineer"\/>/);
  assert.match(html, /name="q"[^>]*value="estimate"/);
  assert.match(html, /<option value="planned" selected="">Planned<\/option>/);
  assert.match(html, /Showing 3 of 5 stories\. <a href="\?as=engineer">Clear filters<\/a>/);
  assert.equal(cardsIn(html).length, 3);
  assert.doesNotMatch(html, /Reconciliation discovery/);

  const none = await makeStoryMapResponse("/story-map?q=nothing-matches", map, engineer).text();
  assert.match(none, /No stories match these filters\./);
  assert.doesNotMatch(none, /esm-grid/);

  const json = await makeStoryMapResponse("/api/story-map?status=in-progress", map, regular).json();
  assert.deepEqual(json.stories.map(story => story.title), ["Draft a project estimate"]);
});

test("the board follows the requested theme", () => {
  const view = getStoryMapForViewer(map, engineer);
  assert.match(renderToStaticMarkup(createElement(StoryMapBoard, { map: view })), /data-theme="light"/);
  assert.match(renderToStaticMarkup(createElement(StoryMapBoard, { map: view, theme: "auto" })), /data-theme="auto"/);
});

test("React renders story text as text", async () => {
  const invalid = structuredClone(map);
  invalid.stories[0].customer.title = "<script>alert('story')</script>";
  const html = await makeStoryMapResponse("/story-map", invalid, regular).text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("hosts choose who sees the internal map", () => {
  const productManager = { roles: ["product-manager"] };
  const canViewInternal = viewer => viewer.roles.includes("product-manager");
  assert.equal(getStoryMapForViewer(map, productManager).audience, "all-users");
  assert.equal(getStoryMapForViewer(map, productManager, { canViewInternal }).audience, "internal");
  // A custom rule replaces the default roles.
  assert.equal(getStoryMapForViewer(map, engineer, { canViewInternal }).audience, "all-users");
  // Viewers with no roles, or a rule that does not return true, get the customer view.
  assert.equal(getStoryMapForViewer(map, {}).audience, "all-users");
  assert.equal(getStoryMapForViewer(map, engineer, { canViewInternal: () => "yes" }).audience, "all-users");
  assert.equal(getStoryMapForViewer({ ...map, visibility: "internal" }, productManager), null);
});

test("validation errors name the item and source line", () => {
  const broken = sample
    .replace("status: in-progress", "status: started")
    .replace("    updatedBy: Sam Patel\n", "    updatedBy: Sam Patel\n    owner: Sam\n")
    .replace("release: finance-follow-up\n", "release: finance-later\n")
    .replace("  - id: finance-ops\n    title: Finance exception handling\n", "  - id: finance-ops\n");
  const lines = broken.split("\n");
  const lineOf = text => lines.findIndex(line => line.includes(text)) + 1;

  let error;
  try {
    parseStoryMap(broken);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof StoryMapValidationError);
  const byPath = Object.fromEntries(error.issues.map(issue => [issue.path.join("."), issue]));
  assert.deepEqual(byPath["activities.3.title"], { path: ["activities", 3, "title"], message: "Missing required field.", itemId: "finance-ops", line: lineOf("- id: finance-ops"), column: 5 });
  assert.equal(byPath["stories.0.status"].itemId, "BUILDER-101");
  assert.equal(byPath["stories.0.status"].line, lineOf("status: started"));
  assert.match(byPath["stories.0.status"].message, /Use one of 'planned', 'in-progress', 'shipped'\./);
  assert.equal(byPath["stories.1.owner"].message, "Unknown field.");
  assert.equal(byPath["stories.1.owner"].line, lineOf("owner: Sam"));
  // Reference checks still run when another field is invalid.
  assert.equal(byPath["stories.3.release"].message, "Unknown release 'finance-later'.");
  assert.equal(byPath["stories.3.release"].itemId, "FINANCE-201");
  assert.match(error.message, new RegExp(`line ${lineOf("finance-later")}: stories\\.3\\.release \\(FINANCE-201\\): Unknown release 'finance-later'\\.`));

  assert.throws(() => parseStoryMap("version: 1\nid: a\nid: b\n"), error =>
    error instanceof StoryMapValidationError && error.issues[0].line === 3 && /unique/i.test(error.issues[0].message));
});

test("the CLI prints file positions and GitHub annotations", async t => {
  const directory = await mkdtemp(join(tmpdir(), "story-map-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, sample.replace("release: finance-follow-up\n", "release: finance-later\n"));
  const line = sample.split("\n").findIndex(text => text.includes("release: finance-follow-up")) + 1;
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  const text = spawnSync(process.execPath, [cli, "validate", file], { encoding: "utf8" });
  assert.equal(text.status, 1);
  assert.equal(text.stderr.trim(), `${file}:${line}:14: stories.3.release (FINANCE-201): Unknown release 'finance-later'.`);

  const github = spawnSync(process.execPath, [cli, "validate", "--format", "github", file], { encoding: "utf8" });
  assert.equal(github.status, 1);
  assert.equal(github.stdout.trim(), `::error file=${file.replace(/:/g, "%3A")},line=${line},col=14,title=Story map::stories.3.release (FINANCE-201): Unknown release 'finance-later'.`);

  assert.equal(spawnSync(process.execPath, [cli, "validate", "--format", "xml", file]).status, 2);
});

test("the published JSON Schema matches the validator", async () => {
  const require = createRequire(import.meta.url);
  const schema = JSON.parse(await readFile(require.resolve("embedded-story-map/schema.json"), "utf8"));
  assert.deepEqual(schema, { ...z.toJSONSchema(storyMapSchema, { io: "input" }), $id: schema.$id });
  assert.deepEqual(schema.required, ["version", "id", "title", "activities", "releases", "stories"]);
  const storyProperties = Object.keys(schema.properties.stories.items.properties);
  for (const story of parseStoryMap(sample).stories) {
    for (const key of Object.keys(story)) assert.ok(storyProperties.includes(key), key);
  }
  assert.match(schema.properties.stories.items.properties.status.description, /shipped: available to its intended users/);
  assert.match(sample, /^# yaml-language-server: \$schema=\.\.\/story-map\.schema\.json\n/);
});

test("init sets up a host repository without overwriting anything", async t => {
  const { initStoryMap, describeProduct } = await import("../dist/init.js");
  const root = await mkdtemp(join(tmpdir(), "story-map-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@acme/Field Ops!" }));
  await writeFile(join(root, "package-lock.json"), "{}");
  await writeFile(join(root, "AGENTS.md"), "# House rules\n\nUse British English.");

  const first = await initStoryMap(root);
  assert.deepEqual(first.map(step => [step.path, step.action]), [
    ["product/story-map.yaml", "created"],
    ["docs/story-map.md", "created"],
    ["AGENTS.md", "updated"],
    [".github/workflows/story-map.yml", "created"],
  ]);

  const starter = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  assert.equal(starter.id, "field-ops");
  assert.equal(starter.title, "Field ops story map");
  assert.equal(starter.visibility, "internal");
  assert.match(starter.summary, /^Starter map/);
  assert.equal(await readFile(join(root, "docs/story-map.md"), "utf8"), await readFile(new URL("../docs/story-map.md", import.meta.url), "utf8"));
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /^# House rules\n\nUse British English\.\n\n<!-- embedded-story-map:start -->\n## Story map\n/);
  assert.match(agents, /<!-- embedded-story-map:end -->\n$/);
  assert.match(await readFile(join(root, ".github/workflows/story-map.yml"), "utf8"), /story-map validate --format github product\/story-map\.yaml/);

  await writeFile(join(root, "product/story-map.yaml"), sample);
  const second = await initStoryMap(root);
  assert.ok(second.every(step => step.action === "skipped"));
  assert.equal(await readFile(join(root, "product/story-map.yaml"), "utf8"), sample);
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), agents);

  assert.deepEqual(describeProduct("!!!"), { id: "product", title: "Product story map" });
  assert.equal(describeProduct("x".repeat(100)).id.length, 64);
});

test("init skips the workflow without npm or when asked", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  const run = spawnSync(process.execPath, [cli, "init", "--dir", root], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /skipped  \.github\/workflows\/story-map\.yml \(no package-lock\.json/);
  assert.match(run.stdout, /Next, ask an agent/);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /^<!-- embedded-story-map:start -->/);

  await writeFile(join(root, "package-lock.json"), "{}");
  const noCi = spawnSync(process.execPath, [cli, "init", "--no-ci", "--dir", root], { encoding: "utf8" });
  assert.doesNotMatch(noCi.stdout, /workflows/);
  assert.equal(spawnSync(process.execPath, [cli, "init", "--force"]).status, 2);
});
