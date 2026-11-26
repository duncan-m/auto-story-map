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
  findStories,
  getStoryMapForViewer,
  parseStoryMap,
  storyMapReadiness,
  storyMapToJson,
  storyReadinessText,
} from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { makeStoryMapResponse } from "../example/host.mjs";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const sample = parseStoryMap(await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8"));
const engineer = { roles: ["engineer"] };
const regular = { roles: ["member"] };

/**
 * A map with the fixture's activities and releases (builder-mvp, then finance-follow-up, then
 * reconciliation-internal) and one story per entry: [id, release, status, dependsOn].
 */
function mapOf(stories) {
  const document = structuredClone(sample);
  const template = document.stories[0];
  document.stories = stories.map(([id, release, status, dependsOn]) => ({
    id,
    title: `Story ${id}`,
    activity: template.activity,
    release,
    status,
    ...(status === "blocked" || status === "cut" ? { statusReason: "Not going ahead for now." } : {}),
    ...(dependsOn?.length ? { dependsOn } : {}),
  }));
  return parseStoryMap(stringify(document));
}

const mvp = "builder-mvp";
const later = "finance-follow-up";

test("ESM-139: a chain makes each story wait for the one before it, and lists the whole chain", () => {
  const readiness = storyMapReadiness(mapOf([
    ["A-1", mvp, "planned"],
    ["A-2", mvp, "planned", ["A-1"]],
    ["A-3", mvp, "planned", ["A-2"]],
  ]));
  assert.deepEqual(readiness.get("A-1"), { readiness: { state: "ready", blocking: [] }, prerequisites: [], chain: [] });
  assert.equal(readiness.get("A-2").readiness.state, "waiting");
  assert.deepEqual(readiness.get("A-3").readiness, {
    state: "waiting",
    blocking: [{ id: "A-2", title: "Story A-2", status: "planned", release: mvp, sameRelease: true }],
  });
  // Only direct prerequisites block; the chain holds every story upstream, nearest first.
  assert.deepEqual(readiness.get("A-3").prerequisites, ["A-2"]);
  assert.deepEqual(readiness.get("A-3").chain, ["A-2", "A-1"]);
});

test("ESM-139: fan-in waits for every unfinished prerequisite, and fan-out makes each dependent wait", () => {
  const readiness = storyMapReadiness(mapOf([
    ["A-1", mvp, "planned"],
    ["A-2", mvp, "shipped"],
    ["A-3", mvp, "planned"],
    ["A-4", mvp, "planned", ["A-1", "A-2", "A-3"]],
    ["A-5", mvp, "planned", ["A-1"]],
    ["A-6", mvp, "planned", ["A-1"]],
  ]));
  const four = readiness.get("A-4").readiness;
  assert.equal(four.state, "waiting");
  assert.deepEqual(four.blocking.map(item => item.id), ["A-1", "A-3"]);
  assert.equal(storyReadinessText(four), "Waiting for 2 stories: A-1 and A-3 are not merged yet.");
  for (const id of ["A-5", "A-6"]) {
    assert.equal(storyReadinessText(readiness.get(id).readiness), "Waiting for 1 story: A-1 is not merged yet.");
  }
  // A shared prerequisite appears once in the chain.
  assert.deepEqual(readiness.get("A-4").chain, ["A-1", "A-2", "A-3"]);
});

test("ESM-139: independent stories and stories whose prerequisites are merged or shipped are ready", () => {
  const readiness = storyMapReadiness(mapOf([
    ["A-1", mvp, "merged"],
    ["A-2", mvp, "shipped"],
    ["A-3", mvp, "planned", ["A-1", "A-2"]],
    ["A-4", mvp, "planned"],
  ]));
  for (const id of ["A-3", "A-4"]) assert.deepEqual(readiness.get(id).readiness, { state: "ready", blocking: [] });
  // Missing links are unknown, so the text only claims what is on record.
  assert.equal(storyReadinessText(readiness.get("A-4").readiness), "Ready to start: no unfinished prerequisites are recorded.");
});

test("ESM-139: merged, shipped, blocked and cut stories have no readiness", () => {
  const readiness = storyMapReadiness(mapOf([
    ["A-1", mvp, "planned"],
    ["A-2", mvp, "merged", ["A-1"]],
    ["A-3", mvp, "shipped", ["A-1"]],
    ["A-4", mvp, "blocked", ["A-1"]],
    ["A-5", mvp, "cut"],
  ]));
  for (const id of ["A-2", "A-3", "A-4", "A-5"]) assert.ok(!("readiness" in readiness.get(id)), id);
  assert.deepEqual(readiness.get("A-4").prerequisites, ["A-1"]);
});

test("ESM-139: cut, blocked and later-release prerequisites put a story at risk, ahead of waiting", () => {
  const document = mapOf([
    ["A-1", mvp, "cut"],
    ["A-2", mvp, "blocked"],
    ["A-3", later, "planned"],
    ["A-4", mvp, "planned"],
    ["A-5", mvp, "planned", ["A-1", "A-2", "A-3", "A-4"]],
    ["A-6", later, "planned", ["A-4"]],
    ["A-7", mvp, "planned", ["A-8"]],
    ["A-8", later, "merged"],
  ]);
  const readiness = storyMapReadiness(document);
  const five = readiness.get("A-5").readiness;
  assert.equal(five.state, "at-risk");
  assert.deepEqual(five.blocking, [
    { id: "A-1", title: "Story A-1", status: "cut", release: mvp, sameRelease: true, risk: "cut" },
    { id: "A-2", title: "Story A-2", status: "blocked", release: mvp, sameRelease: true, risk: "blocked" },
    { id: "A-3", title: "Story A-3", status: "planned", release: later, sameRelease: false, risk: "later-release" },
    { id: "A-4", title: "Story A-4", status: "planned", release: mvp, sameRelease: true },
  ]);
  const titles = new Map(document.releases.map(release => [release.id, release.title]));
  assert.equal(
    storyReadinessText(five, id => titles.get(id)),
    `At risk: A-1 is cut; A-2 is blocked; A-3 is in a later release, ${titles.get(later)}; A-4 is not merged yet.`,
  );
  // A prerequisite in an earlier release only makes the story wait, and is marked as from another release.
  assert.deepEqual(readiness.get("A-6").readiness, {
    state: "waiting",
    blocking: [{ id: "A-4", title: "Story A-4", status: "planned", release: mvp, sameRelease: false }],
  });
  // A delivered prerequisite in a later release is done, not a risk.
  assert.equal(readiness.get("A-7").readiness.state, "ready");
});

test("ESM-139: an in-progress story that is waiting is warned, never blocked", () => {
  const document = mapOf([
    ["A-1", mvp, "planned"],
    ["A-2", mvp, "in-progress", ["A-1"]],
    ["A-3", mvp, "in-progress"],
  ]);
  const before = structuredClone(document);
  const readiness = storyMapReadiness(document);
  assert.deepEqual(readiness.get("A-2").readiness.startedEarly, true);
  assert.equal(storyReadinessText(readiness.get("A-2").readiness), "Waiting for 1 story: A-1 is not merged yet. It started before it landed.");
  assert.deepEqual(readiness.get("A-3").readiness, { state: "ready", blocking: [] });
  // A pure projection: no status changes.
  assert.deepEqual(document, before);
  assert.equal(getStoryMapForViewer(document, engineer).stories.find(story => story.id === "A-2").status, "in-progress");
});

const panelMap = () => mapOf([
  ["A-1", mvp, "planned"],
  ["A-2", later, "planned"],
  ["A-3", mvp, "planned", ["A-1", "A-2"]],
  ["A-4", mvp, "planned"],
]);

test("ESM-139: the story panel shows readiness beside the status and atop the Dependencies section", () => {
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(panelMap(), engineer) }));
  const panels = html.match(/<div class="esm-detail" id="[^"]+-story-\d+"[\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$)/g);
  const panel = id => panels.find(item => item.includes(`<p class="esm-card-id">${id}</p>`));

  const waiting = panel("A-3");
  assert.match(waiting, /<span class="esm-readiness" data-readiness="at-risk">At risk<\/span>/);
  assert.match(waiting, /Dependencies<\/h4><p class="esm-readiness-note" data-readiness="at-risk">At risk: A-2 is in a later release, [^;<]+; A-1 is not merged yet\. <span class="esm-readiness-caveat">Only recorded dependencies are checked\.<\/span><\/p><h5/);
  // A prerequisite with dependents and none of its own is ready.
  assert.match(panel("A-1"), /data-readiness="ready">Ready to start<\/span>/);
  assert.match(panel("A-1"), /Ready to start: no unfinished prerequisites are recorded\./);
  // A story with no links shows nothing, nor does a story with no readiness.
  assert.doesNotMatch(panel("A-4"), /esm-readiness|Dependencies<\/h4>/);
  const delivered = panelMap();
  delivered.stories.find(story => story.id === "A-3").status = "merged";
  const mergedPanel = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(delivered, engineer) }))
    .match(/<div class="esm-detail" id="[^"]+-story-\d+"[\s\S]*?(?=<div class="esm-detail[" ]|<\/section>$)/g)
    .find(item => item.includes(`<p class="esm-card-id">A-3</p>`));
  assert.match(mergedPanel, /Dependencies<\/h4>/);
  assert.doesNotMatch(mergedPanel, /esm-readiness/);
});

test("ESM-139: the JSON export carries each story's readiness and unfinished prerequisites", () => {
  const json = JSON.parse(storyMapToJson(getStoryMapForViewer(panelMap(), engineer), { now: new Date("2026-01-01T00:00:00Z") }));
  const story = id => json.stories.find(item => item.id === id);
  assert.equal(story("A-3").readiness.state, "at-risk");
  assert.deepEqual(story("A-3").readiness.blocking.map(item => [item.id, item.sameRelease]), [["A-1", true], ["A-2", false]]);
  assert.deepEqual(story("A-4").readiness, { state: "ready", blocking: [] });
  assert.ok(json.completeness.notes.some(note => /readiness/.test(note) && /Links nobody recorded are unknown/.test(note)));
});

test("ESM-139: customers never see readiness", async () => {
  const document = panelMap();
  document.visibility = "all-users";
  document.stories.forEach(story => { story.customer = { title: `Customer ${story.id}` }; });
  const view = getStoryMapForViewer(document, regular);
  assert.ok(view.stories.length > 0);
  assert.ok(view.stories.every(story => !("readiness" in story)));
  for (const path of ["/story-map", "/api/story-map"]) {
    const payload = await makeStoryMapResponse(path, document, regular).text();
    assert.doesNotMatch(payload, /readiness|Ready to start|At risk|esm-readiness/);
  }
});

test("ESM-139: findStories filters by readiness after the board's filters", () => {
  const view = getStoryMapForViewer(panelMap(), engineer);
  const found = findStories(view, { readiness: ["ready"] });
  assert.deepEqual(found.stories.map(story => story.id), ["A-1", "A-2", "A-4"]);
  assert.deepEqual(found.filter.readiness, ["ready"]);
  assert.equal(found.filter.total, 4);
  assert.deepEqual(findStories(view, { readiness: ["waiting", "at-risk"] }).stories.map(story => story.id), ["A-3"]);
});

test("ESM-139: story prints readiness and stories --readiness filters by it", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), stringify(panelMap()));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

  const shown = run("story", "A-3");
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /\n  Readiness: At risk: A-2 is in a later release, finance-follow-up \([^)]+\); A-1 is not merged yet\.\n/);
  assert.doesNotMatch(run("story", "A-4").stdout, /Readiness: (Waiting|At risk)/);

  const listed = run("stories", "--readiness", "ready", "--readiness", "at-risk");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.stdout.trim().split("\n").map(line => line.split(/\s+/)[0]), ["A-1", "A-2", "A-3", "A-4"]);
  assert.deepEqual(run("stories", "--readiness", "waiting,at-risk").stdout.trim().split("\n").map(line => line.split(/\s+/)[0]), ["A-3"]);

  const json = JSON.parse(run("stories", "--readiness", "at-risk", "--format", "json").stdout);
  assert.deepEqual(json.stories.map(story => [story.id, story.readiness.state]), [["A-3", "at-risk"]]);

  const wrong = run("stories", "--readiness", "soon");
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /--readiness must be ready, waiting, at-risk, not soon/);
});
