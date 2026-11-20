import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  diffStoryMaps,
  filterStoryMapView,
  formatStoryMapDiff,
  hasStoryMapChanges,
  parseStoryMapHistory,
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
  // The demo’s cut story is hidden by default and shown on request.
  assert.doesNotMatch(internal, /Explore duplicate approval handling/);
  assert.match(internal, /1 cut hidden\./);
  assert.match(await makeStoryMapResponse("/story-map?status=all", map, engineer).text(), /Explore duplicate approval handling/);

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
  assert.equal(cardsIn(internal).length, 4);

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
  assert.match(panel, new RegExp(`<a href="${sourceBaseUrl}source/lib/ap/controls.ts" target="_blank" rel="noopener noreferrer"><code>source/lib/ap/controls.ts</code><svg[^>]*esm-external[\\s\\S]*?<span class="esm-visually-hidden"> \\(opens in a new tab\\)</span></a>`));
  assert.match(html, /<a class="esm-overview-link" href="[^"]+" aria-label="Engineering overview for [^"]+ \(opens in a new tab\)" target="_blank" rel="noopener noreferrer">/);
  // Every engineering link opens in a new tab without giving the new page access to the board.
  const engineeringLinks = panel.match(/<a [^>]*>/g);
  assert.ok(engineeringLinks.length >= 3);
  for (const link of engineeringLinks) assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  assert.match(panel, new RegExp(`<a href="${sourceBaseUrl}docs/another-overview.md#decisions" target="_blank" rel="noopener noreferrer">`));
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
  assert.deepEqual(filterStoryMapView(internal).filter, { query: undefined, status: undefined, total: 5, hidden: { blocked: 0, cut: 1 } });

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
  assert.doesNotMatch(html.match(/<a href="\?as=engineer">/)[0], /target=/);
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
  assert.deepEqual(byPath["activities.3.title"], { severity: "error", path: ["activities", 3, "title"], message: "Missing required field.", itemId: "finance-ops", line: lineOf("- id: finance-ops"), column: 5 });
  assert.equal(byPath["stories.0.status"].itemId, "BUILDER-101");
  assert.equal(byPath["stories.0.status"].line, lineOf("status: started"));
  assert.match(byPath["stories.0.status"].message, /Use one of 'planned', 'in-progress', 'shipped', 'blocked', 'cut'\./);
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
  assert.match(await readFile(join(root, ".github/workflows/story-map.yml"), "utf8"), /story-map validate --format github --check-sources product\/story-map\.yaml/);

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

function editedSample(edit, base = map) {
  const document = structuredClone(base);
  edit(document);
  return parseStoryMap(stringify(document));
}

test("diffs list story, structure and customer-facing changes", () => {
  const after = editedSample(document => {
    const [draft, lookup, submit] = document.stories;
    draft.status = "shipped";
    lookup.release = "finance-follow-up";
    delete submit.customer;
    document.stories.find(story => story.id === "FINANCE-202").title = "Handle duplicate approvals";
    document.stories.splice(4, 0, { id: "BUILDER-104", title: "Check the total", activity: "prepare", release: "builder-mvp", status: "planned", customer: { title: "See your total" } });
    document.stories = document.stories.filter(story => story.id !== "FINANCE-201");
    document.releases.push({ id: "later", title: "Later" });
    document.activities[0].title = "Prepare an estimate";
  });
  const diff = diffStoryMaps(map, after);

  assert.deepEqual(diff.stories.added.map(story => [story.id, story.activity, story.release, story.status]), [["BUILDER-104", "Prepare an estimate", "Builder workflow", "planned"]]);
  assert.deepEqual(diff.stories.removed, [{ id: "FINANCE-201", title: "Approve an estimate and create a purchase order" }]);
  const updates = Object.fromEntries(diff.stories.updated.map(update => [update.id, update]));
  assert.deepEqual(updates["BUILDER-101"].status, { from: "in-progress", to: "shipped" });
  assert.deepEqual(updates["BUILDER-102"].release, { from: "Builder workflow", to: "Finance follow-up" });
  assert.deepEqual(updates["BUILDER-103"].details, ["customer"]);
  assert.deepEqual(updates["FINANCE-202"].titleChange, { from: "Explore duplicate approval handling", to: "Handle duplicate approvals" });
  assert.deepEqual(diff.releases.added, [{ id: "later", title: "Later" }]);
  assert.deepEqual(diff.activities.renamed, [{ id: "prepare", title: "Prepare an estimate", from: "Prepare estimate" }]);

  assert.deepEqual(diff.customer.map(change => [change.id, change.change, change.details]), [
    ["BUILDER-104", "now-visible", []],
    ["BUILDER-101", "updated", ["status In progress → Shipped"]],
    ["BUILDER-102", "updated", ["release Builder workflow → Finance updates"]],
    ["BUILDER-103", "no-longer-visible", []],
    ["FINANCE-201", "no-longer-visible", []],
  ]);

  const markdown = formatStoryMapDiff(diff);
  assert.ok(markdown.indexOf("### Customer-facing changes") < markdown.indexOf("### Stories"));
  assert.match(markdown, /- \*\*Now visible:\*\* `BUILDER-104` “See your total”/);
  assert.match(markdown, /\| `BUILDER-101` Draft an estimate against a project \| Status: In progress → \*\*Shipped\*\* \|/);
  assert.match(markdown, /- Added release `later` Later/);
});

test("diffs flag visibility switches and escape Markdown from the map", () => {
  const internal = { ...map, visibility: "internal" };
  const opened = diffStoryMaps(internal, map);
  assert.deepEqual(opened.visibility, { from: "internal", to: "all-users" });
  assert.equal(opened.customer.length, 4);
  assert.ok(opened.customer.every(change => change.change === "now-visible"));
  assert.match(formatStoryMapDiff(opened), /\[!IMPORTANT\]\n> The map is now visible to all signed-in users/);

  const renamed = editedSample(document => { document.stories[4].title = "Pipe | <img src=x> [link](https://x.test)"; });
  const markdown = formatStoryMapDiff(diffStoryMaps(map, renamed));
  assert.match(markdown, /Pipe \\\| &lt;img src=x&gt; \\\[link\\\]\(https:\/\/x\.test\)/);
  assert.doesNotMatch(markdown, /<img/);

  assert.equal(hasStoryMapChanges(diffStoryMaps(map, map)), false);
  assert.equal(formatStoryMapDiff(diffStoryMaps(map, map)), "## Story map changes\n\nNo story map changes.\n");
  const created = diffStoryMaps(null, map);
  assert.equal(created.created, true);
  assert.equal(created.stories.added.length, 5);
});

test("Markdown anchors follow GitHub’s heading rules", async () => {
  const { markdownAnchors, slugify } = await import("../dist/references.js");
  assert.equal(slugify("Builder workflow"), "builder-workflow");
  assert.equal(slugify("What's `new` in [v0.3](https://x.test)? 🎉"), "whats-new-in-v03-");
  assert.equal(slugify("Upgrade to 0.3.0"), "upgrade-to-030");
  assert.equal(slugify("snake_case & Ünïcode"), "snake_case--ünïcode");
  const anchors = markdownAnchors([
    "# Overview", "## Overview", "Setext heading", "--------------",
    "```md", "## Not a heading", "```", "<a id=\"Custom-Anchor\"></a>", "- list item", "---",
  ].join("\n"));
  assert.deepEqual([...anchors].sort(), ["custom-anchor", "overview", "overview-1", "setext-heading"]);
});

test("source and plan checks report missing files, headings and story IDs", async t => {
  const { checkPlanReferences, checkSources } = await import("../dist/references.js");
  const { loadStoryMap } = await import("../dist/schema.js");
  const root = await mkdtemp(join(tmpdir(), "story-map-refs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs/plans"), { recursive: true });
  await writeFile(join(root, "docs/plans/estimates.md"), "# Plan\n\n## Builder workflow\n\nBUILDER-101 and BUILDER-999. Not ABUILDER-1, UTF-8 or BUILDER-1x.\n");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/estimate.ts"), "");

  const source = sample.replace("      - docs/example-builder-estimate-plan.md#builder-workflow\n", [
    "      - docs/plans/estimates.md#builder-workflow",
    "      - ./src/estimate.ts#L10",
    "      - docs/plans/estimates.md#missing-heading",
    "      - docs/nothing.md",
    "      - ../outside.md",
    "      - https://example.test/doc.md#anything",
    "      - Agreed in the planning call",
    "",
  ].join("\n"));
  const loaded = loadStoryMap(source);
  const lineOf = text => source.split("\n").findIndex(line => line.includes(text)) + 1;

  const sourceIssues = await checkSources(loaded, root);
  assert.deepEqual(sourceIssues.map(issue => [issue.path.join("."), issue.itemId, issue.line, issue.message]), [
    ["stories.1.sources.2", "BUILDER-102", lineOf("#missing-heading"), "'docs/plans/estimates.md' has no heading for '#missing-heading'."],
    ["stories.1.sources.3", "BUILDER-102", lineOf("docs/nothing.md"), "Source file 'docs/nothing.md' does not exist."],
    ["stories.1.sources.4", "BUILDER-102", lineOf("../outside.md"), "Source '../outside.md' points outside the repository."],
  ]);

  const planIssues = await checkPlanReferences(loaded, root, ["docs", "missing-folder"]);
  assert.deepEqual(planIssues.map(issue => [issue.file, issue.line, issue.column, issue.message]), [
    ["docs/plans/estimates.md", 5, 17, "Unknown story ID 'BUILDER-999'. Add it to the map or correct the reference."],
    ["missing-folder", undefined, undefined, "No Markdown files found."],
  ]);
});

test("the CLI diffs the map against a Git reference", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

  git("init", "-q", "-b", "main");
  await mkdir(join(root, "product"));
  await writeFile(join(root, "README.md"), "Before the map.\n");
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  await writeFile(join(root, "product/story-map.yaml"), sample);
  assert.match(run("diff", "main").stdout, /The story map is new in this change\./);

  git("add", "-A");
  git("commit", "-q", "-m", "add map");
  assert.match(run("diff", "HEAD").stdout, /No story map changes\./);
  await writeFile(join(root, "product/story-map.yaml"), sample.replace("status: in-progress", "status: shipped"));
  const markdown = run("diff", "HEAD");
  assert.equal(markdown.status, 0);
  assert.match(markdown.stdout, /\*\*Updated:\*\* `BUILDER-101` “Draft a project estimate”: status In progress → Shipped/);
  const json = JSON.parse(run("diff", "--format", "json", "HEAD").stdout);
  assert.deepEqual(json.stories.updated[0].status, { from: "in-progress", to: "shipped" });

  assert.equal(run("diff", "no-such-ref").status, 2);
  assert.equal(run("diff", "--upload-pack=x").status, 2);
  await writeFile(join(root, "product/story-map.yaml"), "version: 2\n");
  assert.equal(run("diff", "HEAD").status, 1);
});

/** Builds a repository whose map changes over several dated commits by different people. */
async function historyRepo(t) {
  const root = await mkdtemp(join(tmpdir(), "story-map-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, person = {}) => {
    const author = person.author ?? "Test";
    const committer = person.committer ?? author;
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: "a@example.test",
        GIT_COMMITTER_NAME: committer, GIT_COMMITTER_EMAIL: "c@example.test",
        ...(person.date ? { GIT_AUTHOR_DATE: person.date, GIT_COMMITTER_DATE: person.date } : {}),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const writeMap = edit => {
    const document = structuredClone(map);
    edit?.(document);
    return writeFile(join(root, "product/story-map.yaml"), stringify(document));
  };
  const story = (document, id) => document.stories.find(story => story.id === id);

  git(["init", "-q", "-b", "main"]);
  await mkdir(join(root, "product"));
  await writeMap();
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "Add the map"], { author: "Alice", date: "2026-11-01T10:00:00Z" });

  // Bob ships BUILDER-101 and records himself as the editor. Moving FINANCE-201 is not a status change.
  git(["checkout", "-q", "-b", "ship"]);
  await writeMap(document => {
    Object.assign(story(document, "BUILDER-101"), { status: "shipped", updatedBy: "Bob Builder" });
    story(document, "FINANCE-201").release = "builder-mvp";
  });
  git(["commit", "-q", "-am", "Ship drafting"], { author: "Bob", date: "2026-11-10T09:00:00Z" });
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "-m", "Merge ship", "ship"], { author: "Carol", date: "2026-11-12T15:30:00Z" });

  // Dan starts BUILDER-102 but leaves updatedBy as it was, so Git's author is credited.
  git(["checkout", "-q", "-b", "start"]);
  await writeMap(document => {
    Object.assign(story(document, "BUILDER-101"), { status: "shipped", updatedBy: "Bob Builder" });
    story(document, "FINANCE-201").release = "builder-mvp";
    story(document, "BUILDER-102").status = "in-progress";
  });
  git(["commit", "-q", "-am", "Start prices"], { author: "Dan", date: "2026-11-15T11:00:00Z" });
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "-m", "Merge start", "start"], { author: "Carol", date: "2026-11-16T08:00:00Z" });

  // A broken version is skipped, then a GitHub squash merge adds a story.
  await writeFile(join(root, "product/story-map.yaml"), "version: 1\nbroken: true\n");
  git(["commit", "-q", "-am", "Break the map"], { author: "Erin", date: "2026-11-17T10:00:00Z" });
  await writeMap(document => {
    Object.assign(story(document, "BUILDER-101"), { status: "shipped", updatedBy: "Bob Builder" });
    story(document, "FINANCE-201").release = "builder-mvp";
    story(document, "BUILDER-102").status = "in-progress";
    document.stories.push({ id: "BUILDER-104", title: "Check the estimate total", activity: "prepare", release: "builder-mvp", status: "planned" });
  });
  git(["commit", "-q", "-am", "Add totals (#7)"], { author: "Erin", committer: "GitHub", date: "2026-11-18T16:45:00Z" });
  return { root, git };
}

test("history records additions and status changes with editor, merger and date", async t => {
  const { buildStoryMapHistory } = await import("../dist/history-git.js");
  const { root, git } = await historyRepo(t);
  const history = await buildStoryMapHistory({ cwd: root, now: new Date("2026-11-20T12:00:00Z") });

  assert.equal(history.complete, true);
  assert.equal(history.generatedAt, "2026-11-20T12:00:00.000Z");
  const summary = history.events.map(({ storyId, type, from, to, at, by, mergedBy }) => [storyId, type, from, to, at.slice(0, 16), by, mergedBy]);
  assert.deepEqual(summary, [
    ["BUILDER-101", "added", undefined, "in-progress", "2026-11-01T10:00", "Alex Morgan", "Alice"],
    ["BUILDER-102", "added", undefined, "planned", "2026-11-01T10:00", "Sam Patel", "Alice"],
    ["BUILDER-103", "added", undefined, "planned", "2026-11-01T10:00", "Alex Morgan", "Alice"],
    ["FINANCE-201", "added", undefined, "planned", "2026-11-01T10:00", "Taylor Reed", "Alice"],
    ["FINANCE-202", "added", undefined, "cut", "2026-11-01T10:00", "Taylor Reed", "Alice"],
    ["BUILDER-101", "status", "in-progress", "shipped", "2026-11-12T15:30", "Bob Builder", "Carol"],
    ["BUILDER-102", "status", "planned", "in-progress", "2026-11-16T08:00", "Dan", "Carol"],
    ["BUILDER-104", "added", undefined, "planned", "2026-11-18T16:45", "Erin", undefined],
  ]);
  assert.equal(history.events.at(-1).commit, git(["rev-parse", "HEAD"]));
  assert.deepEqual(parseStoryMapHistory(JSON.stringify(history)), history);
  assert.throws(() => parseStoryMapHistory({ ...history, events: [{ storyId: "X" }] }), /Invalid story map history/);

  const shallow = join(root, "shallow");
  git(["clone", "-q", "--depth", "3", `file://${root}`, shallow]);
  await assert.rejects(buildStoryMapHistory({ cwd: shallow }), /shallow clone/);
  const partial = await buildStoryMapHistory({ cwd: shallow, allowShallow: true });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.events.map(event => event.storyId), ["BUILDER-104"]);

  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const out = join(root, "build/history.json");
  const written = spawnSync(process.execPath, [cli, "history", "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stderr, /8 changes to 6 stories/);
  assert.equal(parseStoryMapHistory(await readFile(out, "utf8")).events.length, 8);
  assert.equal(spawnSync(process.execPath, [cli, "history"], { cwd: shallow }).status, 2);
});

test("only internal viewers see history, and it drives the “changed in” filter", async t => {
  const { buildStoryMapHistory } = await import("../dist/history-git.js");
  const { root } = await historyRepo(t);
  const history = await buildStoryMapHistory({ cwd: root });
  const current = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  const now = new Date("2026-11-20T12:00:00Z");

  const internal = getStoryMapForViewer(current, engineer, { history });
  assert.deepEqual(internal.history, { generatedAt: history.generatedAt, complete: true });
  const drafting = internal.stories.find(story => story.id === "BUILDER-101");
  assert.equal(drafting.lastChangedAt, "2026-11-12T15:30:00.000Z");
  assert.deepEqual(drafting.history.map(entry => [entry.type, entry.to, entry.by]), [["status", "shipped", "Bob Builder"], ["added", "in-progress", "Alex Morgan"]]);
  assert.equal(Object.hasOwn(drafting.history[0], "storyId"), false);

  const customer = getStoryMapForViewer(current, regular, { history });
  assert.equal(Object.hasOwn(customer, "history"), false);
  assert.ok(customer.stories.every(story => !("history" in story) && !("lastChangedAt" in story)));

  const ids = (view, days) => filterStoryMapView(view, { status: "all", changedWithinDays: days }, { now }).stories.map(story => story.id);
  assert.deepEqual(ids(internal, 1), []);
  assert.deepEqual(ids(internal, 7), ["BUILDER-102", "BUILDER-104"]);
  assert.deepEqual(ids(internal, 14), ["BUILDER-101", "BUILDER-102", "BUILDER-104"]);
  assert.equal(ids(internal, 30).length, 6);
  assert.equal(filterStoryMapView(internal, { status: "shipped", changedWithinDays: 14 }, { now }).stories.length, 1);
  // Without history, or for customers, the window is ignored rather than hiding every story.
  assert.equal(ids(getStoryMapForViewer(current, engineer), 7).length, 6);
  assert.equal(ids(customer, 7).length, customer.stories.length);

  assert.deepEqual(readStoryMapFilters(new URLSearchParams("changed=7d")), { query: undefined, status: undefined, changedWithinDays: 7 });
  assert.equal(readStoryMapFilters(new URLSearchParams("changed=3d")).changedWithinDays, undefined);
});

test("the board shows when each story changed and its history to internal viewers only", async t => {
  const { buildStoryMapHistory } = await import("../dist/history-git.js");
  const { root } = await historyRepo(t);
  const history = await buildStoryMapHistory({ cwd: root });
  const current = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  const now = new Date("2026-11-20T12:00:00Z");
  const props = { now, timeZone: "UTC", preservedParams: { as: "engineer" } };

  const html = await makeStoryMapResponse("/story-map?changed=14d", current, engineer, { history, now, preservedParams: props.preservedParams }).text();
  assert.match(html, /<option value="14d" selected="">Changed: last 14 days<\/option>/);
  assert.match(html, /Showing 3 of 6 stories\./);

  const board = renderToStaticMarkup(createElement(StoryMapBoard, { map: filterStoryMapView(getStoryMapForViewer(current, engineer, { history }), {}, { now }), ...props }));
  const card = cardsIn(board).find(card => card.includes("BUILDER-101"));
  assert.match(card, /<time class="esm-changed" dateTime="2026-11-12T15:30:00\.000Z" title="12 Nov 2026, 15:30">7 days ago<\/time>/i);
  assert.match(cardsIn(board).find(card => card.includes("BUILDER-104")), />yesterday<\/time>/);
  const panel = panelFor(board, "Draft an estimate against a project");
  assert.match(panel, /<h4 id="[^"]+-history">History<\/h4>/);
  assert.match(panel, /Shipped<\/span><\/span><span class="esm-history-meta"><time dateTime="2026-11-12T15:30:00\.000Z">12 Nov 2026, 15:30<\/time> · by Bob Builder, merged by Carol<\/span>/i);
  assert.match(panel, /Added as <span class="esm-status" data-status="in-progress">[\s\S]*?1 Nov 2026, 10:00<\/time> · by Alex Morgan, merged by Alice/);
  const totals = panelFor(board, "Check the estimate total");
  assert.match(totals, /18 Nov 2026, 16:45<\/time> · by Erin<\/span>/);

  const customer = await makeStoryMapResponse("/story-map?changed=7d", current, regular, { history, now }).text();
  assert.doesNotMatch(customer, /esm-changed|History|Bob Builder|Carol|Alice|name="changed"/);
  const customerJson = await makeStoryMapResponse("/api/story-map", current, regular, { history, now }).json();
  assert.doesNotMatch(JSON.stringify(customerJson), /lastChangedAt|history|Bob Builder/);

  const noHistory = renderToStaticMarkup(createElement(StoryMapBoard, { map: filterStoryMapView(getStoryMapForViewer(current, engineer)), ...props }));
  assert.doesNotMatch(noHistory, /name="changed"|esm-changed|>History</);
});

// The demo map before FINANCE-202 was cut, so tests can watch stories become blocked or cut.
const planningMap = editedSample(document => {
  const story = document.stories.find(story => story.id === "FINANCE-202");
  story.status = "planned";
  delete story.statusReason;
});

// A copy of the demo map with one blocked customer-facing story and one cut internal story.
function withInactiveStories({ reasons = true } = {}) {
  return editedSample(document => {
    for (const story of document.stories) delete story.statusReason;
    Object.assign(document.stories.find(story => story.id === "FINANCE-201"), {
      status: "blocked",
      ...(reasons ? { statusReason: "Waiting on the finance system’s purchase order API." } : {}),
    });
    Object.assign(document.stories.find(story => story.id === "FINANCE-202"), {
      status: "cut",
      ...(reasons ? { statusReason: "Finance will handle duplicates manually until volumes justify it." } : {}),
    });
  });
}

test("warnings come back with a valid map and pass validation unless strict", async t => {
  const { loadStoryMap } = await import("../dist/schema.js");
  const source = stringify(withInactiveStories({ reasons: false }));
  const loaded = loadStoryMap(source);
  assert.deepEqual(loaded.warnings.map(({ severity, path, itemId, message }) => [severity, path.join("."), itemId, message]), [
    ["warning", "stories.3.status", "FINANCE-201", "Add a statusReason explaining why the story is blocked."],
    ["warning", "stories.4.status", "FINANCE-202", "Add a statusReason explaining why the story is cut."],
  ]);
  const line = source.split("\n").findIndex(text => text.includes("status: blocked")) + 1;
  assert.equal(loaded.warnings[0].line, line);
  assert.deepEqual(loadStoryMap(stringify(withInactiveStories())).warnings, []);
  assert.deepEqual(loadStoryMap(sample).warnings, []);

  const directory = await mkdtemp(join(tmpdir(), "story-map-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, source);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  const text = spawnSync(process.execPath, [cli, "validate", file], { encoding: "utf8" });
  assert.equal(text.status, 0);
  assert.equal(text.stderr.split("\n")[0], `${file}:${line}:13: warning: stories.3.status (FINANCE-201): Add a statusReason explaining why the story is blocked.`);
  assert.match(text.stdout, /valid \(4 activities, 3 releases, 5 stories\), 2 warnings/);

  const github = spawnSync(process.execPath, [cli, "validate", "--format", "github", file], { encoding: "utf8" });
  assert.equal(github.status, 0);
  assert.match(github.stdout, new RegExp(`^::warning file=[^,]+,line=${line},col=13,title=Story map::stories\\.3\\.status \\(FINANCE-201\\): Add a statusReason`));

  const strict = spawnSync(process.execPath, [cli, "validate", "--strict", file], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /warning: stories\.4\.status \(FINANCE-202\)/);
  assert.doesNotMatch(strict.stdout, /valid/);

  // Errors are still errors, and say so in the issue.
  assert.throws(() => parseStoryMap(sample.replace("status: in-progress", "status: started")), error =>
    error.issues[0].severity === "error" && /'blocked', 'cut'/.test(error.issues[0].message));
  assert.throws(() => parseStoryMap(stringify(editedSample(document => { document.stories[0].statusReason = "x".repeat(501); }))), /statusReason/);
});

test("blocked and cut stories are hidden by default and shown on request", async () => {
  const inactive = withInactiveStories();
  const internal = getStoryMapForViewer(inactive, engineer);
  const ids = filters => filterStoryMapView(internal, filters).stories.map(story => story.id);

  assert.deepEqual(ids({}), ["BUILDER-101", "BUILDER-102", "BUILDER-103"]);
  assert.deepEqual(filterStoryMapView(internal).filter, { query: undefined, status: undefined, total: 5, hidden: { blocked: 1, cut: 1 } });
  assert.equal(ids({ status: "all" }).length, 5);
  assert.equal(filterStoryMapView(internal, { status: "all" }).filter.hidden, undefined);
  assert.deepEqual(ids({ status: "cut" }), ["FINANCE-202"]);
  assert.deepEqual(ids({ status: "blocked" }), ["FINANCE-201"]);
  // The hidden count only counts stories that match the other filters. Reasons are searchable.
  assert.deepEqual(filterStoryMapView(internal, { query: "duplicates manually" }).filter.hidden, { blocked: 0, cut: 1 });
  assert.equal(filterStoryMapView(getStoryMapForViewer(planningMap, engineer)).filter.hidden, undefined);

  assert.equal(readStoryMapFilters(new URLSearchParams("status=all")).status, "all");
  assert.equal(readStoryMapFilters(new URLSearchParams("status=cut")).status, "cut");

  const html = await makeStoryMapResponse("/story-map?q=e", inactive, engineer, { preservedParams: { as: "engineer" } }).text();
  assert.match(html, /<option value="" selected="">Active<\/option><option value="all">All, including blocked and cut<\/option>/);
  assert.match(html, /<option value="blocked">Blocked<\/option><option value="cut">Cut<\/option>/);
  assert.match(html, /Showing 3 of 5 stories\. 1 blocked and 1 cut hidden\. <a href="\?as=engineer&amp;q=e&amp;status=all">Show them<\/a> · <a href="\?as=engineer">Clear filters<\/a>/);
  assert.doesNotMatch(html, /Explore duplicate approval handling/);

  // With no other filters, every release still shows and the message has no “Clear filters” link.
  const plain = await makeStoryMapResponse("/story-map", inactive, engineer).text();
  assert.match(plain, /<p class="esm-filter-results" role="status">1 blocked and 1 cut hidden\. <a href="\?status=all">Show them<\/a><\/p>/);
  assert.match(plain, /Reconciliation discovery/);
  assert.match(plain, /Finance follow-up<\/span>[\s\S]*?0 stories/);

  const all = await makeStoryMapResponse("/story-map?status=all", inactive, engineer).text();
  assert.equal(cardsIn(all).length, 5);
  assert.doesNotMatch(all, /esm-filter-results/);
  const cut = panelFor(all, "Explore duplicate approval handling");
  assert.match(cut, /<span class="esm-status" data-status="cut"><svg[^>]*><circle[^>]*><\/circle><path d="M3\.6 12\.4 12\.4 3\.6"><\/path><\/svg>Cut<\/span><p class="esm-status-reason">Finance will handle duplicates manually until volumes justify it\.<\/p>/);
  assert.match(panelFor(all, "Approve an estimate"), /data-status="blocked"><svg[^>]*><circle[^>]*><\/circle><path d="M5 8h6"><\/path><\/svg>Blocked<\/span>/);
});

test("customers never see blocked or cut stories", async () => {
  const inactive = withInactiveStories();
  const customer = getStoryMapForViewer(inactive, regular);
  // FINANCE-201 was the only customer-facing story in its activity and release, so both disappear too.
  assert.deepEqual(customer.stories.map(story => story.title), ["Draft a project estimate", "Find material prices", "Submit an estimate for approval"]);
  assert.deepEqual(customer.releases.map(release => release.title), ["Builder workflow"]);
  assert.deepEqual(customer.activities.map(activity => activity.title), ["Prepare an estimate", "Send for approval"]);

  const page = await makeStoryMapResponse("/story-map", inactive, regular).text();
  assert.match(page, /<option value="" selected="">All statuses<\/option><option value="planned">Planned<\/option><option value="in-progress">In progress<\/option><option value="shipped">Shipped<\/option><\/select>/);
  for (const target of ["/story-map?status=all", "/story-map?status=blocked", "/api/story-map?status=all"]) {
    const payload = await (await makeStoryMapResponse(target, inactive, regular)).text();
    assert.doesNotMatch(payload, /Track approved purchases|Finance updates|Track purchases|blocked|Waiting on the finance|statusReason| hidden\./i);
  }
});

test("diffs call out stories that become blocked or cut, with their reasons", () => {
  const inactive = withInactiveStories();
  const diff = diffStoryMaps(planningMap, inactive);
  assert.deepEqual(diff.blockedOrCut.map(({ id, change, from, to }) => [id, change, from, to]), [
    ["FINANCE-201", "entered", "planned", "blocked"],
    ["FINANCE-202", "entered", "planned", "cut"],
  ]);
  assert.deepEqual(diff.customer.map(change => [change.id, change.change]), [["FINANCE-201", "no-longer-visible"]]);

  const markdown = formatStoryMapDiff(diff);
  assert.ok(markdown.indexOf("### Customer-facing changes") < markdown.indexOf("### Blocked and cut"));
  assert.ok(markdown.indexOf("### Blocked and cut") < markdown.indexOf("### Stories"));
  assert.match(markdown, /- \*\*Cut:\*\* `FINANCE-202` Explore duplicate approval handling \(was Planned\)\. Reason: Finance will handle duplicates manually until volumes justify it\./);
  assert.match(markdown, /\| `FINANCE-201` [^|]+ \| Status: Planned → \*\*Blocked\*\*<br>Edited `statusReason` \|/);

  const unblocked = editedSample(document => {
    Object.assign(document.stories.find(story => story.id === "FINANCE-201"), { status: "in-progress" });
  }, planningMap);
  const back = diffStoryMaps(inactive, unblocked);
  assert.deepEqual(back.blockedOrCut.map(({ id, change, from, to }) => [id, change, from, to]), [
    ["FINANCE-201", "left", "blocked", "in-progress"],
    ["FINANCE-202", "left", "cut", "planned"],
  ]);
  assert.match(formatStoryMapDiff(back), /- \*\*No longer blocked:\*\* `FINANCE-201` Approve an estimate and create a purchase order, now In progress\./);
  assert.deepEqual(diffStoryMaps(null, inactive).blockedOrCut.map(change => [change.id, change.from]), [["FINANCE-201", undefined], ["FINANCE-202", undefined]]);
});

test("history records why a story was blocked or cut", async t => {
  const { buildStoryMapHistory } = await import("../dist/history-git.js");
  const { root, git } = await historyRepo(t);
  await writeFile(join(root, "product/story-map.yaml"), stringify(withInactiveStories()));
  git(["commit", "-q", "-am", "Cut duplicate handling"], { author: "Fay", committer: "Fay", date: "2026-11-19T09:00:00Z" });
  const history = await buildStoryMapHistory({ cwd: root });
  const finance = history.events.filter(event => event.storyId.startsWith("FINANCE") && event.to !== "planned");
  assert.deepEqual(finance.map(({ storyId, type, to, reason }) => [storyId, type, to, reason]), [
    // The demo map adds FINANCE-202 as already cut.
    ["FINANCE-202", "added", "cut", "Finance will handle duplicate approvals manually until volumes justify it."],
    ["FINANCE-201", "status", "blocked", "Waiting on the finance system’s purchase order API."],
  ]);
  assert.deepEqual(parseStoryMapHistory(JSON.stringify(history)), history);

  const current = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  const board = renderToStaticMarkup(createElement(StoryMapBoard, {
    map: filterStoryMapView(getStoryMapForViewer(current, engineer, { history }), { status: "all" }),
    timeZone: "UTC",
  }));
  assert.match(panelFor(board, "Explore duplicate approval handling"), /<span class="esm-history-reason">Finance will handle duplicate approvals manually until volumes justify it\.<\/span>/);
});
