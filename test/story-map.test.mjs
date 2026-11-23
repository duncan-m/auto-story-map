import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  storyMapCommit,
  storyMapRepositoryUrl,
  storyMapVersion,
  diffStoryMaps,
  filterStoryMapView,
  formatStoryMapDiff,
  hasStoryMapChanges,
  parseStoryMapHistory,
  parseStoryMapTests,
  getStoryMapForViewer,
  getStoryMapPage,
  parseStoryMap,
  readStoryMapFilters,
  StoryMapValidationError,
  storyMapResponseHeaders,
  storyMapSchema,
  csvContentType,
  jsonContentType,
  storyMapExportResponse,
  storyMapToCsv,
  storyMapAnchorId,
  storyMapPermalink,
  storyMapToJson,
  storyMapToVsdx,
  vsdxContentType,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { makeStoryMapResponse } from "../example/host.mjs";

// The builder estimates sample map: test data with stable IDs, separate from this product’s own map.
const sample = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
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
  assert.doesNotMatch(internal, /cut hidden|Show them/, "the board does not mention hidden stories");
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
  const panels = html.match(/<div class="esm-detail[" ][\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$|<\/section><\/main>)/g) ?? [];
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
  // The card's anchor uses the customer's public ID, which never shows as text.
  assert.match(customerCard, /^<button type="button" class="esm-card" id="esm-story-story-1"/);
  assert.doesNotMatch(customerCard.replace(' id="esm-story-story-1"', ""), /List materials and quantities|story-1/);
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
  const engineeringLinks = panel.match(/<a [^>]*>/g).filter(link => !link.includes("esm-copy-link"));
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

/** The status filter's choices as `value:checked` pairs, such as `planned:1`. Test-only. */
const statusChoicesIn = html => [...html.matchAll(/<input type="checkbox" name="status"( checked="")? value="([^"]+)"\/>/g)].map(match => `${match[2]}:${match[1] ? 1 : 0}`);
const statusSummaryIn = html => /<summary class="esm-select esm-menu-button"[^>]*><span class="esm-visually-hidden">Status: <\/span>([^<]*)<\/summary>/.exec(html)?.[1];

test("reads only known filter parameters", () => {
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("q=%20price%20&status=shipped")), { query: "price", status: ["shipped"] });
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("q=&status=done")), { query: undefined, status: undefined });
  // Status repeats, once per choice, and comes back in board order without duplicates or unknown values.
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("status=stalled&status=cut&status=planned&status=cut&status=done")).status, ["planned", "cut", "stalled"]);
  // Links from before the status filter took several choices still work.
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("status=all")).status, ["planned", "in-progress", "merged", "shipped", "blocked", "cut"]);
  assert.equal(readStoryMapFilters(new URLSearchParams("status=")).status, undefined);
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
  assert.match(html, /<summary class="esm-select esm-menu-button"[^>]*><span class="esm-visually-hidden">Status: <\/span>Planned<\/summary>/);
  assert.match(html, /<input type="checkbox" name="status" checked="" value="planned"\/>Planned/);
  assert.match(html, /<input type="checkbox" name="status" value="shipped"\/>Shipped/);
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
  assert.match(byPath["stories.0.status"].message, /Use one of 'planned', 'in-progress', 'merged', 'shipped', 'blocked', 'cut'\./);
  assert.equal(byPath["stories.1.owner"].message, "Unknown field.");
  assert.equal(byPath["stories.1.owner"].line, lineOf("owner: Sam"));
  // Reference checks still run when another field is invalid.
  assert.equal(byPath["stories.3.release"].message, "Unknown release 'finance-later'.");
  assert.equal(byPath["stories.3.release"].itemId, "FINANCE-201");
  assert.match(error.message, new RegExp(`line ${lineOf("finance-later")}: stories\\.3\\.release \\(FINANCE-201\\): Unknown release 'finance-later'\\.`));

  assert.throws(() => parseStoryMap("version: 1\nid: a\nid: b\n"), error =>
    error instanceof StoryMapValidationError && error.issues[0].line === 3 && /unique/i.test(error.issues[0].message));
  assert.throws(() => parseStoryMap("version: 1\nstories:\n  - id: a\n    id: b\n"), error =>
    error instanceof StoryMapValidationError && error.issues.length === 1 && error.issues[0].line === 4 && error.issues[0].column === 5);
});

test("many unknown fields are located in linear time", () => {
  const count = 20000;
  const source = `${"version: 1\n"}${Array.from({ length: count }, (_, index) => `extra${index}: x\n`).join("")}`;
  const started = performance.now();
  let error;
  try {
    parseStoryMap(source);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof StoryMapValidationError);
  const unknown = error.issues.filter(issue => issue.message === "Unknown field.");
  assert.equal(unknown.length, count);
  assert.equal(unknown.at(-1).line, count + 1);
  assert.ok(performance.now() - started < 3000);
});

test("unknown fields below many unknown top-level fields are located in linear time", () => {
  const count = 20000;
  const root = Array.from({ length: count }, (_, index) => `extra${index}: x\n`).join("");
  const story = Array.from({ length: count }, (_, index) => `    field${index}: x\n`).join("");
  const source = `version: 1\n${root}stories:\n  - id: A-1\n${story}`;
  const started = performance.now();
  let error;
  try {
    parseStoryMap(source);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof StoryMapValidationError);
  const nested = error.issues.filter(issue => issue.message === "Unknown field." && issue.path[0] === "stories");
  assert.equal(nested.length, count);
  assert.deepEqual(nested.at(-1).path, ["stories", 0, `field${count - 1}`]);
  assert.equal(nested.at(-1).line, 2 * count + 3);
  assert.ok(performance.now() - started < 3000);
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
  const schema = JSON.parse(await readFile(require.resolve("auto-story-map/schema.json"), "utf8"));
  assert.deepEqual(schema, { ...z.toJSONSchema(storyMapSchema, { io: "input" }), $id: schema.$id });
  assert.deepEqual(schema.required, ["version", "id", "title", "activities", "releases", "stories"]);
  const storyProperties = Object.keys(schema.properties.stories.items.properties);
  for (const story of parseStoryMap(sample).stories) {
    for (const key of Object.keys(story)) assert.ok(storyProperties.includes(key), key);
  }
  assert.match(schema.properties.stories.items.properties.status.description, /shipped: available to its intended users/);
  const productMap = await readFile(new URL("../product/story-map.yaml", import.meta.url), "utf8");
  assert.match(productMap, /^# yaml-language-server: \$schema=\.\.\/story-map\.schema\.json\n/);
  for (const story of parseStoryMap(productMap).stories) {
    for (const key of Object.keys(story)) assert.ok(storyProperties.includes(key), key);
  }
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
  assert.equal(starter.title, "Field Ops Story Map");
  assert.equal(starter.visibility, "internal");
  assert.match(starter.summary, /^Starter map/);
  assert.equal(await readFile(join(root, "docs/story-map.md"), "utf8"), await readFile(new URL("../docs/story-map.md", import.meta.url), "utf8"));
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /^# House rules\n\nUse British English\.\n\n<!-- auto-story-map:start -->\n## Story map\n/);
  assert.match(agents, /<!-- auto-story-map:end -->\n$/);
  assert.match(await readFile(join(root, ".github/workflows/story-map.yml"), "utf8"), /story-map validate --format github --check-sources product\/story-map\.yaml/);

  // A host with a test folder also checks the story IDs in its test names.
  const withTests = await mkdtemp(join(tmpdir(), "story-map-host-"));
  t.after(() => rm(withTests, { recursive: true, force: true }));
  await writeFile(join(withTests, "package-lock.json"), "{}");
  await mkdir(join(withTests, "tests"));
  await initStoryMap(withTests);
  const workflow = await readFile(join(withTests, ".github/workflows/story-map.yml"), "utf8");
  assert.match(workflow, /story-map validate --format github --check-sources --tests tests product\/story-map\.yaml/);
  assert.match(workflow, /      - tests\/\*\*\n      - package\.json\n/);

  await writeFile(join(root, "product/story-map.yaml"), sample);
  const second = await initStoryMap(root);
  assert.ok(second.every(step => step.action === "skipped"));
  assert.equal(await readFile(join(root, "product/story-map.yaml"), "utf8"), sample);
  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), agents);

  assert.deepEqual(describeProduct("!!!"), { id: "product", title: "Product Story Map" });
  assert.equal(describeProduct("x".repeat(100)).id.length, 64);
});

test("init refuses links that lead outside the repository", async t => {
  const { initStoryMap } = await import("../dist/init.js");
  const base = await mkdtemp(join(tmpdir(), "story-map-links-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "AGENTS.md"), "outside\n");
  const host = async name => {
    const root = join(base, name);
    await mkdir(root);
    return root;
  };

  const agentsLink = await host("agents-link");
  await symlink(join(outside, "AGENTS.md"), join(agentsLink, "AGENTS.md"));
  await assert.rejects(initStoryMap(agentsLink), /AGENTS\.md is a symbolic link that points outside the repository/);
  assert.equal(await readFile(join(outside, "AGENTS.md"), "utf8"), "outside\n");

  const dirLink = await host("dir-link");
  await symlink(outside, join(dirLink, "product"));
  await assert.rejects(initStoryMap(dirLink), /product\/story-map\.yaml: product is a symbolic link that points outside/);

  const dangling = await host("dangling");
  await symlink(join(outside, "missing"), join(dangling, "docs"));
  await assert.rejects(initStoryMap(dangling), /docs is a broken symbolic link/);
  await assert.rejects(readFile(join(outside, "missing", "story-map.md")));

  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = spawnSync(process.execPath, [cli, "init", "--dir", agentsLink], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /points outside the repository/);

  const inside = await host("inside");
  await mkdir(join(inside, "documentation"));
  await symlink("documentation", join(inside, "docs"));
  await writeFile(join(inside, "RULES.md"), "# Rules\n");
  await symlink("RULES.md", join(inside, "AGENTS.md"));
  const steps = await initStoryMap(inside);
  assert.deepEqual(steps.slice(1, 3).map(step => [step.path, step.action]), [["docs/story-map.md", "created"], ["AGENTS.md", "updated"]]);
  assert.match(await readFile(join(inside, "documentation/story-map.md"), "utf8"), /./);
  assert.match(await readFile(join(inside, "RULES.md"), "utf8"), /^# Rules\n\n<!-- auto-story-map:start -->/);

  const dotted = await host("dotted");
  await mkdir(join(dotted, "..documentation"));
  await symlink("..documentation", join(dotted, "docs"));
  await initStoryMap(dotted);
  assert.match(await readFile(join(dotted, "..documentation/story-map.md"), "utf8"), /./);

  await chmod(join(inside, "RULES.md"), 0o444);
  const again = await initStoryMap(inside);
  assert.deepEqual(again.find(step => step.path === "AGENTS.md"), { path: "AGENTS.md", action: "skipped", reason: "already has the story map section" });
});

test("init skips the workflow without npm or when asked", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  const run = spawnSync(process.execPath, [cli, "init", "--dir", root], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /skipped  \.github\/workflows\/story-map\.yml \(no package-lock\.json/);
  assert.match(run.stdout, /Next, ask an agent/);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /^<!-- auto-story-map:start -->/);

  await writeFile(join(root, "package-lock.json"), "{}");
  const noCi = spawnSync(process.execPath, [cli, "init", "--no-ci", "--dir", root], { encoding: "utf8" });
  assert.doesNotMatch(noCi.stdout, /workflows/);
  assert.equal(spawnSync(process.execPath, [cli, "init", "--force"]).status, 2);
});

test("text diagnostics escape line breaks and control characters from the map", async t => {
  const source = stringify(editedSample(document => {
    document.stories.find(story => story.id === "BUILDER-101").status = "shipped";
    document.releases[0].impact[1].metric = "Turnaround\nmap.yaml:1:1: error: forged\r\u001b[2Kdone";
  }));
  const directory = await mkdtemp(join(tmpdir(), "story-map-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, source);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const text = spawnSync(process.execPath, [cli, "validate", file], { encoding: "utf8" });
  assert.equal(text.status, 0);
  const lines = text.stderr.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("“Turnaround\\nmap.yaml:1:1: error: forged\\r\\u001b[2Kdone”"), lines[0]);
  assert.doesNotMatch(text.stderr, /[\r\u001b]/);
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

  // Mentions and issue references from the map do not notify people or link issues when pasted into a PR.
  const mentions = editedSample(document => { document.stories[4].title = "Ask @someone and @org/team about #12 and GH-3"; });
  const pasted = formatStoryMapDiff(diffStoryMaps(map, mentions));
  for (const raw of ["@someone", "@org/team", "#12"]) assert.equal(pasted.includes(raw), false, raw);
  // GitHub renders the empty spans as nothing, so the title still reads “Ask @someone and @org/team about #12 and GH-3”.
  assert.ok(pasted.includes("Ask @<span></span>someone and @<span></span>org/team about #<span></span>12 and GH-3"));
  // Only that markup is added: other HTML from the map is still escaped.
  assert.equal(pasted.replaceAll("<span></span>", "").includes("<"), false);
  // The summary's own Markdown headings are untouched.
  assert.match(pasted, /^## Story map changes\n/);

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

test("Markdown anchors stay linear for headings with unclosed markup", async () => {
  const { markdownAnchors, slugify } = await import("../dist/references.js");
  assert.equal(slugify("a <b>bold</b> ![img](x.png) `<code>` <> < [x]y"), "a-bold-img----xy");
  assert.deepEqual([...markdownAnchors("## Title ## \n# Keep # hash#\n<a name='One' id=\"two\">")].sort(), ["keep--hash", "one", "title", "two"]);
  assert.deepEqual([...markdownAnchors("<a title=\"1 < 2\" id=\"real\"></a>")], ["real"]);
  const size = 200_000;
  const started = performance.now();
  for (const text of ["<", "[", "[a](", "![a]", "`"]) markdownAnchors(`# ${text.repeat(size / text.length)}`);
  markdownAnchors(`# a${" ".repeat(size)}x\n${"<a ".repeat(size / 3)}`);
  assert.ok(performance.now() - started < 1000, "anchor extraction took too long");
});

test("source checks skip heading anchors in oversized Markdown files", async t => {
  const { checkSources, maxMarkdownBytes } = await import("../dist/references.js");
  const { loadStoryMap } = await import("../dist/schema.js");
  const root = await mkdtemp(join(tmpdir(), "story-map-large-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "big.md"), `# Big\n${"x".repeat(maxMarkdownBytes)}`);
  const loaded = loadStoryMap(sample.replace("docs/example-builder-estimate-plan.md#builder-workflow", "big.md#big"));
  const issues = await checkSources(loaded, root);
  assert.ok(issues.some(issue => issue.message === "'big.md' is larger than 5 MB, so '#big' was not checked."));
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

test("CLI options do not take the next option as their value", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-args-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "map.yaml"), sample);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  for (const [args, option] of [
    [["validate", "--plans", "--strict", "map.yaml"], "--plans"],
    [["validate", "--format", "--strict", "map.yaml"], "--format"],
    [["validate", "map.yaml", "--root"], "--root"],
    [["history", "--map", "--allow-shallow"], "--map"],
    [["history", "--bot-names", "--allow-shallow"], "--bot-names"],
    [["history", "--out="], "--out"],
    [["diff", "--map", "--format", "json", "HEAD"], "--map"],
    [["init", "--dir", "--no-ci"], "--dir"],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(" "));
    assert.ok(result.stderr.startsWith(`story-map: ${option} needs a value\n\nUsage:`), `${args.join(" ")}: ${result.stderr.slice(0, 80)}`);
  }
  // With =, a value may start with a hyphen.
  const dashed = run("validate", "--root=-not-a-folder", "--check-sources", "map.yaml");
  assert.notEqual(dashed.status, 2);
  assert.equal(run("validate", "--plans", "missing", "map.yaml").status, 1);
  // Other usage errors print no message before the usage.
  assert.match(run("validate", "--nope", "map.yaml").stderr, /^Usage:/);
});

test("source and plan checks do not follow symbolic links out of the repository", async t => {
  const { checkPlanReferences, checkSources } = await import("../dist/references.js");
  const { loadStoryMap } = await import("../dist/schema.js");
  const base = await mkdtemp(join(tmpdir(), "story-map-links-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const outside = join(base, "outside");
  await mkdir(join(root, "docs/guides"), { recursive: true });
  await mkdir(join(outside, "notes"), { recursive: true });
  await writeFile(join(outside, "secret.md"), "# Secret heading\n\nBUILDER-999\n");
  await writeFile(join(outside, "notes/plan.md"), "BUILDER-998\n");
  await writeFile(join(root, "docs/guides/real.md"), "# Real heading\n");
  await symlink(join(outside, "secret.md"), join(root, "docs/secret.md"));
  await symlink(join(outside, "missing.md"), join(root, "docs/dangling.md"));
  await symlink("../outside/notes", join(root, "notes"));
  await symlink("guides/real.md", join(root, "docs/inside.md"));
  await symlink("guides", join(root, "docs/linked"));
  await symlink("loop-b.md", join(root, "docs/loop-a.md"));
  await symlink("loop-a.md", join(root, "docs/loop-b.md"));

  const sources = [
    "docs/secret.md#secret-heading",
    "docs/dangling.md",
    "notes/plan.md",
    "docs/inside.md#real-heading",
    "docs/linked/real.md#real-heading",
    "docs/inside.md#no-such-heading",
    "docs/loop-a.md",
  ];
  const source = sample.replace("      - docs/example-builder-estimate-plan.md#builder-workflow\n", sources.map(path => `      - ${path}\n`).join(""));
  const issues = await checkSources(loadStoryMap(source), root);
  assert.deepEqual(issues.map(issue => issue.message), [
    "Source 'docs/secret.md#secret-heading' points outside the repository through a symbolic link.",
    // A link out of the repository says the same whether or not its target exists.
    "Source 'docs/dangling.md' points outside the repository through a symbolic link.",
    "Source 'notes/plan.md' points outside the repository through a symbolic link.",
    "'docs/inside.md' has no heading for '#no-such-heading'.",
    "Source file 'docs/loop-a.md' does not exist.",
  ]);

  const loaded = loadStoryMap(sample);
  const plans = await checkPlanReferences(loaded, root, ["docs", "notes", "../outside"]);
  assert.deepEqual(plans.map(issue => [issue.file, issue.message]), [
    ["docs/dangling.md", "Points outside the repository through a symbolic link, so it was not read."],
    ["docs/secret.md", "Points outside the repository through a symbolic link, so it was not read."],
    ["notes", "Points outside the repository through a symbolic link."],
    ["../outside", "Points outside the repository."],
  ]);
  // Links inside the repository are still read: an unknown ID in a linked plan is found once.
  await writeFile(join(root, "docs/guides/real.md"), "# Real heading\n\nBUILDER-997\n");
  const inside = await checkPlanReferences(loaded, root, ["docs/linked"]);
  assert.deepEqual(inside.map(issue => [issue.file, issue.message]), [["docs/guides/real.md", "Unknown story ID 'BUILDER-997'. Add it to the map or correct the reference."]]);
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
  // Builds the history and checks that the reader accepts everything the writer produces.
  const build = async (options = {}) => {
    const { buildStoryMapHistory } = await import("../dist/history-git.js");
    const history = await buildStoryMapHistory({ cwd: root, ...options });
    assert.deepEqual(parseStoryMapHistory(JSON.stringify(history)), history);
    return history;
  };
  return { root, git, build };
}

test("history records additions and status changes with editor, merger and date", async t => {
  const { root, git, build } = await historyRepo(t);
  const history = await build({ now: new Date("2026-11-20T12:00:00Z") });

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
  // The broken version is skipped and says why.
  assert.equal(history.skippedCount, 1);
  assert.deepEqual(history.skipped.map(version => version.commit), [git(["rev-parse", "HEAD~1"])]);
  assert.match(history.skipped[0].reason, /^The map could not be read: id: Missing required field\. \(and \d+ more problems\)$/);
  // Moving FINANCE-201 is an edit, though not a status change.
  assert.deepEqual(history.lastEdits.map(({ storyId, at, by }) => [storyId, at.slice(0, 16), by]), [
    ["BUILDER-101", "2026-11-12T15:30", "Bob Builder"],
    ["BUILDER-102", "2026-11-16T08:00", "Dan"],
    ["BUILDER-103", "2026-11-01T10:00", "Alex Morgan"],
    ["FINANCE-201", "2026-11-12T15:30", "Bob"],
    ["FINANCE-202", "2026-11-01T10:00", "Taylor Reed"],
    ["BUILDER-104", "2026-11-18T16:45", "Erin"],
  ]);
  assert.throws(() => parseStoryMapHistory({ ...history, events: [{ storyId: "X" }] }), /Invalid story map history/);

  const shallow = join(root, "shallow");
  git(["clone", "-q", "--depth", "3", `file://${root}`, shallow]);
  await assert.rejects(build({ cwd: shallow }), /shallow clone/);
  const partial = await build({ cwd: shallow, allowShallow: true });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.events.map(event => event.storyId), ["BUILDER-104"]);
  assert.deepEqual(partial.lastEdits.map(edit => edit.storyId), ["BUILDER-104"]);

  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const out = join(root, "build/history.json");
  const written = spawnSync(process.execPath, [cli, "history", "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stderr, /8 changes to 6 stories/);
  assert.match(written.stderr, /warning: skipped 1 version of the map that could not be read/);
  assert.equal(parseStoryMapHistory(await readFile(out, "utf8")).events.length, 8);
  assert.equal(spawnSync(process.execPath, [cli, "history"], { cwd: shallow }).status, 2);
});

test("only internal viewers see history, and it drives the “changed in” filter", async t => {
  const { root, build } = await historyRepo(t);
  const history = await build();
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
  const { root, build } = await historyRepo(t);
  const history = await build();
  const current = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  const now = new Date("2026-11-20T12:00:00Z");
  const props = { now, timeZone: "UTC", preservedParams: { as: "engineer" } };

  const html = await makeStoryMapResponse("/story-map?changed=14d", current, engineer, { history, now, preservedParams: props.preservedParams }).text();
  const unfiltered = await makeStoryMapResponse("/story-map", current, engineer, { history, now }).text();
  assert.match(unfiltered, /<option value="" selected="">All time<\/option>/, "All time is the default");
  assert.match(html, /<option value="">All time<\/option><option value="1d">Last day<\/option><option value="7d">Last 7 days<\/option><option value="14d" selected="">Last 14 days<\/option><option value="30d">Last 30 days<\/option>/);
  assert.match(html, /Showing 3 of 6 stories\./);

  const board = renderToStaticMarkup(createElement(StoryMapBoard, { map: filterStoryMapView(getStoryMapForViewer(current, engineer, { history }), {}, { now }), ...props }));
  const card = cardsIn(board).find(card => card.includes("BUILDER-101"));
  assert.match(card, /<time class="esm-changed" dateTime="2026-11-12T15:30:00\.000Z" title="12 Nov 2026, 15:30">7 days ago<\/time>/i);
  assert.match(cardsIn(board).find(card => card.includes("BUILDER-104")), />yesterday<\/time>/);
  // Cards shorten hours and minutes; the header and panel keep the full wording.
  const cardTimeAt = at => {
    const later = new Date(at);
    const rendered = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(current, engineer, { history }), ...props, now: later }));
    return cardsIn(rendered).find(card => card.includes("BUILDER-101")).match(/<time class="esm-changed"[^>]*>([^<]+)<\/time>/)[1];
  };
  assert.equal(cardTimeAt("2026-11-12T20:45:00Z"), "5h ago");
  assert.equal(cardTimeAt("2026-11-12T16:30:00Z"), "1h ago");
  assert.equal(cardTimeAt("2026-11-12T15:42:00Z"), "12 mins ago");
  assert.equal(cardTimeAt("2026-11-12T15:31:00Z"), "1 min ago");
  assert.equal(cardTimeAt("2026-11-12T15:30:20Z"), "just now");
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

test("ESM-120: reads the pull request number from merge, squash and GitLab commit messages", async () => {
  const { pullRequestNumber } = await import("../dist/history-git.js");
  assert.equal(pullRequestNumber("Merge pull request #70 from duncan-m/feat/esm-706-json-export", "Export the map as JSON"), 70);
  assert.equal(pullRequestNumber("Export the map as JSON for agents (#68)"), 68);
  assert.equal(pullRequestNumber("  Mark the 0.7.0 stories as shipped (#67)  "), 67);
  assert.equal(pullRequestNumber("Merge branch 'feature' into 'main'", "Add totals\n\nSee merge request group/sub/project!12\n"), 12);
  // A direct commit, a number in the middle of the subject and a zero are not pull requests.
  assert.equal(pullRequestNumber("Fix the typo"), undefined);
  assert.equal(pullRequestNumber("Revert (#12) and retry"), undefined);
  assert.equal(pullRequestNumber("Merge pull request #0 from a/b"), undefined);
  assert.equal(pullRequestNumber("Tidy up (#0)"), undefined);
  assert.equal(pullRequestNumber("Merge branch 'feature'", "It mentions See merge request a/b!3 in passing"), undefined);
  assert.equal(pullRequestNumber(`Huge (#${"9".repeat(30)})`), undefined);
});

test("ESM-120: history records the pull request behind each change", async t => {
  const { root, git, build } = await historyRepo(t);
  const writeMap = edit => writeFile(join(root, "product/story-map.yaml"), stringify(edit(parseStoryMap(git(["show", "HEAD:product/story-map.yaml"])))));
  const story = (document, id) => document.stories.find(story => story.id === id);
  const branchEdit = async (branch, edit, author, date) => {
    git(["checkout", "-q", "-b", branch]);
    await writeMap(document => (edit(document), document));
    git(["commit", "-q", "-am", `Edit on ${branch}`], { author, date });
    git(["checkout", "-q", "main"]);
  };

  // A GitHub merge commit.
  await branchEdit("feat/checks", document => { story(document, "BUILDER-103").status = "in-progress"; }, "Sam", "2026-11-19T09:00:00Z");
  git(["merge", "-q", "--no-ff", "-m", "Merge pull request #70 from acme/feat/checks\n\nStart the checks", "feat/checks"], { author: "Carol", date: "2026-11-19T10:00:00Z" });
  // A GitLab merge commit.
  await branchEdit("approvals", document => { story(document, "FINANCE-201").status = "in-progress"; }, "Sam", "2026-11-19T11:00:00Z");
  git(["merge", "-q", "--no-ff", "-m", "Merge branch 'approvals' into 'main'\n\nStart approvals\n\nSee merge request acme/product!12", "approvals"], { author: "Carol", date: "2026-11-19T12:00:00Z" });
  // A direct commit that mentions a number mid-subject.
  await writeMap(document => (story(document, "BUILDER-103").notes = "Check totals.", document));
  git(["commit", "-q", "-am", "Note (#99) for checks"], { author: "Dan", date: "2026-11-19T13:00:00Z" });

  const history = await build();
  const pulls = Object.fromEntries(history.events.filter(event => event.at >= "2026-11-12").map(event => [`${event.storyId} ${event.to}`, event.pullRequest]));
  assert.deepEqual(pulls, {
    "BUILDER-101 shipped": undefined,
    "BUILDER-102 in-progress": undefined,
    "BUILDER-104 planned": 7,
    "BUILDER-103 in-progress": 70,
    "FINANCE-201 in-progress": 12,
  });
  const edits = Object.fromEntries(history.lastEdits.map(edit => [edit.storyId, edit.pullRequest]));
  assert.equal(edits["BUILDER-103"], undefined, "the direct commit is the last edit");
  assert.equal(edits["FINANCE-201"], 12);
  assert.equal(edits["BUILDER-104"], 7);
  assert.equal(Object.hasOwn(history.lastEdits.find(edit => edit.storyId === "BUILDER-103"), "pullRequest"), false);

  // History files written before 0.7.4 have no pull requests, and still load. Bad numbers do not.
  const old = { version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true, events: [{ storyId: "X-1", type: "added", to: "planned", at: "2026-11-01T10:00:00.000Z", commit: "abcdef1" }] };
  assert.deepEqual(parseStoryMapHistory(old), old);
  for (const pullRequest of [0, -1, 1.5, "7"]) {
    assert.throws(() => parseStoryMapHistory({ ...old, events: [{ ...old.events[0], pullRequest }] }), /Invalid story map history/);
  }
});

test("ESM-120: history lines link to their pull request and commit when the board has a repository URL", () => {
  const commit = "8078905d3909bf3924bcc2403b8de972b2cef522";
  const direct = "c0ffee1d3909bf3924bcc2403b8de972b2cef522";
  const history = {
    version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true,
    events: [
      { storyId: "BUILDER-101", type: "added", to: "in-progress", at: "2026-11-01T10:00:00.000Z", by: "Alice", commit: direct },
      { storyId: "BUILDER-101", type: "status", from: "in-progress", to: "shipped", at: "2026-11-12T15:30:00.000Z", by: "Sam Patel", mergedBy: "Duncan Malcolm", commit, pullRequest: 70 },
    ],
    lastEdits: [
      { storyId: "BUILDER-101", at: "2026-11-12T15:30:00.000Z", by: "Sam Patel", commit, pullRequest: 70 },
      { storyId: "BUILDER-102", at: "2026-11-01T10:00:00.000Z", by: "Alice", commit: direct },
    ],
  };
  const now = new Date("2026-11-20T12:00:00Z");
  const view = getStoryMapForViewer(map, engineer, { history });
  const render = props => renderToStaticMarkup(createElement(StoryMapBoard, { map: view, now, timeZone: "UTC", ...props }));

  const github = render({ repositoryUrl: "https://github.com/acme/product/" });
  const shipped = panelFor(github, "Draft an estimate against a project");
  assert.match(shipped, /15:30<\/time> · by Sam Patel, merged by Duncan Malcolm · <a class="esm-history-link" href="https:\/\/github\.com\/acme\/product\/pull\/70" target="_blank" rel="noopener noreferrer"><span class="esm-visually-hidden">Pull request <\/span>#70/);
  assert.match(shipped, new RegExp(`href="https://github\\.com/acme/product/commit/${commit}" title="${commit}"[^>]*><span class="esm-visually-hidden">Commit </span><code class="esm-commit-hash">8078905</code>`));
  // A direct commit has no pull request, so only its commit is linked.
  assert.match(shipped, new RegExp(`by Alice · <a class="esm-history-link" href="https://github\\.com/acme/product/commit/${direct}"`));
  // The last update links to the pull request, or to the commit when there is none.
  assert.match(shipped, /Last updated <a class="esm-history-link" href="https:\/\/github\.com\/acme\/product\/pull\/70"[^>]*><time [^>]*>7 days ago<\/time><span class="esm-visually-hidden">, Pull request 70<\/span>/);
  assert.match(panelFor(github, "Look up prices in the material catalogue"), new RegExp(`Last updated <a class="esm-history-link" href="https://github\\.com/acme/product/commit/${direct}"[^>]*><time [^>]*>[^<]+</time><span class="esm-visually-hidden">, Commit c0ffee1</span>`));

  const gitlab = render({
    repositoryUrl: "https://github.com/ignored/repo",
    repositoryLinks: { commit: "https://gitlab.example/g/p/-/commit/{commit}", pullRequest: "https://gitlab.example/g/p/-/merge_requests/{number}" },
  });
  assert.match(gitlab, /href="https:\/\/gitlab\.example\/g\/p\/-\/merge_requests\/70"/);
  assert.match(gitlab, new RegExp(`href="https://gitlab\\.example/g/p/-/commit/${commit}"`));
  assert.doesNotMatch(gitlab, /github\.com\/ignored/);

  // Unsafe templates and URLs make no link, and without a repository URL nothing new is shown.
  const unsafe = render({ repositoryUrl: "javascript:alert(1)", repositoryLinks: { pullRequest: "javascript:alert({number})" } });
  const plain = render({});
  for (const html of [unsafe, plain]) {
    assert.doesNotMatch(html, /esm-history-link|esm-commit-hash|#70|8078905/);
    assert.match(panelFor(html, "Draft an estimate against a project"), /15:30<\/time> · by Sam Patel, merged by Duncan Malcolm<\/span>/);
  }

  // Customer boards never show hashes or numbers.
  const customer = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, regular, { history }), repositoryUrl: "https://github.com/acme/product" }));
  assert.doesNotMatch(customer, /esm-history-link|esm-commit-hash|8078905|c0ffee1|\/pull\/70/);
});

/** The history repository, plus merged pull requests, squash merges and direct commits that name stories. */
async function changesRepo(t) {
  const repo = await historyRepo(t);
  const { git } = repo;
  const empty = (message, author, date, committer) => git(["commit", "-q", "--allow-empty", "-m", message], { author, committer, date });
  const merge = (branch, message, commits, date, merger = "Carol") => {
    git(["checkout", "-q", "-b", branch]);
    for (const [index, [subject, author]] of commits.entries()) empty(subject, author, `${date.slice(0, 11)}0${index}:00:00Z`);
    git(["checkout", "-q", "main"]);
    git(["merge", "-q", "--no-ff", "-m", message, branch], { author: merger, date });
  };

  // The ID is only in the branch name, in lower case.
  merge("feat/builder-101-drafts", "Merge pull request #70 from acme/feat/builder-101-drafts\n\nKeep drafts", [["Save drafts", "Sam"], ["Tidy", "Sam"]], "2026-11-19T09:00:00Z");
  // The ID is only on a commit on the branch, and a second story is in the merge body. A bot wrote it.
  merge("work", "Merge pull request #71 from acme/work\n\nApprovals and prices\n\nAlso FINANCE-201.", [["Start BUILDER-102", "claude[bot]"]], "2026-11-19T10:00:00Z", "Grace");
  // A squash merge with the ID in its subject.
  empty("BUILDER-104: Check the total (#72)", "Erin", "2026-11-19T11:00:00Z", "GitHub");
  // A direct commit with the ID in its body.
  git(["commit", "-q", "--allow-empty", "-m", "Fix rounding", "-m", "Refs FINANCE-202"], { author: "Dan", date: "2026-11-19T12:00:00Z" });
  // Not story IDs: lower case in a message, part of a longer word, and an ID that is not in the map.
  empty("builder-103 in lower case, XBUILDER-103, BUILDER-103x and BUILDER-999", "Dan", "2026-11-19T13:00:00Z");
  return repo;
}

test("ESM-121: history finds the pull requests and commits that name a story", async t => {
  const { build } = await changesRepo(t);
  const history = await build();
  const summary = history.changes.map(({ storyIds, pullRequest, title, branch, by, mergedBy, commitCount }) => ({ storyIds, pullRequest, title, branch, by, mergedBy, commitCount }));
  const clean = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(clean(summary), clean([
    { storyIds: ["FINANCE-202"], title: "Fix rounding", by: "Dan", mergedBy: "Dan" },
    { storyIds: ["BUILDER-104"], pullRequest: 72, title: "BUILDER-104: Check the total", by: "Erin" },
    { storyIds: ["BUILDER-102", "FINANCE-201"], pullRequest: 71, title: "Approvals and prices", branch: "work", by: "Grace", mergedBy: "Grace", commitCount: 1 },
    { storyIds: ["BUILDER-101"], pullRequest: 70, title: "Keep drafts", branch: "feat/builder-101-drafts", by: "Sam", mergedBy: "Carol", commitCount: 2 },
  ]));
  assert.ok(history.changes.every(change => /^[0-9a-f]{40}$/.test(change.commit)));
  assert.equal(history.changes[3].at, "2026-11-19T09:00:00.000Z");
  assert.equal(history.moreChanges, undefined);
});

test("ESM-121: history lists at most 30 changes per story and counts the rest", async t => {
  const { git, build } = await historyRepo(t);
  for (let index = 0; index < 32; index++) {
    git(["commit", "-q", "--allow-empty", "-m", `BUILDER-103 step ${index}`], { author: "Dan", date: `2026-11-19T10:${String(index).padStart(2, "0")}:00Z` });
  }
  git(["commit", "-q", "--allow-empty", "-m", "BUILDER-103 and BUILDER-102 together"], { author: "Dan", date: "2026-11-19T11:00:00Z" });
  const history = await build();
  const forChecks = history.changes.filter(change => change.storyIds.includes("BUILDER-103"));
  assert.equal(forChecks.length, 30);
  assert.equal(forChecks[0].title, "BUILDER-103 and BUILDER-102 together", "newest first");
  assert.equal(forChecks.at(-1).title, "BUILDER-103 step 3");
  assert.deepEqual(history.moreChanges, [{ storyId: "BUILDER-103", count: 3 }]);

  // Over the limit, a change keeps only the stories it still counts for.
  const { historyChangesPerStory } = await import("../dist/history.js");
  assert.equal(historyChangesPerStory, 30);
  const valid = { version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true, events: [] };
  const change = { storyIds: ["X-1"], commit: "abcdef1", at: "2026-11-01T10:00:00.000Z" };
  assert.deepEqual(parseStoryMapHistory({ ...valid, changes: [change] }).changes, [change]);
  assert.throws(() => parseStoryMapHistory({ ...valid, changes: [{ ...change, storyIds: [] }] }), /Invalid story map history/);
  assert.throws(() => parseStoryMapHistory({ ...valid, changes: [{ ...change, title: "t".repeat(201) }] }), /at most 200 characters/);
});

test("ESM-121: the story panel lists the changes that name it, for internal viewers only", async t => {
  const { root, build } = await changesRepo(t);
  const history = await build();
  const current = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  const now = new Date("2026-11-20T12:00:00Z");
  const view = getStoryMapForViewer(current, engineer, { history });
  assert.equal(view.changesIndexed, true);
  const render = props => renderToStaticMarkup(createElement(StoryMapBoard, { map: view, now, timeZone: "UTC", ...props }));

  const linked = render({ repositoryUrl: "https://github.com/acme/product" });
  const approvals = panelFor(linked, "Look up prices in the material catalogue");
  assert.match(approvals, /<h4 id="[^"]+-changes">Changes<\/h4>/);
  assert.match(approvals, /<li class="esm-change" data-kind="pull-request">[\s\S]*?href="https:\/\/github\.com\/acme\/product\/pull\/71"[^>]*><span class="esm-visually-hidden">Pull request <\/span><span class="esm-change-number">#71<\/span> <span class="esm-change-title">Approvals and prices<\/span>/);
  assert.match(approvals, /<span class="esm-change-meta">merged <time dateTime="2026-11-19T10:00:00\.000Z">19 Nov 2026, 10:00<\/time> by Grace · 1 commit<\/span>/);
  // Changes sit between History and Tests.
  assert.ok(approvals.indexOf(">History<") < approvals.indexOf(">Changes<"));
  const rounding = panelFor(linked, "Explore duplicate approval handling");
  assert.match(rounding, /data-kind="commit"[\s\S]*?href="https:\/\/github\.com\/acme\/product\/commit\/[0-9a-f]{40}"[^>]*><span class="esm-visually-hidden">Commit <\/span><code class="esm-commit-hash">[0-9a-f]{7}<\/code> <span class="esm-change-title">Fix rounding<\/span>/);
  assert.match(rounding, /19 Nov 2026, 12:00<\/time> · by Dan<\/span>/);

  // A story none name gets the empty state, and without a repository URL titles are plain text.
  const plain = render({});
  assert.match(panelFor(plain, "Submit the estimate to finance"), /No pull requests or commits name BUILDER-103 yet\. Put the ID in a branch name, pull request title or commit message, such as <code>feat\/builder-103-…<\/code>/);
  assert.doesNotMatch(panelFor(plain, "Look up prices in the material catalogue"), /<a [^>]*esm-change-link/);
  assert.match(panelFor(plain, "Look up prices in the material catalogue"), /<span class="esm-change-number">#71<\/span> <span class="esm-change-title">Approvals and prices<\/span>/);

  // Older history files have no changes, so the section is left out.
  const { changes, ...older } = history;
  const olderView = getStoryMapForViewer(current, engineer, { history: older });
  assert.equal(olderView.changesIndexed, undefined);
  assert.doesNotMatch(renderToStaticMarkup(createElement(StoryMapBoard, { map: olderView })), />Changes<|esm-changes/);

  // Customers never see titles, branch names or hashes, in HTML or JSON.
  const leaks = new RegExp(["Approvals and prices", "Keep drafts", "Fix rounding", "builder-101-drafts", "esm-change", history.changes[0].commit.slice(0, 7)].join("|"));
  const customerHtml = await makeStoryMapResponse("/story-map", current, regular, { history, now }).text();
  const customerJson = await makeStoryMapResponse("/api/story-map", current, regular, { history, now }).text();
  assert.doesNotMatch(customerHtml, leaks);
  assert.doesNotMatch(customerJson, leaks);
  assert.doesNotMatch(renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(current, regular, { history }), repositoryUrl: "https://github.com/acme/product" })), leaks);
});

test("ESM-121: more changes link to a pull request search on GitHub, and the JSON export carries changes", () => {
  const change = { storyIds: ["BUILDER-101"], pullRequest: 70, title: "Keep drafts", commit: "8078905d3909bf3924bcc2403b8de972b2cef522", at: "2026-11-19T09:00:00.000Z" };
  const history = { version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true, events: [], changes: [change], moreChanges: [{ storyId: "BUILDER-101", count: 4 }] };
  const view = getStoryMapForViewer(map, engineer, { history });
  const story = view.stories.find(story => story.id === "BUILDER-101");
  assert.deepEqual(story.changes, [{ pullRequest: 70, title: "Keep drafts", commit: change.commit, at: change.at }]);
  assert.equal(story.moreChanges, 4);

  const panel = html => panelFor(html, "Draft an estimate against a project");
  assert.match(panel(renderToStaticMarkup(createElement(StoryMapBoard, { map: view, repositoryUrl: "https://github.com/acme/product" }))),
    /<p class="esm-changes-more"><a href="https:\/\/github\.com\/acme\/product\/pulls\?q=is%3Apr%20BUILDER-101"[^>]*>\+4 more/);
  assert.match(panel(renderToStaticMarkup(createElement(StoryMapBoard, { map: view, repositoryUrl: "https://gitlab.example/g/p" }))), /<p class="esm-changes-more">\+4 more<\/p>/);

  const exported = JSON.parse(storyMapToJson(view));
  assert.deepEqual(exported.stories.find(story => story.id === "BUILDER-101").changes, story.changes);
  assert.ok(exported.provenance.notes.some(note => /Open pull requests and work merged without the ID are missing/.test(note)));
  assert.ok(!JSON.parse(storyMapToJson(getStoryMapForViewer(map, engineer))).provenance.notes.some(note => /Open pull requests/.test(note)));
});

test("ESM-122: a story permalink keeps the story on the board whatever the filters say", () => {
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("story=FINANCE-202&release=finance-follow-up")), { query: undefined, status: undefined, story: "FINANCE-202", release: "finance-follow-up" });
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("story=<script>&release=../x")), { query: undefined, status: undefined });

  const page = (viewer, query) => getStoryMapPage(map, viewer, { searchParams: new URLSearchParams(query) });
  // FINANCE-202 is cut, so the default status filter hides it, and the search does not match it.
  const linked = page(engineer, "story=FINANCE-202&q=prices");
  assert.deepEqual(linked.stories.map(story => story.id), ["BUILDER-102", "FINANCE-202"]);
  assert.equal(linked.filter.story, "FINANCE-202");
  assert.equal(linked.filter.hidden, undefined, "the linked story is not counted as hidden");
  assert.equal(page(engineer, "release=finance-follow-up").filter.release, "finance-follow-up");

  // An unknown ID, a badly formed one and an internal-only story on a customer board are all ignored the same way.
  const plainCustomer = page(regular, "");
  for (const query of ["story=NOPE-1", "story=<b>", "story=BUILDER-101", "story=FINANCE-202", "release=builder-mvp"]) {
    assert.deepEqual(page(regular, query), plainCustomer, query);
  }
  assert.deepEqual(page(engineer, "story=NOPE-1&release=nope"), page(engineer, ""));
  // Customers link by their public IDs.
  assert.equal(page(regular, "story=story-2").filter.story, "story-2");
  assert.equal(page(regular, "release=release-2").filter.release, "release-2");
});

test("ESM-122: story and release panels offer a permalink, and the board names the panel to open", () => {
  const render = (viewer, query, props = {}) => renderToStaticMarkup(createElement(StoryMapBoard, {
    map: getStoryMapPage(map, viewer, { searchParams: new URLSearchParams(query) }), preservedParams: { as: "engineer" }, ...props,
  }));

  const html = render(engineer, "q=estimate&status=planned&status=cut&story=BUILDER-103");
  // Cards and lanes have stable IDs for the fragment to scroll to.
  assert.match(html, /<button type="button" class="esm-card" id="esm-story-BUILDER-103"/);
  assert.match(html, /<div class="esm-row esm-lane" role="row" id="esm-release-builder-mvp"/);
  assert.equal(render(engineer, "q=estimate&story=BUILDER-103").match(/id="esm-story-BUILDER-103"/g).length, 1);
  // The link keeps the host's parameters and drops the viewer's filters.
  const panel = panelFor(html, "Submit the estimate to finance");
  assert.match(panel, /<div class="esm-detail-actions"><a class="esm-copy-link" href="\?as=engineer&amp;story=BUILDER-103#esm-story-BUILDER-103" data-esm-copy-link="" title="Link to this story"><svg[^>]*>[\s\S]*?<\/svg><span data-esm-copy-label="">Copy link<\/span><span class="esm-visually-hidden"> to this story<\/span><\/a><button type="button" class="esm-close"/);
  const panelId = /<div class="esm-detail" id="([^"]+)"[^>]*>(?:(?!<div class="esm-detail").)*Submit the estimate to finance/s.exec(html)[1];
  assert.match(html, new RegExp(`<section class="esm-board" data-theme="light" data-esm-open="${panelId}"`));
  assert.match(html, /<p class="esm-visually-hidden" role="status" data-esm-copy-status=""><\/p>/);

  // A release permalink opens the release panel, which has its own link.
  const release = render(engineer, "release=finance-follow-up");
  const opened = /data-esm-open="([^"]+)"/.exec(release)[1];
  assert.match(release, new RegExp(`<div class="esm-detail esm-release-detail" id="${opened}"[^>]*><div class="esm-detail-head"><div><p class="esm-card-id">Release</p><h3 [^>]*>Finance follow-up`));
  assert.match(release, /href="\?as=engineer&amp;release=finance-follow-up#esm-release-finance-follow-up"/);

  // permalinkBase makes absolute links; an unsafe one makes none. No permalink opens nothing.
  assert.match(render(engineer, "", { permalinkBase: "https://example.test/app/story-map?tab=1" }), /href="https:\/\/example\.test\/app\/story-map\?tab=1&amp;as=engineer&amp;story=BUILDER-101#esm-story-BUILDER-101"/);
  assert.match(render(engineer, "", { permalinkBase: "/app/story-map" }), /href="\/app\/story-map\?as=engineer&amp;story=BUILDER-101#esm-story-BUILDER-101"/);
  const unsafe = render(engineer, "", { permalinkBase: "javascript:alert(1)" });
  assert.doesNotMatch(unsafe, /esm-copy-link|javascript:/);
  assert.doesNotMatch(render(engineer, ""), /data-esm-open/);

  // Customers link to their own stories by public ID, and have no release panels to open.
  const customer = render(regular, "story=story-2", { preservedParams: undefined });
  assert.match(customer, /id="esm-story-story-2"/);
  assert.match(customer, /href="\?story=story-2#esm-story-story-2"/);
  assert.match(customer, /data-esm-open="[^"]+"/);
  assert.doesNotMatch(customer, /BUILDER-|builder-mvp/);
  assert.doesNotMatch(render(regular, "release=release-1"), /data-esm-open/);
});

test("ESM-122: storyMapPermalink builds links from a base and the host's parameters", () => {
  assert.equal(storyMapPermalink({ story: "ESM-801" }), "?story=ESM-801#esm-story-ESM-801");
  assert.equal(storyMapPermalink({ release: "v0-7-4" }, { preservedParams: { view: "internal" } }), "?view=internal&release=v0-7-4#esm-release-v0-7-4");
  assert.equal(storyMapPermalink({ story: "ESM-801" }, { base: "https://example.test/map?story=OLD#top" }), "https://example.test/map?story=ESM-801#esm-story-ESM-801");
  assert.equal(storyMapPermalink({ story: "ESM-801" }, { base: "javascript:alert(1)" }), undefined);
  assert.equal(storyMapAnchorId({ release: "v0-7-4" }), "esm-release-v0-7-4");

  const exported = JSON.parse(storyMapToJson(getStoryMapForViewer(map, engineer), { permalinkBase: "https://example.test/story-map" }));
  assert.equal(exported.stories.find(story => story.id === "BUILDER-101").permalink, "https://example.test/story-map?story=BUILDER-101#esm-story-BUILDER-101");
  assert.equal(exported.releases.find(release => release.id === "builder-mvp").permalink, "https://example.test/story-map?release=builder-mvp#esm-release-builder-mvp");
  assert.ok(JSON.parse(storyMapToJson(getStoryMapForViewer(map, engineer))).stories.every(story => !("permalink" in story)));
});

test("ESM-122: board.js opens the permalinked panel, expands its lane and copies links", async t => {
  const written = [];
  let shown = 0;
  const panel = { matches: () => false, showPopover: () => { shown++; } };
  const collapse = { checked: true };
  const opener = { closest: selector => selector === ".esm-lane" ? { querySelector: () => collapse } : null };
  const status = { textContent: "" };
  const label = { textContent: "Copy link", dataset: {} };
  const link = { dataset: {}, getAttribute: () => "?story=BUILDER-103#esm-story-BUILDER-103", querySelector: () => label, closest: () => null };
  class FakeElement { closest() { return link; } }
  let click;
  const board = {
    dataset: { esmOpen: "p-3" },
    contains: () => true,
    querySelector: selector => selector.startsWith("[popovertarget=") ? (selector.includes('"p-3"') ? opener : null) : selector === "[data-esm-copy-status]" ? status : null,
    addEventListener: (type, handler) => { click = handler; },
  };
  const globals = {
    Element: FakeElement,
    CSS: { escape: value => value },
    location: { href: "https://example.test/story-map?as=engineer" },
    navigator: { clipboard: { writeText: async text => { written.push(text); } } },
    document: { readyState: "complete", querySelectorAll: () => [], getElementById: id => id === "p-3" ? panel : null },
  };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const { enhanceStoryMapPermalinks } = await import("auto-story-map/board.js");
  enhanceStoryMapPermalinks({ querySelectorAll: () => [board] });
  enhanceStoryMapPermalinks({ querySelectorAll: () => [board] });
  assert.equal(shown, 1, "opens the panel once");
  assert.equal(collapse.checked, false, "expands the collapsed lane");

  let prevented = false;
  click({ target: new FakeElement(), button: 0, preventDefault: () => { prevented = true; } });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(prevented, true);
  assert.deepEqual(written, ["https://example.test/story-map?story=BUILDER-103#esm-story-BUILDER-103"]);
  assert.equal(label.textContent, "Link copied");
  assert.equal(status.textContent, "Link copied");
  assert.ok("copied" in link.dataset);

  // A modified click opens the link as usual.
  prevented = false;
  click({ target: new FakeElement(), button: 0, metaKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
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

  assert.deepEqual(readStoryMapFilters(new URLSearchParams("status=cut")).status, ["cut"]);
  // Choosing exactly the default statuses is the default, so blocked and cut are still counted as hidden.
  assert.equal(filterStoryMapView(internal, { status: ["shipped", "planned", "merged", "in-progress"] }).filter.status, undefined);
  assert.deepEqual(ids({ status: ["planned", "cut"] }), internal.stories.filter(story => story.status === "planned" || story.status === "cut").map(story => story.id));
  assert.ok(ids({ status: ["planned", "cut"] }).includes("FINANCE-202"));

  const html = await makeStoryMapResponse("/story-map?q=e", inactive, engineer, { preservedParams: { as: "engineer" } }).text();
  // Active statuses are chosen by default, and there is no “All” choice.
  assert.equal(statusSummaryIn(html), "Active");
  assert.deepEqual(statusChoicesIn(html), ["planned:1", "in-progress:1", "merged:1", "shipped:1", "blocked:0", "cut:0"]);
  assert.doesNotMatch(html, /value="all"/);
  assert.match(html, /Showing 3 of 5 stories\. <a href="\?as=engineer">Clear filters<\/a>/);
  assert.doesNotMatch(html, /hidden\.|Show them/, "hidden blocked and cut stories go unmentioned");
  assert.doesNotMatch(html, /Explore duplicate approval handling/);

  // With no other filters, every release still shows and the message has no “Clear filters” link.
  const plain = await makeStoryMapResponse("/story-map", inactive, engineer).text();
  assert.doesNotMatch(plain, /esm-filter-results/, "no summary when nothing but the default status filter applies");
  assert.match(plain, /Reconciliation discovery/);
  assert.match(plain, /Finance follow-up<\/button><\/span>[\s\S]*?0 stories/);

  const all = await makeStoryMapResponse("/story-map?status=all", inactive, engineer).text();
  assert.equal(cardsIn(all).length, 5);
  assert.equal(statusSummaryIn(all), "All statuses");
  assert.deepEqual(statusChoicesIn(all), ["planned:1", "in-progress:1", "merged:1", "shipped:1", "blocked:1", "cut:1"]);
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
  assert.equal(statusSummaryIn(page), "All statuses");
  assert.deepEqual(statusChoicesIn(page), ["planned:1", "in-progress:1", "shipped:1"]);
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
  const { root, git, build } = await historyRepo(t);
  await writeFile(join(root, "product/story-map.yaml"), stringify(withInactiveStories()));
  git(["commit", "-q", "-am", "Cut duplicate handling"], { author: "Fay", committer: "Fay", date: "2026-11-19T09:00:00Z" });
  const history = await build();
  const finance = history.events.filter(event => event.storyId.startsWith("FINANCE") && event.to !== "planned");
  assert.deepEqual(finance.map(({ storyId, type, to, reason }) => [storyId, type, to, reason]), [
    // The demo map adds FINANCE-202 as already cut.
    ["FINANCE-202", "added", "cut", "Finance will handle duplicate approvals manually until volumes justify it."],
    ["FINANCE-201", "status", "blocked", "Waiting on the finance system’s purchase order API."],
  ]);

  const current = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8"));
  const board = renderToStaticMarkup(createElement(StoryMapBoard, {
    map: filterStoryMapView(getStoryMapForViewer(current, engineer, { history }), { status: "all" }),
    timeZone: "UTC",
  }));
  assert.match(panelFor(board, "Explore duplicate approval handling"), /<span class="esm-history-reason">Finance will handle duplicate approvals manually until volumes justify it\.<\/span>/);
});

test("boards rendered without filters hide blocked and cut stories behind a checkbox", () => {
  const board = view => renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
  const html = board(getStoryMapForViewer(map, engineer));
  assert.match(html, /<section class="esm-board" data-theme="light" data-hide-inactive=""/);
  assert.match(html, /<p class="esm-inactive-toggle"><input type="checkbox" class="esm-inactive-input" id="([^"]+)"\/><label for="\1">Show blocked and cut stories \(1 cut\)<\/label><\/p>/);
  // The cut card is rendered for CSS to hide, and its cell and lane count know it.
  const cut = cardsIn(html).find(card => card.includes("FINANCE-202"));
  assert.match(cut, /data-inactive=""/);
  assert.equal(cardsIn(html).filter(card => card.includes("data-inactive")).length, 1);
  assert.match(html, /<div class="esm-cell" role="cell" data-inactive-only="">/);
  assert.match(html, /Reconciliation discovery<\/button><\/span><span class="esm-release-count esm-count-active">0 stories<\/span><span class="esm-release-count esm-count-all">1 story<\/span>/);

  // Filtered boards use the toolbar instead, and maps with nothing to hide get no checkbox.
  assert.doesNotMatch(board(filterStoryMapView(getStoryMapForViewer(map, engineer))), /esm-inactive-toggle|data-hide-inactive/);
  assert.doesNotMatch(board(getStoryMapForViewer(planningMap, engineer)), /esm-inactive-toggle|data-hide-inactive|data-inactive/);
  assert.doesNotMatch(board(getStoryMapForViewer(map, regular)), /esm-inactive-toggle|data-inactive/);
});

// Release notes and expected impact (0.4.0 item 2).

function releasePanel(html, title) {
  return panelFor(html, `<h3 id="${html.match(new RegExp(`id="([^"]+-release-\\d+)-title">${title}<`))[1]}-title">`);
}

test("release notes and impact are validated", () => {
  const withRelease = edit => stringify(editedSample(document => edit(document.releases[0])));
  assert.equal(parseStoryMap(withRelease(release => { release.notes = "x".repeat(800); })).releases[0].notes.length, 800);
  assert.throws(() => parseStoryMap(withRelease(release => { release.notes = "x".repeat(801); })), /releases\.0\.notes/);
  assert.throws(() => parseStoryMap(withRelease(release => {
    release.impact = Array.from({ length: 11 }, (_, index) => ({ metric: `Metric ${index}`, expected: "Up" }));
  })), /releases\.0\.impact/);
  assert.throws(() => parseStoryMap(withRelease(release => { release.impact = [{ metric: "Turnaround" }]; })), /releases\.0\.impact\.0\.expected[^\n]*Missing required field/);
  assert.throws(() => parseStoryMap(withRelease(release => { release.impact = [{ metric: "Turnaround", expected: "Down", target: 1 }]; })), /releases\.0\.impact\.0\.target[^\n]*Unknown field/);
  assert.throws(() => parseStoryMap(withRelease(release => { release.impact = [{ metric: "Turnaround", expected: "Down", draft: "yes" }]; })), /draft/);
  // Activities do not take release fields.
  assert.throws(() => parseStoryMap(stringify(editedSample(document => { document.activities[0].notes = "No"; }))), /activities\.0\.notes[^\n]*Unknown field/);
});

test("warnings ask for release impact and for drafts to be confirmed once stories ship", async () => {
  const { loadStoryMap } = await import("../dist/schema.js");
  const source = stringify(editedSample(document => {
    delete document.releases[1].impact;
    // FINANCE-202 is cut, so Reconciliation discovery has no active stories and no warning.
    document.stories.find(story => story.id === "FINANCE-201").status = "in-progress";
    document.stories.find(story => story.id === "BUILDER-101").status = "shipped";
  }));
  const warnings = loadStoryMap(source).warnings;
  assert.deepEqual(warnings.map(({ path, itemId, message }) => [path.join("."), itemId, message]), [
    ["releases.0.impact.1.draft", "builder-mvp", "Confirm the drafted impact for “Estimates returned for corrections” and remove draft: true. The release has shipped stories."],
    ["releases.1", "finance-follow-up", "Add impact: what the release is expected to change, and how it will be measured."],
  ]);
  assert.equal(warnings[0].line, source.split("\n").findIndex(line => line.includes("draft: true")) + 1);
  assert.ok(warnings.every(warning => warning.severity === "warning"));
  // Releases with no stories need no impact.
  assert.deepEqual(loadStoryMap(stringify(editedSample(document => { for (const release of document.releases) delete release.impact; document.stories = []; }))).warnings, []);
});

test("internal boards show release impact in the lane and a release panel", async () => {
  const html = await makeStoryMapResponse("/story-map", map, engineer).text();
  assert.match(html, /<button type="button" class="esm-release-button" aria-haspopup="dialog" popoverTarget="([^"]+-release-0)">Builder workflow<\/button>/);
  assert.match(html, /<span class="esm-release-impact"><span class="esm-impact-text">Estimate turnaround time: Decrease from 3 days to 1 day<\/span><span class="esm-impact-more">\+1 more<\/span><\/span>/);
  assert.match(html, /<span class="esm-impact-text">Time from approval to purchase order: Same day for approved estimates<\/span><span class="esm-draft"[^>]*>Draft<\/span><\/span>/);

  const builder = releasePanel(html, "Builder workflow");
  assert.match(builder, /^<div class="esm-detail esm-release-detail" id="[^"]+-release-0" popover="auto" role="dialog"/);
  assert.match(builder, /<h4[^>]*>Release notes<\/h4><p class="esm-notes">Builders can price and submit estimates without emailing finance\.<\/p><p class="esm-notes">Catalogue prices are locked/);
  assert.match(builder, /<p class="esm-impact-metric">Estimates returned for corrections<span class="esm-draft"[^>]*>Draft<\/span><\/p><dl class="esm-detail-context"><dt>Expected<\/dt><dd>Decrease by 50%<\/dd><dt>Solves<\/dt><dd>Wrong unit prices typed by hand<\/dd><\/dl>/);
  assert.match(builder, /<p class="esm-release-progress">0 of 3 stories shipped\.<\/p>/);
  // Stories are grouped by status and open their own panels.
  assert.match(builder, /<h5><span class="esm-status" data-status="planned">[\s\S]*?BUILDER-102[\s\S]*?BUILDER-103/);
  const target = builder.match(/class="esm-release-story" aria-haspopup="dialog" popoverTarget="([^"]+)"><span class="esm-card-id">BUILDER-101</)[1];
  assert.match(html, new RegExp(`<div class="esm-detail" id="${target}"[^>]*><div class="esm-detail-head"><div><p class="esm-card-id">BUILDER-101<`));

  // The cut story is hidden by the default filter, and the panel says so.
  const reconciliation = releasePanel(html, "Reconciliation discovery");
  assert.match(reconciliation, /<p class="esm-release-progress">1 story, all cut\.<\/p>/);
  assert.match(reconciliation, /1 more hidden by the current filters\./);
  assert.doesNotMatch(reconciliation, /Release notes|Expected impact/);

  const shipped = editedSample(document => {
    document.stories[0].status = "shipped";
    document.stories[2].status = "cut";
    document.stories[2].statusReason = "Not needed.";
    document.releases[0].impact[0].actual = "Down to 1.5 days";
  });
  const all = await makeStoryMapResponse("/story-map?status=all", shipped, engineer).text();
  const panel = releasePanel(all, "Builder workflow");
  assert.match(panel, /<p class="esm-release-progress">1 of 2 stories shipped, 1 cut\.<\/p>/);
  assert.match(panel, /<dt>Expected<\/dt><dd>Decrease from 3 days to 1 day<\/dd><dt>Actual<\/dt><dd>Down to 1\.5 days<\/dd>/);
  assert.doesNotMatch(panel, /hidden by the current filters/);

  // Progress counts the whole release, whatever the filters show.
  const searched = await makeStoryMapResponse("/story-map?q=catalogue", map, engineer).text();
  const filtered = releasePanel(searched, "Builder workflow");
  assert.match(filtered, /0 of 3 stories shipped\./);
  assert.match(filtered, /2 more hidden by the current filters\./);
  assert.equal(getStoryMapForViewer(map, engineer).releases[0].storyCounts["in-progress"], 1);
});

test("customers never see release notes, impact or progress", async () => {
  for (const path of ["/story-map", "/story-map?status=all", "/api/story-map"]) {
    const payload = await (await makeStoryMapResponse(path, map, regular)).text();
    assert.doesNotMatch(payload, /esm-release-button|esm-release-impact|esm-release-detail|Estimate turnaround|without emailing finance|storyCounts|impact|notes/i);
  }
  const view = getStoryMapForViewer(map, regular);
  assert.deepEqual(Object.keys(view.releases[0]).sort(), ["id", "summary", "title"]);
});

test("diffs list release notes and impact changes and call out measured results", () => {
  const after = editedSample(document => {
    const [builder, finance] = document.releases;
    builder.notes = "Builders price estimates themselves.";
    builder.impact[0].actual = "Down to 1.5 days";
    delete builder.impact[1].draft;
    finance.impact[0].expected = "Within 4 hours";
    finance.impact.push({ metric: "Retyped purchase orders", expected: "None" });
    document.releases.push({ id: "later", title: "Later", impact: [{ metric: "NPS", expected: "Up 5 points" }] });
  });
  const diff = diffStoryMaps(map, after);
  assert.deepEqual(diff.releaseDetails.map(({ id, notes, impact }) => [id, notes, impact]), [
    ["builder-mvp", "changed", { added: [], changed: [], removed: [], confirmed: ["Estimates returned for corrections"], actualRecorded: [{ metric: "Estimate turnaround time", actual: "Down to 1.5 days" }] }],
    ["finance-follow-up", undefined, { added: ["Retyped purchase orders"], changed: ["Time from approval to purchase order"], removed: [], confirmed: [], actualRecorded: [] }],
    ["later", undefined, { added: ["NPS"], changed: [], removed: [], confirmed: [], actualRecorded: [] }],
  ]);
  assert.equal(hasStoryMapChanges(diffStoryMaps(map, editedSample(document => { document.releases[0].impact[0].actual = "1 day"; }))), true);

  const markdown = formatStoryMapDiff(diff);
  assert.ok(markdown.indexOf("### Release notes and impact") > 0);
  assert.match(markdown, /- `builder-mvp` Builder workflow: notes changed; confirmed drafted impact “Estimates returned for corrections”\n  - \*\*Actual recorded\*\* for “Estimate turnaround time”: Down to 1\.5 days/);
  assert.match(markdown, /- `finance-follow-up` Finance follow-up: added impact “Retyped purchase orders”; changed impact “Time from approval to purchase order”/);
  assert.doesNotMatch(markdown, /### Customer-facing changes/);
  assert.deepEqual(diffStoryMaps(map, map).releaseDetails, []);
});

// BUILDER-101 has been in progress since September. BUILDER-102 started in September, went back
// to planned and restarted on 1 November. BUILDER-103 is in progress in the map, but the history
// has not caught up, so its start date is unknown.
const stalledNow = new Date("2026-11-20T12:00:00Z");
const stalledHistory = parseStoryMapHistory({
  version: 1,
  generatedAt: "2026-11-20T08:00:00Z",
  complete: true,
  events: [
    { storyId: "BUILDER-101", type: "added", to: "in-progress", at: "2026-09-01T10:00:00Z", by: "Alex Morgan", commit: "a000001" },
    { storyId: "BUILDER-102", type: "added", to: "planned", at: "2026-09-01T10:00:00Z", commit: "a000001" },
    { storyId: "BUILDER-102", type: "status", from: "planned", to: "in-progress", at: "2026-09-10T10:00:00Z", commit: "a000002" },
    { storyId: "BUILDER-102", type: "status", from: "in-progress", to: "planned", at: "2026-10-01T10:00:00Z", commit: "a000003" },
    { storyId: "BUILDER-102", type: "status", from: "planned", to: "in-progress", at: "2026-11-01T10:00:00Z", commit: "a000004" },
    { storyId: "BUILDER-103", type: "added", to: "planned", at: "2026-09-01T10:00:00Z", commit: "a000001" },
  ],
});

function stalledMap(settings) {
  return editedSample(document => {
    for (const id of ["BUILDER-102", "BUILDER-103"]) document.stories.find(story => story.id === id).status = "in-progress";
    if (settings) document.settings = settings;
  });
}

function stalledIds(view) {
  return view.stories.filter(story => story.stalled).map(story => story.id);
}

test("the stalled threshold is read from the map, can be overridden and turned off", () => {
  const options = { history: stalledHistory, now: stalledNow };
  const view = getStoryMapForViewer(stalledMap(), engineer, options);
  assert.equal(view.stalledAfterWeeks, 4);
  assert.deepEqual(stalledIds(view), ["BUILDER-101"]);
  const since = Object.fromEntries(view.stories.map(story => [story.id, story.inProgressSince]));
  // Measured from the latest move to in progress. Without a matching history entry, there is no start date.
  assert.deepEqual(since, {
    "BUILDER-101": "2026-09-01T10:00:00Z",
    "BUILDER-102": "2026-11-01T10:00:00Z",
    "BUILDER-103": undefined,
    "FINANCE-201": undefined,
    "FINANCE-202": undefined,
  });

  const fromMap = getStoryMapForViewer(stalledMap({ stalledAfterWeeks: 12 }), engineer, options);
  assert.equal(fromMap.stalledAfterWeeks, 12);
  assert.deepEqual(stalledIds(fromMap), []);
  const overridden = getStoryMapForViewer(stalledMap({ stalledAfterWeeks: 12 }), engineer, { ...options, stalledAfterWeeks: 2 });
  assert.deepEqual(stalledIds(overridden), ["BUILDER-101", "BUILDER-102"]);

  const off = getStoryMapForViewer(stalledMap({ stalledAfterWeeks: 0 }), engineer, options);
  assert.equal(Object.hasOwn(off, "stalledAfterWeeks"), false);
  assert.deepEqual(stalledIds(off), []);
  assert.deepEqual(stalledIds(getStoryMapForViewer(stalledMap(), engineer, { ...options, stalledAfterWeeks: 0 })), []);

  const noHistory = getStoryMapForViewer(stalledMap(), engineer, { now: stalledNow });
  assert.equal(Object.hasOwn(noHistory, "stalledAfterWeeks"), false);
  assert.ok(noHistory.stories.every(story => !("stalled" in story) && !("inProgressSince" in story)));

  assert.equal(parseStoryMap(stringify({ ...map, settings: { stalledAfterWeeks: 6 } })).settings.stalledAfterWeeks, 6);
  for (const settings of [{ stalledAfterWeeks: -1 }, { stalledAfterWeeks: 1.5 }, { stalledAfterWeeks: 105 }, { stalledAfter: 4 }]) {
    assert.throws(() => parseStoryMap(stringify({ ...map, settings })), StoryMapValidationError, JSON.stringify(settings));
  }
});

test("the stalled filter keeps stalled stories and needs history", () => {
  assert.deepEqual(readStoryMapFilters(new URLSearchParams("status=stalled")).status, ["stalled"]);
  const view = getStoryMapForViewer(stalledMap({ stalledAfterWeeks: 2 }), engineer, { history: stalledHistory, now: stalledNow });
  const stalled = filterStoryMapView(view, { status: "stalled" });
  assert.deepEqual(stalled.stories.map(story => story.id), ["BUILDER-101", "BUILDER-102"]);
  assert.deepEqual(stalled.filter.status, ["stalled"]);
  // Stalled adds stalled stories to the other choices.
  assert.deepEqual(filterStoryMapView(view, { status: ["planned", "stalled"] }).stories.map(story => story.id), view.stories.filter(story => story.status === "planned" || story.stalled).map(story => story.id));
  assert.equal(stalled.filter.hidden, undefined);

  // Without history, and for customers, the stalled filter falls back to the default.
  const noHistory = filterStoryMapView(getStoryMapForViewer(stalledMap(), engineer), { status: "stalled" });
  assert.equal(noHistory.filter.status, undefined);
  assert.equal(noHistory.stories.length, 4);
  const customer = getStoryMapForViewer(stalledMap(), regular, { history: stalledHistory, now: stalledNow });
  assert.equal(filterStoryMapView(customer, { status: "stalled" }).stories.length, customer.stories.length);
});

test("the board flags stalled stories to internal viewers only", async () => {
  const current = stalledMap();
  const options = { history: stalledHistory, now: stalledNow };
  const html = await makeStoryMapResponse("/story-map", current, engineer, options).text();
  const card = cardsIn(html).find(card => card.includes("BUILDER-101"));
  assert.match(card, /<span class="esm-stalled" title="In progress since 1 Sept? 2026, \d\d:00"><svg[^>]*>[\s\S]*?<\/svg>In progress for 11 weeks<\/span>/);
  assert.doesNotMatch(card, /esm-changed/);
  assert.match(cardsIn(html).find(card => card.includes("BUILDER-102")), /<time class="esm-changed"[^>]*>19 days ago<\/time>/);
  assert.doesNotMatch(cardsIn(html).find(card => card.includes("BUILDER-102")), /esm-stalled/);

  const panel = panelFor(html, "Draft an estimate against a project");
  assert.match(panel, /<p class="esm-progress-since">In progress since <time dateTime="2026-09-01T10:00:00Z">1 Sept? 2026<\/time><\/p>/);
  assert.match(panel, /<span>Stalled: in progress for 11 weeks\. Stories are flagged after 4 weeks\.<\/span>/);
  assert.match(panelFor(html, "Look up prices in the material catalogue"), /In progress since <time dateTime="2026-11-01T10:00:00Z">/);
  assert.doesNotMatch(panelFor(html, "Look up prices in the material catalogue"), /esm-stalled-note/);
  assert.match(html, /<input type="checkbox" name="status" value="stalled"\/>Stalled<\/label>/);

  const filtered = await makeStoryMapResponse("/story-map?status=stalled", current, engineer, options).text();
  assert.equal(statusSummaryIn(filtered), "Stalled");
  assert.match(filtered, /<input type="checkbox" name="status" checked="" value="stalled"\/>Stalled/);
  assert.match(filtered, /Showing 1 of 5 stories\./);
  assert.deepEqual(cardsIn(filtered).map(card => /esm-card-id">([^<]+)/.exec(card)[1]), ["BUILDER-101"]);

  const noHistory = await makeStoryMapResponse("/story-map", current, engineer, { now: stalledNow }).text();
  assert.doesNotMatch(noHistory, /esm-stalled|value="stalled"|In progress since/);

  const customer = await makeStoryMapResponse("/story-map?status=stalled", current, regular, options).text();
  assert.doesNotMatch(customer, /esm-stalled|stalled|In progress since|In progress for/i);
  const customerJson = await makeStoryMapResponse("/api/story-map", current, regular, options).json();
  assert.doesNotMatch(JSON.stringify(customerJson), /stalled|inProgressSince/i);
});

test("diffs report a change to the stalled threshold", () => {
  const weeks = stalledAfterWeeks => editedSample(document => { document.settings = { stalledAfterWeeks }; });
  assert.equal(diffStoryMaps(map, editedSample(document => { document.settings = { stalledAfterWeeks: 4 }; })).stalledAfterWeeks, undefined);
  const longer = diffStoryMaps(map, weeks(6));
  assert.deepEqual(longer.stalledAfterWeeks, { from: 4, to: 6 });
  assert.ok(hasStoryMapChanges(longer));
  assert.match(formatStoryMapDiff(longer), /### Settings\n\n- Stories are flagged as stalled after 6 weeks in progress \(was 4 weeks\)\./);
  assert.match(formatStoryMapDiff(diffStoryMaps(map, weeks(0))), /- Turned off the stalled flag \(was 4 weeks\)\./);
  assert.match(formatStoryMapDiff(diffStoryMaps(weeks(0), weeks(1))), /after 1 week in progress \(was off\)/);
});

test("history records each story's last edit to any field and credits mergers for bot edits", async t => {
  const { root, git, build } = await historyRepo(t);
  const writeMap = edit => writeFile(join(root, "product/story-map.yaml"), stringify(edit(parseStoryMap(git(["show", "HEAD:product/story-map.yaml"])))));
  const story = (document, id) => document.stories.find(story => story.id === id);

  // A bot commit pushed by Frank: a notes edit and a status change are both credited to Frank.
  await writeMap(document => {
    story(document, "BUILDER-103").notes = "Validate the total before submitting.";
    story(document, "FINANCE-201").status = "in-progress";
    return document;
  });
  git(["commit", "-q", "-am", "Agent notes"], { author: "claude[bot]", committer: "Frank", date: "2026-11-19T09:00:00Z" });

  // A named agent account on a branch merged by Grace. It also sets updatedBy on BUILDER-104, which wins.
  git(["checkout", "-q", "-b", "audit"]);
  await writeMap(document => {
    story(document, "BUILDER-102").sources = ["docs/story-map.md"];
    story(document, "BUILDER-104").summary = "Totals include tax.";
    story(document, "BUILDER-104").updatedBy = "Sam Patel";
    return document;
  });
  git(["commit", "-q", "-am", "Audit sources"], { author: "Audit Agent", date: "2026-11-19T10:00:00Z" });
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "-m", "Merge audit", "audit"], { author: "Grace", date: "2026-11-19T11:00:00Z" });

  // Reordering stories changes no story, so it is not an edit.
  await writeMap(document => {
    document.stories.reverse();
    return document;
  });
  git(["commit", "-q", "-am", "Reorder"], { author: "Hana", date: "2026-11-19T12:00:00Z" });

  const edits = history => Object.fromEntries(history.lastEdits.map(({ storyId, at, by }) => [storyId, [at.slice(0, 16), by]]));
  const withBots = await build({ botNames: ["audit agent"] });
  assert.deepEqual(edits(withBots), {
    "BUILDER-101": ["2026-11-12T15:30", "Bob Builder"],
    "BUILDER-102": ["2026-11-19T11:00", "Grace"],
    "BUILDER-103": ["2026-11-19T09:00", "Frank"],
    "BUILDER-104": ["2026-11-19T11:00", "Sam Patel"],
    "FINANCE-201": ["2026-11-19T09:00", "Frank"],
    "FINANCE-202": ["2026-11-01T10:00", "Taylor Reed"],
  });
  assert.deepEqual(withBots.events.at(-1), {
    storyId: "FINANCE-201", type: "status", from: "planned", to: "in-progress",
    at: "2026-11-19T09:00:00.000Z", by: "Frank", mergedBy: "Frank", commit: withBots.lastEdits.find(edit => edit.storyId === "FINANCE-201").commit,
  });
  // Without the bot list, the named agent is credited as an ordinary author.
  assert.equal(edits(await build())["BUILDER-102"][1], "Audit Agent");

  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const out = join(root, "build/history.json");
  const written = spawnSync(process.execPath, [cli, "history", "--bot-names", "Someone Else, Audit Agent", "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  assert.equal(edits(parseStoryMapHistory(await readFile(out, "utf8")))["BUILDER-102"][1], "Grace");
  assert.equal(spawnSync(process.execPath, [cli, "history", "--bot-names"], { cwd: root }).status, 2);
});

test("the header says when the map last changed and which releases the changes were in", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const edit = (storyId, at, by) => ({ storyId, at, by, commit: "abcdef1" });
  const history = {
    version: 1, generatedAt: now.toISOString(), complete: true,
    events: [{ storyId: "FINANCE-202", type: "added", to: "planned", at: "2026-11-10T09:00:00.000Z", by: "Alex Morgan", commit: "abcdef0" }],
    lastEdits: [
      edit("BUILDER-101", "2026-11-18T10:00:00.000Z", "Sam Patel"),
      edit("BUILDER-102", "2026-11-20T08:00:00.000Z", "Sam Patel"),
      // More than 14 days before the latest update, so not recent.
      edit("FINANCE-201", "2026-10-01T10:00:00.000Z", "Grace"),
    ],
  };
  const view = getStoryMapForViewer(map, engineer, { history, now });
  assert.deepEqual(view.recentUpdates, {
    at: "2026-11-20T08:00:00.000Z",
    by: "Sam Patel",
    days: 14,
    releases: [
      { id: "builder-mvp", title: "Builder workflow", stories: 2 },
      // Falls back to the status history for a story with no last edit.
      { id: "reconciliation-internal", title: "Reconciliation discovery", stories: 1 },
    ],
  });
  // Filtering the board does not change the summary.
  assert.deepEqual(filterStoryMapView(view, { query: "nothing matches this" }, { now }).recentUpdates, view.recentUpdates);

  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view, now, timeZone: "UTC" }));
  assert.match(html, /<p class="esm-goal esm-recent">Last updated <time dateTime="2026-11-20T08:00:00\.000Z" title="[^"]+">4 hours ago<\/time> by Sam Patel\. Recent changes focused on <strong>Builder workflow<\/strong> \(2 stories\) and <strong>Reconciliation discovery<\/strong> \(1 story\)\.<\/p>/);
  assert.doesNotMatch(html, /Sample plan for the builder-to-finance/);

  // Without history, and for customers, the map's summary stays.
  const noHistory = getStoryMapForViewer(map, engineer);
  assert.equal(noHistory.recentUpdates, undefined);
  assert.match(renderToStaticMarkup(createElement(StoryMapBoard, { map: noHistory })), /<p class="esm-goal">Sample plan for the builder-to-finance/);
  assert.equal(getStoryMapForViewer(map, { roles: ["customer"] }, { history, now }).recentUpdates, undefined);
});

test("the board survives a locale or time zone that Intl rejects", t => {
  const now = new Date("2026-11-20T12:00:00Z");
  const history = {
    version: 1, generatedAt: now.toISOString(), complete: true,
    events: [
      { storyId: "BUILDER-101", type: "added", to: "in-progress", at: "2026-09-01T10:00:00.000Z", by: "Alex Morgan", commit: "abcdef1" },
      { storyId: "BUILDER-102", type: "added", to: "planned", at: "2026-11-19T10:00:00.000Z", by: "Sam Patel", commit: "abcdef2" },
    ],
    lastEdits: [{ storyId: "BUILDER-102", at: "2026-11-19T10:00:00.000Z", by: "Sam Patel", commit: "abcdef2" }],
  };
  const view = filterStoryMapView(getStoryMapForViewer(map, engineer, { history, now }), {}, { now });
  const render = props => renderToStaticMarkup(createElement(StoryMapBoard, { map: view, now, ...props }));
  const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));

  const badZone = render({ timeZone: "Nowhere/Nope" });
  assert.equal(badZone, render({}));
  assert.match(badZone, /<time class="esm-changed" dateTime="2026-11-19T10:00:00\.000Z" title="[^"]*19 Nov 2026[^"]*">yesterday<\/time>/);
  assert.match(badZone, /1 Sept? 2026/);

  const badLocale = render({ locale: "not a locale", timeZone: "UTC" });
  assert.equal(badLocale, render({ locale: "en-GB", timeZone: "UTC" }));
  assert.match(badLocale, /19 Nov 2026, 10:00/);
  // Both problems at once still render.
  assert.match(render({ locale: "not a locale", timeZone: "Nowhere/Nope" }), /yesterday/);

  // One warning for each bad setting, however often the board renders.
  render({ timeZone: "Nowhere/Nope" });
  render({ locale: "not a locale" });
  assert.deepEqual(warnings, [
    'auto-story-map: Unknown time zone "Nowhere/Nope", so dates use the server\'s time zone.',
    'auto-story-map: Unknown locale "not a locale", so dates use en-GB.',
  ]);
  // A valid locale and zone are used as given.
  assert.match(render({ locale: "de-DE", timeZone: "Asia/Tokyo" }), /19\.11\.2026, 19:00/);
});

test("getStoryMapPage projects and filters in one call", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const separately = (viewer, query, options = {}) => {
    const view = getStoryMapForViewer(map, viewer, { now, ...options });
    return view && filterStoryMapView(view, readStoryMapFilters(new URLSearchParams(query)), { now });
  };
  const queries = ["", "q=estimate", "status=all", "status=shipped&q=draft", "status=stalled", "changed=7d", "q=" + "x".repeat(300)];
  for (const viewer of [engineer, superAdmin, regular, null]) {
    for (const query of queries) {
      assert.deepEqual(getStoryMapPage(map, viewer, { now, searchParams: new URLSearchParams(query) }), separately(viewer, query), `${JSON.stringify(viewer)} ${query}`);
    }
  }
  // Options reach the projection, and no searchParams means the default filters.
  const productManager = { roles: ["product-manager"] };
  const canViewInternal = viewer => viewer.roles.includes("product-manager");
  assert.deepEqual(getStoryMapPage(map, productManager, { now, canViewInternal }), separately(productManager, "", { canViewInternal }));
  assert.equal(getStoryMapPage(map, productManager, { now, canViewInternal }).audience, "internal");
  assert.deepEqual(getStoryMapPage(map, engineer).filter, { query: undefined, status: undefined, total: map.stories.length, hidden: { blocked: 0, cut: 1 } });
  assert.equal(getStoryMapPage(parseStoryMap(stringify({ ...structuredClone(map), visibility: "internal" })), regular), null);

  // A search for internal-only text finds nothing for a customer.
  const search = (viewer, q) => getStoryMapPage(map, viewer, { searchParams: new URLSearchParams({ q }) }).stories.map(story => story.title);
  assert.deepEqual(search(engineer, "carried"), ["Look up prices in the material catalogue"]);
  assert.deepEqual(search(regular, "carried"), []);
  assert.deepEqual(search(engineer, "BUILDER-102"), ["Look up prices in the material catalogue"]);
  assert.deepEqual(search(regular, "BUILDER-102"), []);
  assert.deepEqual(search(regular, "catalogue"), ["Find material prices"]);
});

test("storyMapResponseHeaders keep story map responses private", () => {
  assert.deepEqual({ ...storyMapResponseHeaders }, { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  assert.ok(Object.isFrozen(storyMapResponseHeaders));
  const headers = new Headers(storyMapResponseHeaders);
  assert.equal(headers.get("cache-control"), "private, no-store");
  for (const path of ["/story-map", "/api/story-map", "/elsewhere"]) {
    for (const viewer of [engineer, regular, null]) {
      const response = makeStoryMapResponse(path, map, viewer);
      for (const [name, value] of Object.entries(storyMapResponseHeaders)) assert.equal(response.headers.get(name), value, `${path} ${name}`);
    }
  }
});

test("history fits long Git names to the history format", async t => {
  const { root, git, build } = await historyRepo(t);
  const writeMap = edit => writeFile(join(root, "product/story-map.yaml"), stringify(edit(parseStoryMap(git(["show", "HEAD:product/story-map.yaml"])))));
  const story = (document, id) => document.stories.find(story => story.id === id);
  const longName = "A".repeat(130);
  const emojiName = "🙂".repeat(130);

  await writeMap(document => {
    story(document, "BUILDER-103").status = "in-progress";
    return document;
  });
  git(["commit", "-q", "-am", "Start checks"], { author: longName, committer: emojiName, date: "2026-11-19T09:00:00Z" });
  await writeMap(document => {
    story(document, "FINANCE-201").status = "in-progress";
    return document;
  });
  git(["commit", "-q", "-am", "Start approvals"], { author: `  ${emojiName}  `, committer: "Erin", date: "2026-11-19T10:00:00Z" });

  // build() checks that parseStoryMapHistory accepts the file.
  const history = await build();
  const [checks, approvals] = history.events.slice(-2);
  assert.equal(checks.by, `${"A".repeat(119)}…`);
  assert.equal(Array.from(checks.mergedBy).length, 120);
  assert.equal(checks.mergedBy, `${"🙂".repeat(119)}…`);
  assert.equal(approvals.by, `${"🙂".repeat(119)}…`);
  for (const name of [checks.by, checks.mergedBy, approvals.by]) assert.ok(name.isWellFormed(), "no lone surrogates");
  assert.equal(history.lastEdits.find(edit => edit.storyId === "BUILDER-103").by, checks.by);
});

test("the history format limits names and reasons by code points", async () => {
  const { fitHistoryText, historyNameMaxLength, historyReasonMaxLength } = await import("../dist/history.js");
  assert.equal(historyNameMaxLength, 120);
  assert.equal(fitHistoryText("  Bob  ", 120), "Bob");
  assert.equal(fitHistoryText("   ", 120), undefined);
  assert.equal(fitHistoryText(undefined, 120), undefined);
  assert.equal(fitHistoryText("B".repeat(120), 120), "B".repeat(120));
  // No trailing space before the ellipsis.
  assert.equal(fitHistoryText(`${"B".repeat(118)} more`, 120), `${"B".repeat(118)}…`);
  assert.equal(fitHistoryText("x".repeat(600), historyReasonMaxLength).length, 500);

  const event = { storyId: "X-1", type: "added", to: "planned", at: "2026-11-01T10:00:00.000Z", commit: "abcdef1" };
  const history = events => ({ version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true, events });
  // 120 emoji are 240 UTF-16 code units, but 120 characters.
  assert.equal(parseStoryMapHistory(history([{ ...event, by: "🙂".repeat(120) }])).events[0].by, "🙂".repeat(120));
  assert.throws(() => parseStoryMapHistory(history([{ ...event, by: "B".repeat(121) }])), /at most 120 characters/);
  assert.throws(() => parseStoryMapHistory(history([{ ...event, mergedBy: "   " }])), /Invalid story map history/);
  assert.throws(() => parseStoryMapHistory(history([{ ...event, reason: "r".repeat(501) }])), /at most 500 characters/);
});

/** A repository whose map is committed once per entry, as YAML text or as an edit of the sample. */
async function formatRepo(t, versions) {
  const root = await mkdtemp(join(tmpdir(), "story-map-format-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, date) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "a@example.test",
        GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "a@example.test",
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-q", "-b", "main"]);
  await mkdir(join(root, "product"));
  const commits = [];
  for (const [index, version] of versions.entries()) {
    const text = typeof version === "string" ? version : stringify(rawSample(version));
    await writeFile(join(root, "product/story-map.yaml"), text);
    git(["add", "-A"]);
    git(["commit", "-q", "--allow-empty", "-m", `Version ${index + 1}`], `2026-11-${String(index + 1).padStart(2, "0")}T10:00:00Z`);
    commits.push(git(["rev-parse", "HEAD"]));
  }
  const build = async () => {
    const { buildStoryMapHistory } = await import("../dist/history-git.js");
    const history = await buildStoryMapHistory({ cwd: root });
    assert.deepEqual(parseStoryMapHistory(JSON.stringify(history)), history);
    return history;
  };
  return { root, git, commits, build };
}

const storyIn = (document, id) => document.stories.find(story => story.id === id);

/** Like editedSample, but without validating, so the result can use fields or statuses the format does not have. */
function rawSample(edit) {
  const document = structuredClone(map);
  edit(document);
  return document;
}

test("past versions of the map are read leniently", async () => {
  const { loadHistoricalStoryMap, migrateStoryMap } = await import("../dist/schema.js");
  const older = rawSample(document => {
    document.owner = "Platform team";
    storyIn(document, "BUILDER-101").effort = "M";
    document.releases[0].customer.icon = "rocket";
    storyIn(document, "BUILDER-103").status = "on-hold";
  });
  const loaded = loadHistoricalStoryMap(stringify(older));
  assert.deepEqual(loaded.dropped, { stories: 1, storyIds: ["BUILDER-103"], fields: 3 });
  assert.equal(Object.hasOwn(loaded.map, "owner"), false);
  assert.equal(Object.hasOwn(storyIn(loaded.map, "BUILDER-101"), "effort"), false);
  assert.equal(storyIn(loaded.map, "BUILDER-103"), undefined);
  assert.equal(loaded.map.stories.length, map.stories.length - 1);
  // A current map reads the same both ways.
  assert.deepEqual(loadHistoricalStoryMap(sample), { map, dropped: { stories: 0, storyIds: [], fields: 0 } });
  // Cross-references are not checked, but YAML safety and the map's structure are.
  assert.equal(loadHistoricalStoryMap(stringify(rawSample(document => { storyIn(document, "BUILDER-101").release = "gone"; }))).map.stories.length, map.stories.length);
  assert.throws(() => loadHistoricalStoryMap("a: 1\na: 2\n"), StoryMapValidationError);
  assert.throws(() => loadHistoricalStoryMap(`a: &a [1]\nb: [${Array(30).fill("*a").join(", ")}]\n`), /alias/i);
  assert.throws(() => loadHistoricalStoryMap("version: 2\n"), StoryMapValidationError);
  assert.equal(migrateStoryMap(older), older);
  // The current map is still checked strictly.
  assert.throws(() => parseStoryMap(stringify(older)), /owner[^\n]*Unknown field/);
});

test("history keeps events from versions that use an older format", async t => {
  const { commits, build } = await formatRepo(t, [
    // An older format: a map-level field and a story field that no longer exist.
    document => { document.owner = "Platform team"; storyIn(document, "BUILDER-101").effort = "M"; },
    // A status that no longer exists drops only that story from this version.
    document => {
      storyIn(document, "BUILDER-101").effort = "M";
      storyIn(document, "BUILDER-102").status = "in-progress";
      storyIn(document, "BUILDER-103").status = "on-hold";
    },
    "version: 1\nstories: [unclosed\n",
    // Today's format.
    document => { storyIn(document, "BUILDER-102").status = "in-progress"; },
  ]);
  const history = await build();
  const events = history.events.map(({ storyId, type, from, to, at }) => [storyId, type, from, to, at.slice(0, 10)]);
  assert.deepEqual(events, [
    ["BUILDER-101", "added", undefined, "in-progress", "2026-11-01"],
    ["BUILDER-102", "added", undefined, "planned", "2026-11-01"],
    ["BUILDER-103", "added", undefined, "planned", "2026-11-01"],
    ["FINANCE-201", "added", undefined, "planned", "2026-11-01"],
    ["FINANCE-202", "added", undefined, "cut", "2026-11-01"],
    ["BUILDER-102", "status", "planned", "in-progress", "2026-11-02"],
  ]);
  // Dropping a field the format no longer has is not an edit, and the dropped story was not re-added.
  const edits = Object.fromEntries(history.lastEdits.map(edit => [edit.storyId, edit.at.slice(0, 10)]));
  assert.deepEqual(edits, { "BUILDER-101": "2026-11-01", "BUILDER-102": "2026-11-02", "BUILDER-103": "2026-11-01", "FINANCE-201": "2026-11-01", "FINANCE-202": "2026-11-01" });
  // Only the version that is not valid YAML is skipped.
  assert.equal(history.skippedCount, 1);
  assert.equal(history.skipped[0].commit, commits[2]);
  assert.match(history.skipped[0].reason, /^The map could not be read: line \d+: /);
});

test("story-map history warns about skipped versions and still exits 0", async t => {
  const { root, commits } = await formatRepo(t, [
    document => document,
    "version: 1\nstories: [unclosed\n",
    "",
    "not: [valid\n",
    "id: : :\n",
    document => { storyIn(document, "BUILDER-102").status = "in-progress"; },
  ]);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const out = join(root, "history.json");
  const result = spawnSync(process.execPath, [cli, "history", "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: skipped 4 versions of the map that could not be read, so changes made in them are missing:/);
  for (const commit of commits.slice(1, 4)) assert.ok(result.stderr.includes(`  ${commit.slice(0, 12)}: The map could not be read`), commit);
  assert.equal(result.stderr.includes(commits[4].slice(0, 12)), false);
  assert.match(result.stderr, /and 1 more, listed in the file's skipped field/);
  const history = parseStoryMapHistory(await readFile(out, "utf8"));
  assert.equal(history.skippedCount, 4);
  assert.deepEqual(history.skipped.map(version => version.commit), commits.slice(1, 5));
  assert.equal(history.events.at(-1).to, "in-progress");
});

test("history files load with and without the skipped fields", () => {
  const base = { version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true, events: [] };
  assert.deepEqual(parseStoryMapHistory(base), base);
  const withSkipped = { ...base, skipped: [{ commit: "abcdef1", reason: "The map does not exist at this commit." }], skippedCount: 120 };
  assert.deepEqual(parseStoryMapHistory(withSkipped), withSkipped);
  assert.throws(() => parseStoryMapHistory({ ...base, skipped: Array(101).fill(withSkipped.skipped[0]) }), /Invalid story map history/);
  assert.throws(() => parseStoryMapHistory({ ...base, skipped: [{ commit: "abcdef1", reason: "" }] }), /Invalid story map history/);
  assert.throws(() => parseStoryMapHistory({ ...base, skippedCount: -1 }), /Invalid story map history/);
});

test("story-map diff escapes rejected story IDs from an older base", async t => {
  const { root } = await formatRepo(t, [
    document => { storyIn(document, "BUILDER-103").id = "x` [link](https://example.test)\n@team #1"; },
  ]);
  await writeFile(join(root, "product/story-map.yaml"), stringify(editedSample(document => { storyIn(document, "BUILDER-102").status = "in-progress"; })));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "diff", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const note = result.stdout.split("\n").find(line => line.startsWith("> The map at"));
  // The whole rejected ID stays in one code span, so its link and mentions render as plain text.
  assert.equal(note, "> The map at `HEAD` uses an older format, so this comparison leaves out 1 story that no longer validates (``x` [link](https://example.test) @team #1``) from it.");
});

test("code spans hold any number of backtick runs", async () => {
  const { code } = await import("../dist/diff.js");
  assert.equal(code("a``b`c"), "```a``b`c```");
  assert.equal(code("`a".repeat(300000)).length, 600006);
});

test("story-map diff compares with a base that uses an older format", async t => {
  const { root } = await formatRepo(t, [
    document => { document.owner = "Platform team"; storyIn(document, "BUILDER-103").status = "on-hold"; },
  ]);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  await writeFile(join(root, "product/story-map.yaml"), stringify(editedSample(document => { storyIn(document, "BUILDER-102").status = "in-progress"; })));

  const markdown = run("diff", "HEAD");
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /^## Story map changes\n\n> \[!NOTE\]\n> The map at `HEAD` uses an older format, so this comparison leaves out 1 field the format no longer has and 1 story that no longer validates \(`BUILDER-103`\) from it\.\n\n/);
  assert.match(markdown.stdout, /`BUILDER-102`[^\n]*Planned → \*\*In progress\*\*/);
  const json = JSON.parse(run("diff", "--format", "json", "HEAD").stdout);
  assert.deepEqual(json.baseDropped, { stories: 1, storyIds: ["BUILDER-103"], fields: 1 });

  // Without anything dropped there is no note, and an unreadable base still fails.
  spawnSync("git", ["commit", "-q", "-am", "Today's format"], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.test" } });
  const clean = run("diff", "HEAD");
  assert.equal(clean.status, 0, clean.stderr);
  assert.doesNotMatch(clean.stdout, /older format/);
  assert.equal(Object.hasOwn(JSON.parse(run("diff", "--format", "json", "HEAD").stdout), "baseDropped"), false);
  const current = await readFile(join(root, "product/story-map.yaml"), "utf8");
  await writeFile(join(root, "product/story-map.yaml"), "version: 2\n");
  spawnSync("git", ["commit", "-q", "-am", "Break"], { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.test" } });
  await writeFile(join(root, "product/story-map.yaml"), current);
  const broken = run("diff", "HEAD");
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /The map at HEAD is not valid, so it cannot be compared/);

  // The current map is still checked strictly.
  await writeFile(join(root, "product/story-map.yaml"), stringify(rawSample(document => { document.owner = "Platform team"; })));
  const strict = run("validate", "product/story-map.yaml");
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /owner: Unknown field\./);
  assert.equal(run("diff", "HEAD~1").status, 1);
});

test("panels show the last edit from history, and fall back to updatedBy without it", async () => {
  const history = parseStoryMapHistory({
    version: 1,
    generatedAt: "2026-11-20T08:00:00Z",
    complete: true,
    events: [{ storyId: "BUILDER-101", type: "added", to: "in-progress", at: "2026-11-01T10:00:00Z", by: "Alex Morgan", commit: "a000001" }],
    lastEdits: [{ storyId: "BUILDER-101", at: "2026-11-17T10:00:00Z", by: "Sam Patel", commit: "a000002" }],
  });
  const now = new Date("2026-11-20T12:00:00Z");
  const html = await makeStoryMapResponse("/story-map", map, engineer, { history, now }).text();
  const panel = panelFor(html, "Draft an estimate against a project");
  assert.match(panel, /<p class="esm-updater">Last updated <time dateTime="2026-11-17T10:00:00Z" title="17 Nov 2026, \d\d:00">3 days ago<\/time> by Sam Patel<\/p>/);
  assert.doesNotMatch(panel, /Last updated by Alex Morgan/);
  // The card still shows the last status change: an edit is not a change for the Changed filter.
  assert.match(cardsIn(html).find(card => card.includes("BUILDER-101")), />19 days ago<\/time>/);
  // A story with no recorded edit falls back to updatedBy.
  assert.match(panelFor(html, "Look up prices in the material catalogue"), /Last updated by Sam Patel/);

  // History files written before lastEdits existed still parse.
  const older = parseStoryMapHistory({ ...history, lastEdits: undefined });
  assert.equal(older.lastEdits, undefined);
  const view = getStoryMapForViewer(map, engineer, { history: older });
  assert.equal(Object.hasOwn(view.stories[0], "lastEdit"), false);

  const customer = await makeStoryMapResponse("/api/story-map", map, regular, { history, now }).json();
  assert.doesNotMatch(JSON.stringify(customer), /lastEdit|Sam Patel|a000002/);
});

// BUILDER-101 is customer-facing and merged, but not yet available to its users.
const mergedMap = editedSample(document => {
  document.stories.find(story => story.id === "BUILDER-101").status = "merged";
});

test("merged stories are active and shown with their own status to internal viewers", async () => {
  const internal = getStoryMapForViewer(mergedMap, engineer);
  assert.equal(internal.stories.find(story => story.id === "BUILDER-101").status, "merged");
  assert.deepEqual(filterStoryMapView(internal, { status: "merged" }).stories.map(story => story.id), ["BUILDER-101"]);
  assert.ok(filterStoryMapView(internal).stories.some(story => story.id === "BUILDER-101"));
  assert.equal(filterStoryMapView(internal, { status: "in-progress" }).stories.length, 0);

  const html = await makeStoryMapResponse("/story-map", mergedMap, engineer).text();
  assert.match(cardsIn(html).find(card => card.includes("BUILDER-101")), /<span class="esm-status" data-status="merged"><svg[^>]*>[\s\S]*?<\/svg>Merged<\/span>/);
  assert.match(html, /<input type="checkbox" name="status" checked="" value="merged"\/>Merged/);
  assert.match(releasePanel(html, "Builder workflow"), /0 of 3 stories shipped, 1 merged\./);
});

test("customers see merged stories as in progress", async () => {
  const customer = getStoryMapForViewer(mergedMap, regular);
  const story = customer.stories.find(story => story.title === "Draft a project estimate");
  assert.equal(story.status, "in-progress");
  assert.deepEqual(filterStoryMapView(customer, { status: "in-progress" }).stories.map(story => story.title), ["Draft a project estimate"]);

  const html = await makeStoryMapResponse("/story-map", mergedMap, regular).text();
  const json = await makeStoryMapResponse("/api/story-map", mergedMap, regular).json();
  for (const output of [html, JSON.stringify(json)]) assert.doesNotMatch(output, /merged/i);
});

test("diffs list merged as a status change but not as a customer-facing one", () => {
  const toMerged = diffStoryMaps(map, mergedMap);
  assert.deepEqual(toMerged.stories.updated.map(update => [update.id, update.status]), [["BUILDER-101", { from: "in-progress", to: "merged" }]]);
  assert.deepEqual(toMerged.customer, []);
  assert.doesNotMatch(formatStoryMapDiff(toMerged), /Customer-facing/);

  const shipped = editedSample(document => { document.stories.find(story => story.id === "BUILDER-101").status = "shipped"; });
  assert.deepEqual(diffStoryMaps(mergedMap, shipped).customer.map(change => change.details), [["status In progress → Shipped"]]);
});

test("stalled stories stop counting once merged", () => {
  const history = parseStoryMapHistory({
    version: 1,
    generatedAt: "2026-11-20T08:00:00Z",
    complete: true,
    events: [
      { storyId: "BUILDER-101", type: "added", to: "in-progress", at: "2026-09-01T10:00:00Z", commit: "a000001" },
      { storyId: "BUILDER-101", type: "status", from: "in-progress", to: "merged", at: "2026-11-01T10:00:00Z", commit: "a000002" },
    ],
  });
  const story = getStoryMapForViewer(mergedMap, engineer, { history, now: new Date("2026-11-20T12:00:00Z") })
    .stories.find(story => story.id === "BUILDER-101");
  assert.equal(story.stalled, undefined);
  assert.equal(story.inProgressSince, undefined);
});

test("board.js applies filters as they change and restores focus", async t => {
  // A minimal stand-in for the browser, enough for the script's event wiring.
  class FakeElement { focus() { focused = this.name; } }
  class FakeSelect extends FakeElement {}
  class FakeInput extends FakeElement {}
  const storage = new Map();
  let focused;
  const globals = {
    HTMLElement: FakeElement,
    HTMLSelectElement: FakeSelect,
    HTMLInputElement: FakeInput,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { readyState: "complete", querySelectorAll: () => [] },
  };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  function fakeForm() {
    const status = Object.assign(new FakeSelect(), { name: "status" });
    const search = Object.assign(new FakeInput(), { name: "q", type: "search" });
    const hint = { textContent: "" };
    const listeners = {};
    const form = {
      dataset: {},
      submitted: 0,
      fields: { status, search },
      hint,
      elements: { namedItem: name => [status, search].find(field => field.name === name) ?? null },
      querySelector: selector => selector === "[data-esm-filter-hint]" ? hint : null,
      addEventListener: (type, listener) => { listeners[type] = listener; },
      requestSubmit() { this.submitted++; },
      fire: (type, event) => listeners[type]?.(event),
    };
    return form;
  }
  const { enhanceStoryMapFilters } = await import("auto-story-map/board.js");

  const form = fakeForm();
  const root = { querySelectorAll: () => [form] };
  enhanceStoryMapFilters(root);
  enhanceStoryMapFilters(root);
  assert.equal(form.dataset.esmAuto, "");
  assert.match(form.hint.textContent, /updates as soon as you choose/);

  form.fire("change", { target: form.fields.status });
  assert.equal(form.submitted, 1, "a select change submits once, even after enhancing twice");
  assert.equal(storage.get("esm-filter-focus"), "status");

  let prevented = false;
  form.fire("keydown", { key: "Enter", target: form.fields.search, preventDefault: () => { prevented = true; } });
  assert.equal(form.submitted, 2);
  assert.ok(prevented);
  form.fire("keydown", { key: "a", target: form.fields.search, preventDefault() {} });
  form.fire("change", { target: form.fields.search });
  assert.equal(form.submitted, 2, "typing and search changes do not submit");

  // After the page reloads, focus returns to the field that was used.
  const reloaded = fakeForm();
  enhanceStoryMapFilters({ querySelectorAll: () => [reloaded] });
  assert.equal(focused, "q");
  assert.equal(storage.has("esm-filter-focus"), false);
});

test("the board renders the filter hint empty and marks the Apply button", () => {
  const view = filterStoryMapView(getStoryMapForViewer(map, engineer), {});
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
  const hintId = /<span class="esm-visually-hidden" id="([^"]+)" data-esm-filter-hint=""><\/span>/.exec(html)?.[1];
  assert.ok(hintId);
  assert.match(html, new RegExp(`<summary class="esm-select esm-menu-button" data-esm-focus="status" aria-describedby="${hintId}">`));
  assert.match(html, /<fieldset class="esm-menu-panel"><legend class="esm-visually-hidden">Show stories with these statuses<\/legend>/);
  assert.match(html, /<button type="submit" class="esm-button esm-apply">Apply<\/button>/);
});

test("each release lane has a collapse toggle that works without JavaScript", () => {
  const internal = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer) }));
  const toggles = [...internal.matchAll(/<input type="checkbox" class="esm-collapse-input"[^>]*>/g)].map(match => match[0]);
  assert.deepEqual(toggles.map(input => /value="([^"]+)"/.exec(input)[1]), map.releases.map(release => release.id));
  assert.deepEqual(toggles.map(input => /aria-label="Collapse ([^"]+)"/.exec(input)[1]), map.releases.map(release => release.title));

  // Customer toggles use the renumbered release IDs, never the internal ones.
  const customerView = getStoryMapForViewer(map, regular);
  const customer = renderToStaticMarkup(createElement(StoryMapBoard, { map: customerView }));
  const customerIds = [...customer.matchAll(/<input type="checkbox" class="esm-collapse-input"[^>]*>/g)]
    .map(match => /value="([^"]+)"/.exec(match[0])[1]);
  assert.deepEqual(customerIds, customerView.releases.map(release => release.id));
  for (const release of map.releases) assert.doesNotMatch(customer, new RegExp(`value="${release.id}"`));
});

test("board.js remembers collapsed release lanes", async t => {
  class FakeElement {}
  class FakeInput extends FakeElement {
    constructor(value) { super(); this.value = value; this.checked = false; this.classList = { contains: name => name === "esm-collapse-input" }; }
  }
  const storage = new Map();
  const globals = {
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: class {},
    location: { pathname: "/story-map" },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { readyState: "complete", querySelectorAll: () => [] },
  };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  function fakeBoard(ids) {
    const inputs = ids.map(id => new FakeInput(id));
    let listeners = 0;
    let listener;
    const links = ["/story-map/export?format=vsdx", "/story-map/export?as=engineer&format=csv#top"].map(href => {
      const link = { dataset: { esmExport: href }, href: undefined, setAttribute: (name, value) => { link[name] = value; } };
      return link;
    });
    return {
      inputs,
      links,
      get listeners() { return listeners; },
      querySelectorAll: selector => selector.includes("data-esm-export") ? links : inputs,
      addEventListener: (type, handler) => { listeners++; listener = handler; },
      toggle(index) { inputs[index].checked = !inputs[index].checked; listener({ target: inputs[index] }); },
    };
  }
  const { enhanceStoryMapReleases } = await import("auto-story-map/board.js");

  const board = fakeBoard(["r1", "r2", "r3"]);
  const root = { querySelectorAll: () => [board] };
  enhanceStoryMapReleases(root);
  enhanceStoryMapReleases(root);
  assert.equal(board.listeners, 1, "enhancing twice adds one listener");

  board.toggle(0);
  board.toggle(2);
  assert.deepEqual(JSON.parse(storage.get("esm-collapsed:/story-map")), ["r1", "r3"]);
  assert.deepEqual(board.links.map(link => link.href), ["/story-map/export?format=vsdx&collapsed=r1,r3", "/story-map/export?as=engineer&format=csv&collapsed=r1,r3#top"], "export links follow the collapsed lanes");
  board.toggle(0);
  assert.deepEqual(JSON.parse(storage.get("esm-collapsed:/story-map")), ["r3"]);

  // After a filter reloads the page, the same lanes start collapsed.
  const reloaded = fakeBoard(["r1", "r2", "r3"]);
  enhanceStoryMapReleases({ querySelectorAll: () => [reloaded] });
  assert.deepEqual(reloaded.inputs.map(input => input.checked), [false, false, true]);
  assert.equal(reloaded.links[0].href, "/story-map/export?format=vsdx&collapsed=r3", "export links start with the remembered lanes");

  reloaded.toggle(2);
  assert.equal(storage.has("esm-collapsed:/story-map"), false, "expanding every lane clears the stored value");
  assert.equal(reloaded.links[0].href, "/story-map/export?format=vsdx");
});

test("the board shows the running version and commit, with links for internal viewers", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(storyMapVersion, pkg.version);
  const head = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" });
  if (head.status === 0) assert.equal(storyMapCommit, head.stdout.trim(), "the build records the commit it came from");
  assert.equal(storyMapRepositoryUrl, "https://github.com/duncan-m/auto-story-map");

  const internal = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer) }));
  const footer = /<footer class="esm-footer">.*?<\/footer>/.exec(internal)?.[0];
  assert.ok(footer);
  assert.match(footer, new RegExp(`Auto Story Map ${pkg.version.replaceAll(".", "\\.")}`));
  if (storyMapCommit) {
    assert.match(footer, new RegExp(`Auto Story Map ${pkg.version.replaceAll(".", "\\.")} <a class="esm-commit" href="https://github\\.com/duncan-m/auto-story-map/commit/${storyMapCommit}" title="The commit this build came from" target="_blank" rel="noopener noreferrer">${storyMapCommit}<`), "the commit sits right of the version");
  }
  const anchor = pkg.version.replaceAll(".", "");
  assert.match(footer, new RegExp(`href="https://github\\.com/duncan-m/auto-story-map/blob/main/CHANGELOG\\.md#${anchor}" target="_blank" rel="noopener noreferrer">Changelog`));
  assert.match(footer, /href="https:\/\/github\.com\/duncan-m\/auto-story-map" target="_blank" rel="noopener noreferrer">Source code/);
  assert.match(footer, /By <a href="https:\/\/github\.com\/duncan-m" target="_blank" rel="noopener noreferrer">Duncan Malcolm/);
  assert.match(footer, new RegExp(`href="https://github\\.com/duncan-m/auto-story-map/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">${pkg.license.replaceAll(".", "\\.")} licence`));
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.match(changelog, new RegExp(`^## ${pkg.version.replaceAll(".", "\\.")}$`, "m"), "the changelog link has a heading to land on");

  const customer = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, regular) }));
  const customerFooter = /<footer class="esm-footer">.*?<\/footer>/.exec(customer)?.[0];
  assert.ok(customerFooter?.includes(`Auto Story Map ${pkg.version}`));
  if (storyMapCommit) assert.ok(customerFooter.includes(`<span class="esm-commit" title="The commit this build came from">${storyMapCommit}</span>`));
  assert.match(customerFooter, />By Duncan Malcolm</);
  assert.match(customerFooter, />AGPL-3\.0-only licence</);
  assert.doesNotMatch(customerFooter, /<a /, "customers see the version, author and licence without links");

  const hidden = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer), showVersion: false }));
  assert.doesNotMatch(hidden, /esm-footer/);
});

test("groups story history newest first in linear time, keeping equal timestamps latest-supplied first", () => {
  const event = (to, at, commit) => ({ storyId: "BUILDER-101", type: "status", from: "planned", to, at, by: "Alex Morgan", commit });
  const history = {
    version: 1, generatedAt: "2026-11-20T12:00:00.000Z", complete: true,
    events: [
      event("planned", "2026-11-01T10:00:00.000Z", "a000001"),
      event("in-progress", "2026-11-03T10:00:00.000Z", "a000002"),
      event("blocked", "2026-11-03T10:00:00.000Z", "a000003"),
      event("merged", "2026-11-02T10:00:00.000Z", "a000004"),
    ],
  };
  const story = getStoryMapForViewer(map, engineer, { history }).stories.find(s => s.id === "BUILDER-101");
  assert.deepEqual(story.history.map(entry => entry.commit), ["a000003", "a000002", "a000004", "a000001"]);

  // Many events for one story stay fast.
  const many = Array.from({ length: 100_000 }, (_, i) => event("planned", new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(), "b000000"));
  const started = performance.now();
  const view = getStoryMapForViewer(map, engineer, { history: { ...history, events: many } });
  assert.ok(performance.now() - started < 2000);
  assert.equal(view.stories.find(s => s.id === "BUILDER-101").history.length, 100_000);
});

/** Reads a zip of stored entries, checking each CRC. Test-only. */
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  assert.equal(view.getUint32(end, true), 0x06054B50, "end of central directory");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = data => {
    let crc = 0xFFFFFFFF;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014B50, "central directory header");
    assert.equal(view.getUint16(at + 10, true), 0, "stored, not compressed");
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034B50, `local header for ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC for ${name}`);
    files.set(name, decoder.decode(data));
    at += 46 + nameLength;
  }
  return files;
}

/** A small well-formedness check for the XML the exporter writes. Test-only. */
function assertWellFormedXml(xml, name) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  assert.doesNotMatch(body, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/, `${name}: unescaped &`);
  const stack = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  for (const match of body.matchAll(tag)) {
    assert.doesNotMatch(body.slice(last, match.index), /[<>]/, `${name}: stray < or > before ${match[0].slice(0, 40)}`);
    last = match.index + match[0].length;
    const [, closing, tagName, , selfClosing] = match;
    if (closing) assert.equal(stack.pop(), tagName, `${name}: </${tagName}> closes the wrong element`);
    else if (!selfClosing) stack.push(tagName);
  }
  assert.doesNotMatch(body.slice(last), /[<>]/, `${name}: trailing markup`);
  assert.deepEqual(stack, [], `${name}: unclosed elements`);
}

/** Escapes every character with a meaning in a regular expression. */
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exportNow = new Date("2026-11-20T09:00:00Z");
const exportView = (source = map, options = {}) => getStoryMapForViewer(source, engineer, options);
const page = files => files.get("visio/pages/page1.xml");
const storyShapes = files => [...page(files).matchAll(/NameU="Story ([^"]+)"/g)].map(match => match[1]);

test("ESM-702: exports the internal map as a valid Visio package", () => {
  const files = readStoredZip(storyMapToVsdx(exportView(), { now: exportNow }));
  for (const [name, xml] of files) assertWellFormedXml(xml, name);

  // Every XML part has a content type, and every relationship points at a part.
  const types = files.get("[Content_Types].xml");
  for (const name of files.keys()) {
    if (name.endsWith(".rels") || name === "[Content_Types].xml") continue;
    assert.match(types, new RegExp(`PartName="/${escapeRegExp(name)}"`), `${name} has a content type`);
  }
  for (const [name, xml] of files) {
    if (!name.endsWith(".rels")) continue;
    const base = name.replace(/_rels\/[^/]*\.rels$/, "");
    for (const [, target] of xml.matchAll(/Target="([^"]+)"/g)) assert.ok(files.has(base + target), `${name} → ${target}`);
  }
  assert.match(types, new RegExp(`ContentType="${escapeRegExp(vsdxContentType)}"`));

  // Every story is a card with its ID, title and shape data, including blocked and cut ones.
  assert.deepEqual(storyShapes(files).sort(), map.stories.map(story => story.id).sort());
  const xml = page(files);
  assert.match(xml, /<Cell N="Value" V="FINANCE-202" U="STR"\/><Cell N="Label" V="ID"\/>/);
  assert.match(xml, /<Cell N="Value" V="Cut" U="STR"\/><Cell N="Label" V="Status"\/>/);
  assert.match(files.get("docProps/core.xml"), /2026-11-20T00:00:00Z/);
});

test("ESM-702: the Visio export is the same every time for the same input", () => {
  const view = exportView();
  assert.deepEqual(storyMapToVsdx(view, { now: exportNow }), storyMapToVsdx(view, { now: exportNow }));
});

test("ESM-702: only the unfiltered internal view can be exported", () => {
  const customerView = getStoryMapForViewer(map, regular);
  assert.equal(customerView?.audience, "all-users");
  assert.throws(() => storyMapToVsdx(customerView), /Customers cannot export/);
  assert.throws(() => storyMapToVsdx(filterStoryMapView(exportView(), { query: "estimate" })), /unfiltered/);
  assert.throws(() => storyMapToVsdx(exportView(), { maxStories: 0 }), RangeError);
});

test("ESM-702: collapsed releases are exported as a header and a story count", () => {
  const view = exportView();
  const release = view.releases[0];
  const inRelease = view.stories.filter(story => story.release === release.id);
  const files = readStoredZip(storyMapToVsdx(view, { collapsedReleases: [release.id, "no-such-release"], now: exportNow }));
  const shapes = storyShapes(files);
  for (const story of inRelease) assert.ok(!shapes.includes(story.id), `${story.id} is hidden`);
  assert.equal(shapes.length, view.stories.length - inRelease.length);
  assert.match(page(files), new RegExp(`Collapsed · ${inRelease.length} stor`));
  assert.match(page(files), /<Cell N="Value" V="Yes" U="STR"\/><Cell N="Label" V="Collapsed"\/>/);
});

test("ESM-702: the Visio export keeps the most recently changed stories", () => {
  const base = parseStoryMap(sample);
  const stories = Array.from({ length: 250 }, (_, i) => ({
    ...base.stories[0],
    id: `BULK-${i + 1}`,
    customer: undefined,
  }));
  const big = { ...base, stories };
  // Without history, the last stories in the file count as newest.
  let files = readStoredZip(storyMapToVsdx(exportView(big), { now: exportNow }));
  assert.equal(storyShapes(files).length, 200);
  assert.ok(storyShapes(files).includes("BULK-250"));
  assert.ok(!storyShapes(files).includes("BULK-50"));
  assert.match(page(files), /Showing the 200 most recently changed of 250 stories/);

  // With history, the newest edits win, wherever they are in the file.
  const history = {
    version: 1,
    generatedAt: "2026-11-20T08:00:00Z",
    complete: true,
    events: [],
    lastEdits: [
      { storyId: "BULK-1", at: "2026-11-19T10:00:00Z", by: "Sam", commit: "a".repeat(40) },
      ...stories.slice(1).map((story, i) => ({ storyId: story.id, at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), commit: "b".repeat(40) })),
    ],
  };
  files = readStoredZip(storyMapToVsdx(exportView(big, { history }), { now: exportNow, maxStories: 10 }));
  assert.equal(storyShapes(files).length, 10);
  assert.ok(storyShapes(files).includes("BULK-1"));
  assert.ok(storyShapes(files).includes("BULK-250"));
  assert.ok(!storyShapes(files).includes("BULK-2"));
});

test("ESM-702: the Visio export escapes text and shortens long titles", () => {
  const base = parseStoryMap(sample);
  const title = `Escape <tags> & "quotes" 🚀 ${"very long words ".repeat(20)}end`;
  const odd = { ...base, title: "A & B <map>", stories: [{ ...base.stories[0], title, customer: undefined }] };
  const files = readStoredZip(storyMapToVsdx(exportView(odd), { now: exportNow }));
  for (const [name, xml] of files) assertWellFormedXml(xml, name);
  const xml = page(files);
  assert.match(xml, /A &amp; B &lt;map&gt;/);
  assert.match(xml, /Escape &lt;tags&gt; &amp; &quot;quotes&quot; 🚀/);
  // The card shows a shortened title, and shape data keeps it whole.
  assert.match(xml, /<cp IX="1"\/>Escape [^<]*…<\/Text>/);
  assert.ok(xml.includes(`V="${title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}"`));
});

test("ESM-703: story-map export writes a Visio file from the YAML file", async () => {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const fixture = fileURLToPath(new URL("./fixtures/builder-estimates.yaml", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "story-map-export-"));
  const run = (...args) => spawnSync(process.execPath, [cli, "export", ...args], { cwd: root, encoding: "utf8" });
  try {
    const release = map.releases[0].id;
    const inRelease = map.stories.filter(story => story.release === release);
    const out = join(root, "nested", "map.vsdx");
    const written = run("--format", "vsdx", "--output", out, "--collapsed", `${release},no-such-release`, fixture);
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stderr, /--collapsed no-such-release is not a release/);
    assert.match(written.stderr, new RegExp(`exported ${map.stories.length - inRelease.length} stories \\(${inRelease.length} in collapsed lanes\\)`));
    const files = readStoredZip(await readFile(out));
    assert.equal(storyShapes(files).length, map.stories.length - inRelease.length);
    assert.match(page(files), /Collapsed · /);

    // The default output name, a story limit and history to choose the newest.
    const history = {
      version: 1,
      generatedAt: "2026-11-20T08:00:00Z",
      complete: true,
      events: [],
      lastEdits: [{ storyId: map.stories[0].id, at: "2026-11-19T10:00:00Z", commit: "a".repeat(40) }],
    };
    await writeFile(join(root, "history.json"), JSON.stringify(history));
    const limited = run("--format=vsdx", "--max-stories", "1", "--history", "history.json", fixture);
    assert.equal(limited.status, 0, limited.stderr);
    assert.match(limited.stderr, /story-map\.vsdx: exported 1 story \(left out \d+ less recently changed\)/);
    assert.deepEqual(storyShapes(readStoredZip(await readFile(join(root, "story-map.vsdx")))), [map.stories[0].id]);

    // `--output -` writes the file to stdout.
    const piped = spawnSync(process.execPath, [cli, "export", "--format", "vsdx", "--output", "-", fixture], { cwd: root });
    assert.equal(piped.status, 0);
    assert.equal(storyShapes(readStoredZip(new Uint8Array(piped.stdout))).length, map.stories.length);

    // Problems with the command line exit 2, and problems with the files exit 1.
    assert.match(run(fixture).stderr, /--format is required/);
    assert.equal(run(fixture).status, 2);
    assert.equal(run("--format", "pdf", fixture).status, 2);
    assert.equal(run("--format", "vsdx", "--max-stories", "0", fixture).status, 2);
    assert.equal(run("--format", "vsdx", "--output", "--max-stories", "3", fixture).status, 2);
    await writeFile(join(root, "invalid.yaml"), "title: No stories\n");
    assert.equal(run("--format", "vsdx", "invalid.yaml").status, 1);
    assert.equal(run("--format", "vsdx", "--history", "missing.json", fixture).status, 1);
    assert.equal(run("--format", "vsdx").status, 1, "product/story-map.yaml is missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Splits RFC 4180 CSV into rows of fields. Test-only. */
function parseCsv(text) {
  const rows = [[]];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') field += text[i++];
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") rows.at(-1).push(field), (field = "");
    else if (char === "\r" && text[i + 1] === "\n") rows.at(-1).push(field), (field = ""), rows.push([]), i++;
    else field += char;
  }
  assert.equal(field, "", "the file ends with CRLF");
  assert.deepEqual(rows.pop(), [], "the file ends with CRLF");
  return rows;
}

const csvRows = csv => {
  assert.ok(csv.startsWith("\uFEFF"), "starts with a byte order mark");
  return parseCsv(csv.slice(1));
};

test("ESM-705: exports the internal map as CSV in board order", () => {
  const view = exportView();
  const rows = csvRows(storyMapToCsv(view));
  assert.deepEqual(rows[0], ["Activity", "Release", "ID", "Title", "Estimate"]);
  const expected = view.releases.flatMap(release =>
    view.activities.flatMap(activity =>
      view.stories.filter(story => story.release === release.id && story.activity === activity.id).map(story => [activity.title, release.title, story.id, story.title, ""]),
    ),
  );
  assert.deepEqual(rows.slice(1), expected);
  assert.equal(rows.length - 1, map.stories.length);
  assert.equal(csvContentType, "text/csv; charset=utf-8");
});

test("ESM-705: only the unfiltered internal view can be exported as CSV", () => {
  assert.throws(() => storyMapToCsv(getStoryMapForViewer(map, regular)), /Customers cannot export/);
  assert.throws(() => storyMapToCsv(filterStoryMapView(exportView(), { query: "estimate" })), /unfiltered/);
});

test("ESM-705: collapsed releases are one CSV row with the story count", () => {
  const view = exportView();
  const release = view.releases[0];
  const count = view.stories.filter(story => story.release === release.id).length;
  const rows = csvRows(storyMapToCsv(view, { collapsedReleases: [release.id, "no-such-release"] }));
  assert.deepEqual(rows.filter(row => row[1] === release.title), [["", release.title, "", `Collapsed · ${count} ${count === 1 ? "story" : "stories"}`, ""]]);
  assert.equal(rows.length - 1, map.stories.length - count + 1);
});

test("ESM-705: the CSV export quotes fields and defuses formulas", () => {
  const base = parseStoryMap(sample);
  const titles = ['Commas, "quotes" and\nnew lines', "=HYPERLINK(\"http://example.com\")", "+1 for estimates", "-2 days", "@mention", "Plain 🚀 title"];
  const odd = { ...base, stories: titles.map((title, i) => ({ ...base.stories[0], id: `ODD-${i + 1}`, title, customer: undefined })) };
  const csv = storyMapToCsv(exportView(odd));
  assert.ok(csv.includes('"Commas, ""quotes"" and\nnew lines"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://example.com"")"`));
  const rows = csvRows(csv).slice(1);
  assert.deepEqual(rows.map(row => row[3]), [titles[0], `'${titles[1]}`, "'+1 for estimates", "'-2 days", "'@mention", "Plain 🚀 title"]);
});

test("ESM-705: the CSV export keeps the most recently changed stories", () => {
  const base = parseStoryMap(sample);
  const stories = Array.from({ length: 250 }, (_, i) => ({ ...base.stories[0], id: `BULK-${i + 1}`, customer: undefined }));
  const ids = csvRows(storyMapToCsv(exportView({ ...base, stories }))).slice(1).map(row => row[2]);
  assert.equal(ids.length, 200);
  assert.equal(ids[0], "BULK-51");
  assert.equal(ids.at(-1), "BULK-250");
  assert.equal(csvRows(storyMapToCsv(exportView({ ...base, stories }), { maxStories: 3 })).length, 4);
});

test("ESM-705: story-map export writes CSV from the YAML file", async () => {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const fixture = fileURLToPath(new URL("./fixtures/builder-estimates.yaml", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "story-map-export-csv-"));
  try {
    const written = spawnSync(process.execPath, [cli, "export", "--format", "csv", fixture], { cwd: root, encoding: "utf8" });
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stderr, new RegExp(`story-map\\.csv: exported ${map.stories.length} stories`));
    assert.equal(await readFile(join(root, "story-map.csv"), "utf8"), storyMapToCsv(exportView()));

    const piped = spawnSync(process.execPath, [cli, "export", "--format", "csv", "--output", "-", "--max-stories", "2", fixture], { cwd: root, encoding: "utf8" });
    assert.equal(piped.status, 0, piped.stderr);
    assert.equal(csvRows(piped.stdout).length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const jsonHistory = complete => ({
  version: 1,
  generatedAt: "2026-11-20T08:00:00.000Z",
  complete,
  events: [{ storyId: map.stories[0].id, type: "added", to: map.stories[0].status, at: "2026-11-01T10:00:00.000Z", by: "Sam Patel", commit: "a".repeat(40) }],
  lastEdits: [{ storyId: map.stories[0].id, at: "2026-11-19T10:00:00.000Z", by: "Sam Patel", commit: "b".repeat(40) }],
});
const jsonTests = () => parseStoryMapTests({
  version: 1,
  generatedAt: "2026-11-20T08:30:00.000Z",
  tests: [{ storyIds: [map.stories[0].id], file: "test/estimate.test.js", line: 4, name: `${map.stories[0].id}: drafts an estimate`, kind: "test" }],
  omitted: [{ storyId: map.stories[0].id, file: "test/estimate.test.js", count: 2 }],
});

test("ESM-706: exports every internal story with its details as JSON", () => {
  const view = exportView(map, { history: jsonHistory(true), tests: jsonTests() });
  const text = storyMapToJson(view, { now: exportNow });
  assert.ok(text.endsWith("}\n"));
  const data = JSON.parse(text);
  assert.equal(data.format, "auto-story-map.export");
  assert.equal(data.version, 1);
  assert.equal(data.title, view.title);
  assert.equal(data.exportedAt, exportNow.toISOString());
  assert.equal(data.provenance.generator.version, storyMapVersion);
  assert.deepEqual(data.provenance.history, { generatedAt: "2026-11-20T08:00:00.000Z", complete: true });
  assert.deepEqual(data.provenance.tests, { generatedAt: "2026-11-20T08:30:00.000Z" });
  const asJson = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(data.activities, asJson(view.activities));
  assert.deepEqual(data.releases, asJson(view.releases));
  assert.deepEqual(data.statuses.map(status => status.id), ["planned", "in-progress", "merged", "shipped", "blocked", "cut"]);
  assert.ok(data.statuses.every(status => status.label && status.meaning));

  assert.deepEqual(data.stories.map(story => story.id), map.stories.map(story => story.id), "every story, in map order");
  const [first, ...rest] = data.stories;
  assert.deepEqual(first, asJson({ ...view.stories[0], testCount: 3 }), "the internal card, with tests over the limit counted");
  assert.equal(first.lastEdit.by, "Sam Patel");
  assert.ok(rest.every(story => story.testCount === 0), "0 means none are tagged when an index was supplied");
  assert.deepEqual(data.completeness, {
    storiesInMap: map.stories.length,
    storiesIncluded: map.stories.length,
    storiesOverLimit: 0,
    historySupplied: true,
    testsIndexed: true,
    notes: data.completeness.notes,
  });
  assert.equal(storyMapToJson(view, { now: exportNow }), text, "the same every time for the same input");
  assert.equal(jsonContentType, "application/json; charset=utf-8");
});

test("ESM-706: the JSON export notes its provenance and what it leaves out", () => {
  const bare = JSON.parse(storyMapToJson(exportView(), { now: exportNow }));
  assert.equal(bare.provenance.history, undefined);
  assert.equal(bare.provenance.tests, undefined);
  assert.ok(bare.stories.every(story => !("testCount" in story)), "no test count without an index, because coverage is unknown");
  const bareNotes = [...bare.provenance.notes, ...bare.completeness.notes].join("\n");
  assert.match(bareNotes, /source of truth/);
  assert.match(bareNotes, /can lag behind the code/);
  assert.match(bareNotes, /No status history was supplied/);
  assert.match(bareNotes, /No tests index was supplied/);
  assert.match(bareNotes, new RegExp(`Includes ${map.stories.length} of the map's ${map.stories.length} stories`));
  assert.match(bareNotes, /Customer-facing copy is not included/);
  assert.doesNotMatch(bareNotes, /left out|shallow/);

  const view = exportView(map, { history: jsonHistory(false), tests: jsonTests() });
  const partial = JSON.parse(storyMapToJson(view, { maxStories: 1, now: exportNow }));
  assert.equal(partial.stories.length, 1);
  assert.deepEqual(partial.releases.map(release => release.storyCounts), view.releases.map(release => release.storyCounts), "releases count every story");
  assert.deepEqual(partial.completeness, {
    storiesInMap: map.stories.length,
    storiesIncluded: 1,
    storiesOverLimit: map.stories.length - 1,
    historySupplied: true,
    testsIndexed: true,
    notes: partial.completeness.notes,
  });
  const notes = [...partial.provenance.notes, ...partial.completeness.notes].join("\n");
  assert.match(notes, /Git history, generated at 2026-11-20T08:00:00.000Z/);
  assert.match(notes, /static scan of test names .* generated at 2026-11-20T08:30:00.000Z\. No tests were run/);
  assert.match(notes, /left out by the limit of 1\./);
  assert.match(notes, /shallow clone/);
  assert.match(notes, /untagged tests may still cover it/);
});

test("ESM-706: only the unfiltered internal view can be exported as JSON", () => {
  assert.throws(() => storyMapToJson(getStoryMapForViewer(map, regular)), /Customers cannot export/);
  assert.throws(() => storyMapToJson(filterStoryMapView(exportView(), { query: "estimate" })), /unfiltered/);
});

test("ESM-706: the JSON export includes every story by default, even in collapsed lanes", () => {
  const base = parseStoryMap(sample);
  const stories = Array.from({ length: 250 }, (_, i) => ({ ...base.stories[0], id: `BULK-${i + 1}`, customer: undefined }));
  const data = JSON.parse(storyMapToJson(exportView({ ...base, stories })));
  assert.equal(data.stories.length, 250);
  assert.equal(data.completeness.storiesOverLimit, 0);
  const view = exportView();
  assert.equal(storyMapToJson(view, { collapsedReleases: view.releases.map(release => release.id), now: exportNow }), storyMapToJson(view, { now: exportNow }), "collapsed lanes are ignored");
  assert.equal(storyMapExportResponse(view, { format: "json", collapsed: view.releases[0].id, now: exportNow }).body, storyMapToJson(view, { now: exportNow }));
  assert.deepEqual(JSON.parse(storyMapToJson(exportView({ ...base, stories }), { maxStories: 3 })).stories.map(story => story.id), ["BULK-248", "BULK-249", "BULK-250"]);
});

test("ESM-706: story-map export writes JSON with history and tests", async () => {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const fixture = fileURLToPath(new URL("./fixtures/builder-estimates.yaml", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "story-map-export-json-"));
  try {
    await writeFile(join(root, "history.json"), JSON.stringify(jsonHistory(true)));
    await writeFile(join(root, "tests.json"), JSON.stringify(jsonTests()));
    const written = spawnSync(process.execPath, [cli, "export", "--format", "json", "--history", "history.json", "--tests-index", "tests.json", fixture], { cwd: root, encoding: "utf8" });
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stderr, new RegExp(`story-map\\.json: exported ${map.stories.length} stories`));
    const data = JSON.parse(await readFile(join(root, "story-map.json"), "utf8"));
    assert.equal(data.completeness.historySupplied, true);
    assert.equal(data.completeness.testsIndexed, true);
    assert.equal(data.stories[0].testCount, 3);

    const piped = spawnSync(process.execPath, [cli, "export", "--format", "json", "--output", "-", "--max-stories", "2", fixture], { cwd: root, encoding: "utf8" });
    assert.equal(piped.status, 0, piped.stderr);
    assert.equal(JSON.parse(piped.stdout).stories.length, 2);

    const collapsed = spawnSync(process.execPath, [cli, "export", "--format", "json", "--output", "-", "--collapsed", map.releases[0].id, fixture], { cwd: root, encoding: "utf8" });
    assert.equal(collapsed.status, 0, collapsed.stderr);
    assert.match(collapsed.stderr, /--collapsed is ignored by --format json/);
    assert.equal(JSON.parse(collapsed.stdout).stories.length, map.stories.length);

    const ignored = spawnSync(process.execPath, [cli, "export", "--format", "csv", "--output", "-", "--tests-index", "tests.json", fixture], { cwd: root, encoding: "utf8" });
    assert.equal(ignored.status, 0, ignored.stderr);
    assert.match(ignored.stderr, /--tests-index is only used by --format json/);

    await writeFile(join(root, "bad.json"), "{}");
    const bad = spawnSync(process.execPath, [cli, "export", "--format", "json", "--tests-index", "bad.json", fixture], { cwd: root, encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /bad\.json: Invalid story map tests/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ESM-704: the board links to the export for internal viewers only", () => {
  const render = (viewer, props = {}) => renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, viewer), ...props }));
  const internal = render(engineer, { exportHref: "/story-map/export?as=engineer#map" });
  const links = [...internal.matchAll(/<a class="esm-export-link" href="([^"]+)" data-esm-export="([^"]+)" download="">([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(match => [match[1], match[3]]), [
    ["/story-map/export?as=engineer&amp;format=vsdx#map", "Visio (.vsdx), for Lucidchart or Miro"],
    ["/story-map/export?as=engineer&amp;format=csv#map", "CSV"],
    ["/story-map/export?as=engineer&amp;format=json#map", "JSON, for agents and scripts"],
  ]);
  assert.ok(links.every(match => match[1] === match[2]));
  assert.match(render(engineer, { exportHref: "/export" }), /href="\/export\?format=vsdx"/);
  assert.doesNotMatch(render(engineer), /esm-export/, "no links without exportHref");
  assert.doesNotMatch(render(regular, { exportHref: "/story-map/export" }), /esm-export|story-map\/export/, "never for customers");

  // With the filter toolbar, the Export button sits in the filter form, after the Changed select.
  const history = { version: 1, generatedAt: "2026-11-20T08:00:00Z", complete: true, events: [], lastEdits: [{ storyId: map.stories[0].id, at: "2026-11-19T10:00:00Z", commit: "a".repeat(40) }] };
  const page = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapPage(map, engineer, { history, searchParams: new URLSearchParams() }), exportHref: "/story-map/export" }));
  const form = /<form class="esm-filters".*?<\/form>/.exec(page)?.[0] ?? "";
  assert.match(form, /name="changed".*<\/select>.*<details class="esm-menu esm-export"><summary class="esm-button esm-menu-button">Export<svg.*<\/summary><ul class="esm-menu-panel"><li><a class="esm-export-link" href="\/story-map\/export\?format=vsdx"/);
  assert.equal(page.match(/<details class="esm-menu esm-export"/g).length, 1, "one Export button, not one in the header too");
  assert.doesNotMatch(/<header class="esm-header">.*?<\/header>/.exec(page)[0], /esm-export/);
  assert.match(/<header class="esm-header">.*?<\/header>/.exec(internal)[0], /<details class="esm-menu esm-export">/, "without the toolbar, the header has it");
  const customerPage = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapPage(map, regular, { searchParams: new URLSearchParams() }), exportHref: "/story-map/export" }));
  assert.doesNotMatch(customerPage, /esm-export/, "never in a customer toolbar");
});

test("ESM-704: storyMapExportResponse builds a download for a host route", () => {
  const view = exportView();
  const vsdx = storyMapExportResponse(view, { format: "vsdx", collapsed: `${map.releases[0].id}, no-such-release`, now: exportNow });
  assert.deepEqual(vsdx.headers, {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": vsdxContentType,
    "Content-Disposition": 'attachment; filename="builder-estimates-delivery-map.vsdx"',
  });
  assert.deepEqual(vsdx.body, storyMapToVsdx(view, { collapsedReleases: [map.releases[0].id, "no-such-release"], now: exportNow }));

  const csv = storyMapExportResponse(view, { format: "csv", collapsed: [map.releases[0].id], filename: 'Q4 "plan"\r\nX-Evil: 1' });
  assert.equal(csv.headers["Content-Type"], csvContentType);
  assert.equal(csv.headers["Content-Disposition"], 'attachment; filename="q4-plan-x-evil-1.csv"');
  assert.equal(csv.body, storyMapToCsv(view, { collapsedReleases: [map.releases[0].id] }));
  assert.equal(storyMapExportResponse({ ...view, title: "🚀" }, { format: "csv" }).headers["Content-Disposition"], 'attachment; filename="story-map.csv"');

  assert.throws(() => storyMapExportResponse(getStoryMapForViewer(map, regular), { format: "csv" }), TypeError);
  const json = storyMapExportResponse(view, { format: "json", now: exportNow });
  assert.equal(json.headers["Content-Type"], jsonContentType);
  assert.equal(json.headers["Content-Disposition"], 'attachment; filename="builder-estimates-delivery-map.json"');
  assert.equal(json.body, storyMapToJson(view, { now: exportNow }));
  assert.throws(() => storyMapExportResponse(view, { format: "pdf" }), RangeError);
  assert.throws(() => storyMapExportResponse(view, { format: null }), RangeError);
});

test("ESM-704: the example host serves the export to internal viewers", async () => {
  const route = (path, viewer) => makeStoryMapResponse(path, map, viewer, { canViewInternal: viewer => viewer?.roles.includes("engineer"), now: exportNow });
  assert.equal(route("/story-map/export?format=csv", null).status, 401);
  assert.equal(route("/story-map/export?format=csv", regular).status, 403);
  assert.equal(route("/story-map/export?format=pdf", engineer).status, 400);
  const csv = route(`/story-map/export?format=csv&collapsed=${map.releases[0].id}&q=estimate`, engineer);
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get("Content-Type"), csvContentType);
  // Response.text() drops the byte order mark, so compare the bytes.
  assert.equal(Buffer.from(await csv.arrayBuffer()).toString("utf8"), storyMapToCsv(exportView(), { collapsedReleases: [map.releases[0].id] }), "filters on the URL are ignored");
  const vsdx = route("/story-map/export?format=vsdx", engineer);
  assert.equal(vsdx.headers.get("Content-Disposition"), 'attachment; filename="builder-estimates-delivery-map.vsdx"');
  assert.ok(readStoredZip(new Uint8Array(await vsdx.arrayBuffer())).has("visio/pages/page1.xml"));

  const page = await makeStoryMapResponse("/story-map", map, engineer, { canViewInternal: () => true, preservedParams: { as: "engineer" } }).text();
  assert.match(page, /href="\/story-map\/export\?as=engineer&amp;format=vsdx"/);
});

test("ESM-414: board.js applies the status filter when its menu closes with a change", async t => {
  class FakeNode {}
  class FakeElement extends FakeNode {}
  const storage = new Map();
  const documentListeners = [];
  const globals = {
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    HTMLInputElement: class {},
    HTMLSelectElement: class {},
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { readyState: "complete", querySelectorAll: () => [], addEventListener: (type, handler) => documentListeners.push(handler) },
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
  const form = { requestSubmit: () => submitted++ };
  const listeners = {};
  const menu = Object.assign(new FakeElement(), {
    open: false,
    closest: () => form,
    contains: target => target === menu,
    querySelector: selector => selector === "summary" ? { focus() {} } : selector === "[data-esm-focus]" ? { dataset: { esmFocus: "status" } } : {},
    addEventListener: (type, handler) => { listeners[type] = handler; },
  });
  const setOpen = open => { menu.open = open; listeners.toggle(); };
  const { enhanceStoryMapMenus } = await import("auto-story-map/board.js");
  enhanceStoryMapMenus({ querySelectorAll: () => [menu] });

  setOpen(true);
  setOpen(false);
  assert.equal(submitted, 0, "closing without a change does not reload");

  setOpen(true);
  listeners.change();
  assert.equal(submitted, 0, "ticking a box waits for the menu to close");
  documentListeners[0]({ target: new FakeNode() });
  assert.equal(menu.open, false, "a click elsewhere closes the menu");
  listeners.toggle();
  assert.equal(submitted, 1, "closing after a change applies it");
  assert.equal(storage.get("esm-filter-focus"), "status", "focus returns to the status button after the reload");

  setOpen(true);
  listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(menu.open, false, "Escape closes the menu");
});

test("ESM-702: the Visio layout keeps each release's header lines and cards inside its lane", async () => {
  // Internal modules: the layout is not public, but its geometry is what the imports depend on.
  const { prepareStoryMapExport } = await import("../dist/export.js");
  const { layoutStoryMapExport } = await import("../dist/export-layout.js");
  const current = parseStoryMap(await readFile(new URL("../product/story-map.yaml", import.meta.url), "utf8"));
  const view = getStoryMapForViewer(current, engineer);
  const layout = layoutStoryMapExport(prepareStoryMapExport(view, { collapsedReleases: [current.releases[0].id], now: exportNow }));
  const inside = (shape, lane) => shape.x >= lane.x && shape.x + shape.w <= lane.x + lane.w + 1e-9 && shape.y >= lane.y - 1e-9 && shape.y + shape.h <= lane.y + lane.h + 1e-9;

  for (const release of current.releases) {
    const lane = layout.shapes.find(shape => shape.name === `Release ${release.id}`);
    const header = layout.shapes.filter(shape => shape.name === `Release header ${release.id}` || shape.name.startsWith(`Release header ${release.id} line `));
    // One shape per line, each with a single run, so no tool has to place paragraphs inside a shape.
    assert.ok(header.length >= 2, release.id);
    for (const line of header) {
      assert.equal(line.text.length, 1, `${line.name} has one run`);
      assert.ok(inside(line, lane), `${line.name} is inside its lane`);
    }
    for (let i = 1; i < header.length; i++) assert.ok(header[i].y >= header[i - 1].y + header[i - 1].h, `${header[i].name} starts below the line above`);
    const cards = layout.shapes.filter(shape => shape.data?.Release === release.id && shape.name.startsWith("Story "));
    for (const card of cards) assert.ok(inside(card, lane), `${card.name} is inside its lane`);
    // Cards in a lane share a height that fits their titles.
    assert.equal(new Set(cards.map(card => card.h)).size <= 1, true);
  }
  // Every shape uses one text size: Miro applies the first paragraph's size to all of a shape's text.
  for (const shape of layout.shapes) assert.ok(new Set(shape.text.map(run => run.size)).size <= 1, `${shape.name} uses one text size`);
  const short = layout.shapes.find(shape => shape.name === "Story ESM-705");
  const long = layout.shapes.find(shape => shape.name === "Story ESM-602");
  assert.ok(short.text[1].size >= 11, "card titles are at least 11 points");
  assert.ok(short.h < 1 && long.h < 1, "cards stay under an inch tall");
});

const storyTestCalls = await readFile(new URL("./fixtures/story-tests/calls.txt", import.meta.url), "utf8");

/** A repository with the call-forms fixture as a test file, plus files the scan should and should not read. */
async function storyTestsRepo(t) {
  const base = await mkdtemp(join(tmpdir(), "story-map-tests-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const files = {
    "test/calls.js": storyTestCalls,
    "src/estimate.spec.ts": 'it("BUILDER-103: a TypeScript spec", (): void => {});\n',
    "src/estimate.ts": 'test("BUILDER-103: not a test file", () => {});\n',
    "lib/__tests__/nested.tsx": 'test("BUILDER-103: under __tests__", () => {});\n',
    "test/notes.md": 'test("BUILDER-103: not a script")\n',
    "dist/estimate.test.js": 'test("BUILDER-103: built output", () => {});\n',
    "build/estimate.test.js": 'test("BUILDER-103: built output", () => {});\n',
    ".cache/estimate.test.js": 'test("BUILDER-103: dot folder", () => {});\n',
    "node_modules/pkg/estimate.test.js": 'test("BUILDER-103: dependency", () => {});\n',
    "map.yaml": sample,
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await mkdir(join(base, "outside"));
  await writeFile(join(base, "outside/secret.test.js"), 'test("BUILDER-998: outside", () => {});\n');
  await symlink(join(base, "outside/secret.test.js"), join(root, "test/linked.test.js"));
  await symlink("../outside", join(root, "outside"));
  return root;
}

test("ESM-801: finds tests tagged with story IDs without running them", async t => {
  const { findStoryTests, scanTestCalls } = await import("../dist/tests.js");
  const { loadStoryMap } = await import("../dist/schema.js");
  const root = await storyTestsRepo(t);
  const loaded = loadStoryMap(sample);
  const { tests, issues } = await findStoryTests(loaded, root, { paths: ["."] });

  assert.deepEqual(tests.map(found => [found.file, found.line, found.kind, found.storyIds.join(" "), found.name]), [
    ["lib/__tests__/nested.tsx", 1, "test", "BUILDER-103", "BUILDER-103: under __tests__"],
    ["src/estimate.spec.ts", 1, "test", "BUILDER-103", "BUILDER-103: a TypeScript spec"],
    ["test/calls.js", 7, "test", "BUILDER-101", "BUILDER-101: double quotes"],
    ["test/calls.js", 8, "test", "BUILDER-101", "BUILDER-101: single quotes"],
    ["test/calls.js", 9, "test", "BUILDER-101", "BUILDER-101: backticks"],
    ["test/calls.js", 10, "test", "BUILDER-102", "BUILDER-102: it"],
    ["test/calls.js", 11, "test", "BUILDER-102", "BUILDER-102: only"],
    ["test/calls.js", 12, "test", "BUILDER-102", "BUILDER-102: skip"],
    ["test/calls.js", 13, "test", "BUILDER-102", "BUILDER-102: todo"],
    ["test/calls.js", 14, "test", "BUILDER-102", "BUILDER-102: concurrent"],
    ["test/calls.js", 15, "test", "BUILDER-102", "BUILDER-102: each %s"],
    ["test/calls.js", 16, "test", "BUILDER-102", "BUILDER-102: each table $a"],
    ["test/calls.js", 20, "group", "BUILDER-103", "BUILDER-103: describe"],
    ["test/calls.js", 23, "group", "BUILDER-103", "BUILDER-103: suite"],
    ["test/calls.js", 24, "test", "BUILDER-101", `BUILDER-101: it's "escaped" \u2014 here`],
    ["test/calls.js", 25, "test", "BUILDER-101", "BUILDER-101: name on the next line"],
    ["test/calls.js", 29, "test", "BUILDER-101 BUILDER-102", "BUILDER-101 and BUILDER-102 together"],
    ["test/calls.js", 30, "test", "BUILDER-101", "BUILDER-101: twice, BUILDER-101"],
    // A template literal keeps its ${…} as written, and IDs are matched on its literal text only.
    ["test/calls.js", 31, "test", "BUILDER-101", 'BUILDER-101: ${"template"} part'],
    ["test/calls.js", 33, "test", "BUILDER-999", "Tagged at the end (BUILDER-999)"],
  ]);
  // Not read: built output, dot folders, dependencies, non-test files, and links out of the repository.
  assert.deepEqual(issues.map(issue => [issue.severity, issue.file, issue.message]), [
    ["error", "outside", "Points outside the repository through a symbolic link, so it was not read."],
    ["error", "test/linked.test.js", "Points outside the repository through a symbolic link, so it was not read."],
  ]);

  // Named paths: a file is read whatever its name, and paths outside the root are refused.
  const named = await findStoryTests(loaded, root, { paths: ["src/estimate.ts", "../outside", "outside", "missing", "test/linked.test.js"] });
  assert.deepEqual(named.tests.map(found => found.name), ["BUILDER-103: not a test file"]);
  assert.deepEqual(named.issues.map(issue => [issue.file, issue.message]), [
    ["../outside", "Points outside the repository."],
    ["outside", "Points outside the repository through a symbolic link."],
    ["missing", "No test files found."],
    ["test/linked.test.js", "Points outside the repository through a symbolic link."],
  ]);

  // Oversized files are reported and skipped.
  await writeFile(join(root, "test/big.test.js"), 'test("BUILDER-101: big", () => {});\n' + " ".repeat(5 * 1024 * 1024));
  const big = await findStoryTests(loaded, root, { paths: ["test/big.test.js"] });
  assert.deepEqual(big.tests, []);
  assert.deepEqual(big.issues.map(issue => [issue.severity, issue.file, issue.message]), [["warning", "test/big.test.js", "Larger than 5 MB, so its tests were not read."]]);

  // Without prefixed story IDs in the map, nothing is tagged.
  const unprefixed = loadStoryMap(sample.replaceAll("BUILDER-", "builder_"));
  assert.deepEqual((await findStoryTests(unprefixed, root, { paths: ["test/calls.js"] })).tests, []);

  // The scan stays linear on hostile input such as many unclosed openers.
  const hostile = 'test.each(' .repeat(20_000) + "test(`".repeat(20_000) + '/"'.repeat(20_000);
  const started = performance.now();
  scanTestCalls(hostile);
  assert.ok(performance.now() - started < 2000, "scans hostile text quickly");
});

test("ESM-801: story-map tests writes an index the board can parse", async t => {
  const root = await storyTestsRepo(t);
  await rm(join(root, "test/linked.test.js"));
  await rm(join(root, "outside"));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, "tests", ...args], { cwd: root, encoding: "utf8" });

  const printed = run("--tests", "test", "map.yaml");
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stderr, "warning: left out tags for stories that are not in the map: BUILDER-999. Run story-map validate --tests to see where they are.\n");
  const index = parseStoryMapTests(printed.stdout);
  assert.equal(index.version, 1);
  assert.equal(index.omitted, undefined);
  assert.deepEqual(index.tests[0], { storyIds: ["BUILDER-101"], file: "test/calls.js", line: 7, name: "BUILDER-101: double quotes", kind: "test" });
  assert.equal(index.tests.length, 17);
  assert.ok(!printed.stdout.includes("BUILDER-999"));
  assert.ok(!printed.stdout.includes('"column"'));

  // With no --tests, the whole root is scanned. The map defaults to product/story-map.yaml.
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), sample);
  const written = run("--out", "out/tests.json");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stderr, /out\/tests\.json: 19 tests for 3 stories\n$/);
  assert.equal(parseStoryMapTests(await readFile(join(root, "out/tests.json"), "utf8")).tests.length, 19);

  assert.equal(run("--tests", "../elsewhere", "map.yaml").status, 2);
  assert.equal(run("--tests", "missing", "map.yaml").status, 2);
  assert.equal(run("--tests").status, 2);
  assert.equal(run("one.yaml", "two.yaml").status, 2);
  await writeFile(join(root, "bad.yaml"), "version: 2\n");
  assert.equal(run("bad.yaml").status, 1);
});

test("ESM-801: the tests index has limits that the writer keeps to", async () => {
  const { buildStoryMapTests } = await import("../dist/tests.js");
  const { loadStoryMap } = await import("../dist/schema.js");
  const loaded = loadStoryMap(sample);
  const found = (count, file, storyIds, name = "BUILDER-101: a test") =>
    Array.from({ length: count }, (_, index) => ({ storyIds, file, line: index + 1, column: 1, name, kind: "test" }));

  const { index, unknownIds } = buildStoryMapTests(loaded, [
    ...found(40, "a.test.js", ["BUILDER-101"]),
    ...found(15, "b.test.js", ["BUILDER-101", "BUILDER-102"]),
    ...found(1, "c.test.js", ["BUILDER-404", "BUILDER-101", "BUILDER-405", "BUILDER-404"], `BUILDER-101: ${"x".repeat(300)}`),
  ], new Date("2026-11-21T12:00:00Z"));
  assert.equal(index.generatedAt, "2026-11-21T12:00:00.000Z");
  assert.deepEqual(unknownIds, ["BUILDER-404", "BUILDER-405"]);
  // BUILDER-101 is listed 50 times. Later tests are kept for BUILDER-102 only, and the rest counted per file.
  assert.equal(index.tests.filter(entry => entry.storyIds.includes("BUILDER-101")).length, 50);
  assert.equal(index.tests.filter(entry => entry.storyIds.includes("BUILDER-102")).length, 15);
  assert.deepEqual(index.omitted, [{ storyId: "BUILDER-101", file: "b.test.js", count: 5 }, { storyId: "BUILDER-101", file: "c.test.js", count: 1 }]);
  assert.equal(index.tests.length, 55);
  assert.deepEqual(parseStoryMapTests(JSON.stringify(index)), index);

  // Names are cut to 250 code points without splitting emoji.
  const long = buildStoryMapTests(loaded, found(1, "a.test.js", ["BUILDER-101"], `BUILDER-101: ${"😀".repeat(300)}`)).index.tests[0].name;
  assert.equal(Array.from(long).length, 250);
  assert.ok(long.endsWith("😀…"));

  // At most 5,000 tests, the rest counted.
  const stories = Array.from({ length: 120 }, (_, n) => `BUILDER-${1000 + n}`);
  const many = loadStoryMap(stringify({ ...map, stories: stories.map(id => ({ ...structuredClone(map.stories[0]), id })) }));
  const capped = buildStoryMapTests(many, stories.flatMap(id => found(50, `${id}.test.js`, [id]))).index;
  assert.equal(capped.tests.length, 5000);
  assert.equal(capped.omitted.reduce((sum, entry) => sum + entry.count, 0), 1000);
  parseStoryMapTests(capped);

  const valid = { version: 1, generatedAt: "2026-11-21T12:00:00.000Z", tests: [{ storyIds: ["BUILDER-101"], file: "a.test.js", line: 1, name: "BUILDER-101: a", kind: "test" }] };
  const entry = valid.tests[0];
  for (const [label, data, message] of [
    ["too many tests", { ...valid, tests: Array(5001).fill(entry) }, /<=5000 items/],
    ["too many for one story", { ...valid, tests: Array(51).fill(entry) }, /more than 50 tests for BUILDER-101/],
    ["a long name", { ...valid, tests: [{ ...entry, name: "x".repeat(251) }] }, /at most 250 characters/],
    ["no stories", { ...valid, tests: [{ ...entry, storyIds: [] }] }, /storyIds/],
    ["a bad kind", { ...valid, tests: [{ ...entry, kind: "suite" }] }, /kind/],
    ["line 0", { ...valid, tests: [{ ...entry, line: 0 }] }, /line/],
    ["a bad version", { ...valid, version: 2 }, /version/],
  ]) {
    assert.throws(() => parseStoryMapTests(data), message, label);
  }
});

test("ESM-801: validate --tests reports unknown tags and active stories without tests", async t => {
  const root = await storyTestsRepo(t);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, "validate", ...args], { cwd: root, encoding: "utf8" });
  // BUILDER-101 is in progress. Tag nothing for it, so the warning shows.
  await writeFile(join(root, "only-102.test.js"), 'test("BUILDER-102: covered", () => {});\ntest("BUILDER-999: unknown", () => {});\n');
  const storyLine = sample.split("\n").findIndex(line => line.includes("status: in-progress")) + 1;

  const text = run("--tests", "only-102.test.js", "map.yaml");
  assert.equal(text.status, 1);
  assert.equal(text.stderr, [
    `map.yaml:${storyLine}:13: warning: stories.0.status (BUILDER-101): No tests are tagged BUILDER-101. Put the story ID in the name of each test that covers it.`,
    "only-102.test.js:2:1: Unknown story ID 'BUILDER-999' in a test name. Add the story to the map or correct the tag.",
    "",
  ].join("\n"));

  const github = run("--format", "github", "--tests", "only-102.test.js", "map.yaml");
  assert.equal(github.status, 1);
  assert.match(github.stdout, /^::warning file=map\.yaml,line=\d+,col=13,title=Story map::stories\.0\.status \(BUILDER-101\): No tests are tagged BUILDER-101\./m);
  assert.match(github.stdout, /^::error file=only-102\.test\.js,line=2,col=1,title=Story map::Unknown story ID 'BUILDER-999'/m);

  // The warning alone passes, unless --strict.
  await writeFile(join(root, "only-102.test.js"), 'test("BUILDER-102: covered", () => {});\n');
  const warned = run("--tests", "only-102.test.js", "map.yaml");
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stdout, /valid \(.*\), 1 warning; checked test tags\n$/);
  assert.equal(run("--strict", "--tests", "only-102.test.js", "map.yaml").status, 1);

  // Tagging the in-progress story clears the warning. Planned and cut stories are never warned about.
  await writeFile(join(root, "only-102.test.js"), 'test("BUILDER-101: covered", () => {});\n');
  const clean = run("--strict", "--plans", "map.yaml", "--tests", "only-102.test.js", "map.yaml");
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /; checked plan references and test tags\n$/);

  // Unreadable paths fail, and without --tests nothing changes.
  assert.equal(run("--tests", "../elsewhere", "map.yaml").status, 1);
  assert.equal(run("--tests", "test", "map.yaml").status, 1);
  assert.equal(run("map.yaml").stderr, "");
});

test("ESM-801: the story panel lists tagged tests by file, linking to each line", () => {
  const tests = parseStoryMapTests({
    version: 1,
    generatedAt: "2026-11-21T12:00:00.000Z",
    tests: [
      { storyIds: ["BUILDER-101"], file: "test/estimate.test.js", line: 4, name: "BUILDER-101: drafts an estimate", kind: "test" },
      { storyIds: ["BUILDER-101", "BUILDER-102"], file: "test/estimate.test.js", line: 9, name: "BUILDER-101 and BUILDER-102 share a total", kind: "test" },
      { storyIds: ["BUILDER-101"], file: "test/ui/form #2.test.js", line: 12, name: "BUILDER-101: form", kind: "group" },
    ],
    omitted: [{ storyId: "BUILDER-101", file: "test/estimate.test.js", count: 3 }],
  });
  const view = getStoryMapForViewer(map, engineer, { tests });
  assert.equal(view.testsIndexed, true);
  const story = view.stories.find(card => card.id === "BUILDER-101");
  assert.deepEqual(story.tests.map(test => `${test.file}:${test.line}`), ["test/estimate.test.js:4", "test/estimate.test.js:9", "test/ui/form #2.test.js:12"]);
  assert.deepEqual(story.moreTests, [{ file: "test/estimate.test.js", count: 3 }]);
  assert.equal(view.stories.find(card => card.id === "BUILDER-103").tests, undefined);

  // Each story's panel, from its opening tag to the next panel.
  const panel = (html, id) => html.split('<div class="esm-detail"').find(part => part.includes(`<p class="esm-card-id">${id}</p>`));
  const linked = renderToStaticMarkup(createElement(StoryMapBoard, { map: view, sourceBaseUrl }));
  const tagged = panel(linked, "BUILDER-101");
  // Between History and Engineering, grouped by file, with the leading tag dropped.
  const withSources = panel(linked, "BUILDER-102");
  assert.ok(withSources.indexOf(">Tests</h4>") > 0 && withSources.indexOf(">Tests</h4>") < withSources.indexOf(">Engineering</h4>"), "Tests comes before Engineering");
  const withHistory = panel(renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer, {
    tests,
    history: { version: 1, generatedAt: "2026-11-21T12:00:00.000Z", complete: true, events: [{ storyId: "BUILDER-101", type: "added", to: "planned", at: "2026-11-01T12:00:00.000Z", commit: "abcdef1" }] },
  }) })), "BUILDER-101");
  assert.ok(withHistory.indexOf(">History</h4>") > 0 && withHistory.indexOf(">History</h4>") < withHistory.indexOf(">Tests</h4>"), "Tests comes after History");
  assert.ok(tagged.indexOf("test/estimate.test.js</code>") < tagged.indexOf("test/ui/form #2.test.js</code>"));
  assert.match(tagged, /href="https:\/\/docs\.example\.test\/repository\/test\/estimate\.test\.js#L4"[^>]*><span class="esm-test-name">drafts an estimate<\/span>/);
  assert.match(tagged, /<span class="esm-test-name">BUILDER-101 and BUILDER-102 share a total<\/span>/);
  assert.match(tagged, /href="https:\/\/docs\.example\.test\/repository\/test\/ui\/form%20%232\.test\.js#L12"/);
  assert.match(tagged, /All tests in this group · line 12/);
  assert.match(tagged, /\+3 more in this file/);
  // The empty state shows only with an index.
  assert.match(panel(linked, "BUILDER-103"), /No tests are tagged BUILDER-103 yet\./);
  const noIndex = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, engineer), sourceBaseUrl }));
  assert.doesNotMatch(noIndex, /esm-tests|No tests are tagged/);

  // Without sourceBaseUrl, files and lines are plain text.
  const plain = panel(renderToStaticMarkup(createElement(StoryMapBoard, { map: view })), "BUILDER-101");
  assert.doesNotMatch(plain, /#L\d/);
  assert.match(plain, /<span><span class="esm-test-name">drafts an estimate<\/span><\/span><span class="esm-test-line">line 4<\/span>/);

  // Paths that could leave the repository are refused when the index is parsed.
  for (const file of ["/etc/passwd", "../outside.test.js", "https://evil.test/x.js", "//evil.test/x.js", "test\\x.js"]) {
    assert.throws(() => parseStoryMapTests({ ...tests, tests: [{ ...tests.tests[0], file }], omitted: undefined }), /relative to the repository root/, file);
  }
});

test("ESM-801: customers never see test names or paths", async () => {
  const tests = parseStoryMapTests({
    version: 1,
    generatedAt: "2026-11-21T12:00:00.000Z",
    tests: map.stories.map((story, index) => ({ storyIds: [story.id], file: "test/secret-path.test.js", line: index + 1, name: `${story.id}: secret test name`, kind: "test" })),
    omitted: [{ storyId: map.stories[0].id, file: "test/secret-omitted.test.js", count: 2 }],
  });
  const customer = getStoryMapForViewer(map, regular, { tests });
  assert.equal(customer.audience, "all-users");
  assert.equal(customer.testsIndexed, undefined);
  for (const path of ["/story-map", "/api/story-map"]) {
    const body = await makeStoryMapResponse(path, map, regular, { sourceBaseUrl, tests }).text();
    assert.doesNotMatch(body, /secret|esm-tests|No tests are tagged|testsIndexed/, path);
  }
  // The engineer's JSON does include them, so the check above is meaningful.
  assert.match(await makeStoryMapResponse("/api/story-map", map, engineer, { tests }).text(), /secret test name/);
});

test("ESM-802: internal cards show how many tests a story has", async () => {
  const tests = parseStoryMapTests({
    version: 1,
    generatedAt: "2026-11-21T12:00:00.000Z",
    tests: [
      { storyIds: ["BUILDER-101"], file: "test/estimate.test.js", line: 4, name: "BUILDER-101: drafts", kind: "test" },
      { storyIds: ["BUILDER-101", "BUILDER-102"], file: "test/estimate.test.js", line: 9, name: "BUILDER-101: totals", kind: "test" },
    ],
    // Tests the index counted but did not list still count on the card.
    omitted: [{ storyId: "BUILDER-101", file: "test/estimate.test.js", count: 5 }],
  });
  const cards = cardsIn(await makeStoryMapResponse("/story-map", map, engineer, { tests }).text());
  const card = id => cards.find(html => html.includes(`>${id}<`));

  assert.match(card("BUILDER-101"), /<span class="esm-card-tests" title="7 tests"><svg[^>]*>.*?<\/svg><span aria-hidden="true">7<\/span><span class="esm-visually-hidden">7 tests<\/span><\/span>/);
  assert.match(card("BUILDER-102"), /title="1 test"/);
  // Between the status and the last change.
  const tagged = card("BUILDER-101");
  assert.ok(tagged.indexOf("esm-status") < tagged.indexOf("esm-card-tests"), "after the status");
  const withHistory = cardsIn(await makeStoryMapResponse("/story-map", map, engineer, {
    tests,
    history: { version: 1, generatedAt: "2026-11-21T12:00:00.000Z", complete: true, events: [{ storyId: "BUILDER-101", type: "added", to: "in-progress", at: "2026-11-20T12:00:00.000Z", commit: "abcdef1" }] },
    now: new Date("2026-11-21T12:00:00Z"),
  }).text()).find(html => html.includes(">BUILDER-101<"));
  assert.ok(withHistory.indexOf("esm-card-tests") < withHistory.indexOf("esm-changed"), "before the last change");
  assert.doesNotMatch(card("BUILDER-103"), /esm-card-tests/);
  assert.doesNotMatch((await makeStoryMapResponse("/story-map", map, engineer).text()), /esm-card-tests/);

  const customer = await makeStoryMapResponse("/story-map", map, regular, { tests }).text();
  assert.doesNotMatch(customer, /esm-card-tests|\d tests?</);
});

// The demo map with estimates on most of the MVP's stories, a shipped and a merged one,
// and the cut story moved into the MVP so the totals have to leave it out.
function withEstimates() {
  return editedSample(document => {
    const story = id => document.stories.find(story => story.id === id);
    Object.assign(story("BUILDER-101"), { status: "shipped", estimate: 5 });
    Object.assign(story("BUILDER-102"), { status: "merged", estimate: 3 });
    Object.assign(story("FINANCE-202"), { release: "builder-mvp", estimate: 8 });
  });
}

test("ESM-503: estimates accept only the story point scale", async () => {
  const { estimatePoints } = await import("auto-story-map");
  assert.deepEqual(estimatePoints, [1, 2, 3, 5, 8, 13]);
  for (const points of estimatePoints) {
    const parsed = editedSample(document => { document.stories[0].estimate = points; });
    assert.equal(parsed.stories[0].estimate, points);
  }
  for (const points of [0, 4, 21, 2.5, "3", -1]) {
    assert.throws(() => editedSample(document => { document.stories[0].estimate = points; }), error =>
      error.issues.length === 1
      && error.issues[0].path.join(".") === "stories.0.estimate"
      && error.issues[0].message === "Use one of 1, 2, 3, 5, 8, 13 story points.", `estimate: ${JSON.stringify(points)}`);
  }
});

test("ESM-503: unestimated planned and in-progress stories are flagged only in releases that use estimates", async t => {
  const { loadStoryMap } = await import("../dist/schema.js");
  // Maps that do not use estimates get no new warnings.
  assert.deepEqual(loadStoryMap(sample).warnings, []);

  const estimated = structuredClone(map);
  estimated.stories.find(story => story.id === "BUILDER-101").estimate = 5;
  const source = stringify(estimated);
  const loaded = loadStoryMap(source);
  // BUILDER-102 and 103 share BUILDER-101's release. FINANCE-201 is in a release with no estimates.
  assert.deepEqual(loaded.warnings.map(({ severity, path, itemId }) => [severity, path.join("."), itemId]), [
    ["warning", "stories.1", "BUILDER-102"],
    ["warning", "stories.2", "BUILDER-103"],
  ]);
  assert.match(loaded.warnings[0].message, /^Add an estimate/);
  assert.equal(loaded.warnings[0].line, source.split("\n").findIndex(text => text.includes("id: BUILDER-102")) + 1);

  // Merged and blocked stories are not flagged, nor are shipped or cut ones.
  const settled = structuredClone(estimated);
  const statuses = { "BUILDER-102": "merged", "BUILDER-103": "blocked" };
  for (const story of settled.stories) if (statuses[story.id]) story.status = statuses[story.id];
  assert.deepEqual(loadStoryMap(stringify(settled)).warnings.filter(warning => /estimate/.test(warning.message)), []);

  const directory = await mkdtemp(join(tmpdir(), "story-map-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, source);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  assert.equal(spawnSync(process.execPath, [cli, "validate", file], { encoding: "utf8" }).status, 0);
  const strict = spawnSync(process.execPath, [cli, "validate", "--strict", file], { encoding: "utf8" });
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /warning: stories\.1 \(BUILDER-102\): Add an estimate/);
});

test("ESM-503: internal releases total their estimates, what is merged and what is left to do", () => {
  const view = getStoryMapForViewer(withEstimates(), engineer);
  const release = id => view.releases.find(release => release.id === id);
  // 5 shipped + 3 merged, so the merged points count as done, not left; BUILDER-103 has no estimate; the cut story's 8 points have left the release.
  assert.deepEqual(release("builder-mvp").estimates, { total: 8, merged: 3, left: 0, unestimated: 1 });
  assert.equal(release("finance-follow-up").estimates, undefined);
  assert.equal(release("reconciliation-internal").estimates, undefined);
  assert.equal(view.stories.find(story => story.id === "BUILDER-102").estimate, 3);
  assert.ok(!("estimate" in view.stories.find(story => story.id === "BUILDER-103")));
  // The totals count the whole release, so filtering the board does not change them.
  const filtered = filterStoryMapView(view, { query: "BUILDER-103" });
  assert.deepEqual(filtered.releases.find(release => release.id === "builder-mvp").estimates, { total: 8, merged: 3, left: 0, unestimated: 1 });

  // Planned and in-progress points are what is left; merged ones are not.
  const mixed = getStoryMapForViewer(editedSample(document => {
    document.stories.find(story => story.id === "BUILDER-103").estimate = 2;
  }, withEstimates()), engineer);
  assert.deepEqual(mixed.releases.find(release => release.id === "builder-mvp").estimates, { total: 10, merged: 3, left: 2, unestimated: 0 });

  // A release whose only estimate is on a cut story has no total.
  const onlyCut = getStoryMapForViewer(editedSample(document => {
    document.stories.find(story => story.id === "FINANCE-202").estimate = 8;
  }), engineer);
  assert.equal(onlyCut.releases.find(release => release.id === "reconciliation-internal").estimates, undefined);
});

test("ESM-503: customers never see estimates", async () => {
  const estimated = withEstimates();
  const view = getStoryMapForViewer(estimated, regular);
  assert.ok(view.stories.length > 0);
  assert.ok(view.stories.every(story => !("estimate" in story)));
  assert.ok(view.releases.every(release => !("estimates" in release)));
  for (const path of ["/story-map", "/api/story-map"]) {
    const payload = await makeStoryMapResponse(path, estimated, regular).text();
    assert.doesNotMatch(payload, /"estimates?"|\d pts|story points/i);
  }
});

test("ESM-503: the board shows estimates on cards, lanes and panels", () => {
  const render = (view, props = {}) => renderToStaticMarkup(createElement(StoryMapBoard, { map: view, ...props }));
  const view = getStoryMapForViewer(withEstimates(), engineer);
  const html = render(filterStoryMapView(view, readStoryMapFilters(new URLSearchParams("status=all"))));

  // Card: top right, on the ID line, with the full wording for screen readers.
  assert.match(html, /<span class="esm-card-head"><span class="esm-card-id">BUILDER-102<\/span><span class="esm-estimate" title="Estimate: 3 points"><span aria-hidden="true">3 pts<\/span><span class="esm-visually-hidden">Estimate: 3 points<\/span><\/span><\/span>/);
  assert.doesNotMatch(html, /<span class="esm-card-head"><span class="esm-card-id">BUILDER-103</);
  // Lane: under the story count, also shown when the lane is collapsed, since CSS does the collapsing.
  assert.match(html, /<span class="esm-release-estimate"><span aria-hidden="true">8 pts · 3 merged · 0 left · 1 unestimated<\/span><span class="esm-visually-hidden">Estimate: 8 points, 3 merged, 0 left to do, 1 story with no estimate<\/span><\/span>/);
  assert.equal(html.match(/class="esm-release-estimate"/g).length, 1);
  // Release panel and story panel.
  assert.match(html, /<p class="esm-release-estimate-note">8 points, 3 merged and waiting to ship, 0 left to do\. 1 story has no estimate\.<\/p>/);
  assert.match(html, /<dt>Estimate<\/dt><dd>3 points<\/dd>/);
  assert.match(html, /<dt>Estimate<\/dt><dd>5 points<\/dd>/);
  assert.equal(html.match(/<dt>Estimate<\/dt>/g).length, 3);
  // One point reads as singular.
  const one = render(getStoryMapForViewer(editedSample(document => { document.stories[0].estimate = 1; }), engineer));
  assert.match(one, />1 pt<\/span>/);
  assert.match(one, /<dd>1 point<\/dd>/);
  assert.match(one, />1 pt · 1 left · 2 unestimated</);

  // Nothing about estimates on a board with none, or for customers.
  assert.doesNotMatch(render(getStoryMapForViewer(map, engineer)), /esm-estimate|esm-release-estimate|<dt>Estimate/);
  assert.doesNotMatch(render(getStoryMapForViewer(withEstimates(), regular)), /esm-estimate|esm-release-estimate|<dt>Estimate|\d pts?\b/);
});

test("ESM-503: diffs show estimate changes, outside the customer-facing comparison", () => {
  const before = withEstimates();
  const after = editedSample(document => {
    const story = id => document.stories.find(story => story.id === id);
    story("BUILDER-102").estimate = 5;
    story("BUILDER-103").estimate = 2;
    delete story("BUILDER-101").estimate;
  }, before);
  const diff = diffStoryMaps(before, after);
  const updates = Object.fromEntries(diff.stories.updated.map(update => [update.id, update]));
  assert.deepEqual(updates["BUILDER-102"].estimate, { from: 3, to: 5 });
  assert.deepEqual(updates["BUILDER-103"].estimate, { to: 2 });
  assert.deepEqual(updates["BUILDER-101"].estimate, { from: 5 });
  assert.deepEqual(updates["BUILDER-102"].details, []);
  assert.equal(diff.customer.length, 0);
  const markdown = formatStoryMapDiff(diff);
  assert.match(markdown, /Estimate: 3 → 5/);
  assert.match(markdown, /Estimate: none → 2/);
  assert.match(markdown, /Estimate: 5 → none/);
  assert.doesNotMatch(markdown, /customer-facing/i);
});

test("ESM-503: exports carry story estimates and release totals", () => {
  const view = getStoryMapForViewer(withEstimates(), engineer);

  const rows = csvRows(storyMapToCsv(view));
  assert.equal(rows[0][4], "Estimate");
  const estimateOf = id => rows.find(row => row[2] === id)[4];
  assert.equal(estimateOf("BUILDER-102"), "3");
  assert.equal(estimateOf("BUILDER-103"), "");
  const collapsed = csvRows(storyMapToCsv(view, { collapsedReleases: ["builder-mvp", "finance-follow-up"] }));
  assert.deepEqual(collapsed.find(row => row[1] === "Builder workflow").slice(3), ["Collapsed · 4 stories", "8 pts · 3 merged · 0 left · 1 unestimated"]);
  assert.equal(collapsed.find(row => row[1] === "Finance follow-up")[4], "");

  const json = JSON.parse(storyMapToJson(view, { now: exportNow }));
  assert.equal(json.stories.find(story => story.id === "BUILDER-102").estimate, 3);
  assert.ok(!("estimate" in json.stories.find(story => story.id === "BUILDER-103")));
  assert.deepEqual(json.releases.find(release => release.id === "builder-mvp").estimates, { total: 8, merged: 3, left: 0, unestimated: 1 });
  assert.ok(!("estimates" in json.releases.find(release => release.id === "finance-follow-up")));

  const files = readStoredZip(storyMapToVsdx(view, { now: exportNow }));
  assert.match(page(files), /BUILDER-102 · 3 pts/);
  assert.doesNotMatch(page(files), /BUILDER-103 · /);
  assert.match(page(files), /<Cell N="Value" V="3" U="STR"\/><Cell N="Label" V="Estimate"\/>/);
  assert.match(page(files), /8 pts · 3 merged · 0 left · 1 unestimated/);
  const collapsedVsdx = page(readStoredZip(storyMapToVsdx(view, { collapsedReleases: ["builder-mvp"], now: exportNow })));
  assert.match(collapsedVsdx, /Collapsed · 4 stories[\s\S]*8 pts · 3 merged · 0 left · 1 unestimated/);
});

test("ESM-912: detail panels slide in from the right as a full-height sheet", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const rule = css.match(/\n\.esm-detail \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /inset: 0 0 0 auto;/, "pinned to the right edge");
  assert.match(rule, /height: 100dvh;/, "full height");
  assert.match(rule, /transform: translateX\(100%\);/, "starts off screen");
  assert.match(css, /\.esm-detail:popover-open \{ transform: none; \}/);
  assert.match(css, /@starting-style \{\n  \.esm-detail:popover-open \{ transform: translateX\(100%\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.esm-detail, \.esm-detail::backdrop \{ transition: none; \}/);
});
