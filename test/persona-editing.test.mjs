import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStoryMapPage, parseStoryMap, proposeStoryMapEdit, StoryMapEditError } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const map = `version: 1
id: edit-personas
title: Edit personas
visibility: all-users
customer:
  title: Roadmap
activities:
  - id: plan
    title: Plan
releases:
  - id: r1
    title: First release
personas:
  # The person who plans releases.
  - id: pm
    title: Product manager
    summary: Owns the roadmap.
    context:
      success: Releases land on time
      usesToday:
        - Spreadsheets
        - Slack
      draft: true
    jobs:
      - id: plan-release
        situation: a release is being planned
        motivation: to agree its scope
        outcome: everyone starts from the same list
        draft: true
  - id: dev
    title: Developer
stories:
  - id: S-1
    title: Plan a release
    activity: plan
    release: r1
    status: planned
    jobs: [plan-release]
`;

const edit = operations => proposeStoryMapEdit(map, operations);

test("ESM-147: set-persona rewords the title and summary and keeps the ID and comments", async () => {
  const result = await edit([{ op: "set-persona", persona: "pm", title: "Product lead", summary: "Owns the roadmap and the release plan." }]);
  assert.equal(result.valid, true);
  assert.match(result.source, /# The person who plans releases\.\n  - id: pm\n    title: Product lead\n    summary: Owns the roadmap and the release plan\.\n/);
  const persona = parseStoryMap(result.source).personas[0];
  assert.equal(persona.id, "pm");
  assert.deepEqual(persona.jobs.map(job => job.id), ["plan-release"]);
});

test("ESM-147: an empty summary removes it, and a persona without one gains one", async () => {
  const removed = await edit([{ op: "set-persona", persona: "pm", summary: "" }]);
  assert.equal(parseStoryMap(removed.source).personas[0].summary, undefined);
  const added = await edit([{ op: "set-persona", persona: "dev", summary: "Builds the stories." }]);
  assert.match(added.source, /  - id: dev\n    title: Developer\n    summary: Builds the stories\.\n/);
});

test("ESM-147: set-job rewords a job and keeps it a draft", async () => {
  const result = await edit([{ op: "set-job", job: "plan-release", situation: "a release is being planned and its scope is spread across tickets" }]);
  const job = parseStoryMap(result.source).personas[0].jobs[0];
  assert.equal(job.situation, "a release is being planned and its scope is spread across tickets");
  assert.equal(job.motivation, "to agree its scope");
  assert.equal(job.draft, true);
  assert.match(result.summary, /Reworded job `plan-release`/);
});

test("ESM-147: set-persona-context changes only the fields it is given and keeps draft", async () => {
  const result = await edit([{ op: "set-persona-context", persona: "pm", usesToday: ["Spreadsheets", "", "Linear"], constraints: ["No budget for new tools"] }]);
  const context = parseStoryMap(result.source).personas[0].context;
  assert.deepEqual(context, { success: "Releases land on time", usesToday: ["Spreadsheets", "Linear"], constraints: ["No budget for new tools"], draft: true });
});

test("ESM-147: set-persona-context keeps line breaks in success", async () => {
  const result = await edit([{ op: "set-persona-context", persona: "pm", success: "Releases land on time.\nNobody works the weekend." }]);
  assert.equal(result.valid, true);
  assert.match(result.source, /      success: \|-\n        Releases land on time\.\n        Nobody works the weekend\.\n/);
  assert.equal(parseStoryMap(result.source).personas[0].context.success, "Releases land on time.\nNobody works the weekend.");
});

test("ESM-147: set-persona-context adds context to a persona without any, and empties remove fields", async () => {
  const added = await edit([{ op: "set-persona-context", persona: "dev", success: "Stories arrive ready to build" }]);
  assert.deepEqual(parseStoryMap(added.source).personas[1].context, { success: "Stories arrive ready to build" });
  const emptied = await edit([{ op: "set-persona-context", persona: "pm", usesToday: [] }]);
  assert.deepEqual(parseStoryMap(emptied.source).personas[0].context, { success: "Releases land on time", draft: true });
});

test("ESM-147: persona edits refuse an empty context, unknown IDs and no fields", async () => {
  await assert.rejects(edit([{ op: "set-persona-context", persona: "pm", success: "", usesToday: [] }]), /needs at least one of success, uses today and constraints/);
  await assert.rejects(edit([{ op: "set-persona", persona: "pmm", title: "X" }]), error => error instanceof StoryMapEditError && /There is no persona pmm\. Did you mean pm\?/.test(error.message));
  await assert.rejects(edit([{ op: "set-job", job: "plan-releas", outcome: "X" }]), /There is no job plan-releas\. Did you mean plan-release\?/);
  await assert.rejects(edit([{ op: "set-job", job: "plan-release" }]), /Give at least one field to change/);
  await assert.rejects(edit([{ op: "set-job", job: "plan-release", draft: false }]), StoryMapEditError);
});

test("ESM-147: an edit over the schema's limit is not valid, so it cannot be written", async () => {
  const result = await edit([{ op: "set-job", job: "plan-release", outcome: "x".repeat(201) }]);
  assert.equal(result.valid, false);
});

function render(personaEditing, view = "internal") {
  const document = parseStoryMap(map);
  const page = getStoryMapPage(document, { roles: [] }, { canViewInternal: () => view === "internal", searchParams: new URLSearchParams("view=personas&persona=pm") });
  return renderToStaticMarkup(createElement(StoryMapBoard, { map: page, personaEditing }));
}

test("ESM-147: the Personas tab renders edit forms only with personaEditing", () => {
  const readOnly = render(undefined);
  assert.doesNotMatch(readOnly, /esm-edit-button|esm-inline-form|data-esm-edit-endpoint/);

  const editable = render({ endpoint: "/api/story-map/edit", token: "t0ken", revision: "abc" });
  assert.match(editable, /data-esm-edit-endpoint="\/api\/story-map\/edit" data-esm-edit-token="t0ken" data-esm-edit-revision="abc"/);
  assert.match(editable, /<button type="button" class="esm-edit-button"[^>]*aria-label="Edit Product manager"[^>]*hidden=""/, "buttons stay hidden until board.js runs");
  // Title, summary, success and job statements are edited in place, as the text itself.
  assert.match(editable, /<div class="esm-inline-bar" id="([^"]+)"[^>]*data-esm-edit="set-job" data-esm-inline="" data-esm-job="plan-release" hidden="">/);
  assert.match(editable, /<b>When<\/b> <span><span data-esm-editor="[^"]+" data-esm-edit-field="situation" data-esm-label="When" data-esm-max="200" data-esm-required="">a release is being planned<\/span>,<\/span>/);
  assert.match(editable, /<h3 id="[^"]+" data-esm-editor="[^"]+" data-esm-edit-field="title" data-esm-label="Title" data-esm-max="120" data-esm-required="">Product manager<\/h3>/);
  assert.match(editable, /<p data-esm-editor="[^"]+" data-esm-edit-field="success"[^>]*data-esm-multiline=""[^>]*data-esm-placeholder="Not set yet\.">Releases land on time<\/p>/);
  assert.match(editable, /data-esm-edit-field="summary"[^>]*data-esm-multiline=""/, "summaries can have more than one line");
  assert.doesNotMatch(editable, /data-esm-edit-field="(title|situation|motivation|outcome)"[^>]*data-esm-multiline/, "titles and job parts are one line");
  assert.doesNotMatch(editable.replace(/<form[^>]*data-esm-edit="create-(job|persona)"[\s\S]*?<\/form>/g, ""), /<textarea/, "only the forms for a new job or persona have text areas");
  // Uses today and Constraints keep a form, with one row per entry.
  assert.match(editable, /<form class="esm-inline-form"[^>]*data-esm-edit="set-persona-context" data-esm-persona="pm"[^>]*hidden=""><fieldset[^>]*data-esm-list="usesToday"/);
  assert.match(editable, /Stays a draft until a person confirms it\./);
  // Empty context cards appear so they can be filled in.
  assert.match(editable, />Constraints<\/h4>/);
  assert.match(editable, /Not set yet\./);
});

test("ESM-147: list fields add rows by copying one, with no template React would leave empty", () => {
  const editable = render({ endpoint: "/e", token: "t", revision: "r" });
  assert.doesNotMatch(editable, /<template/);
  assert.match(editable, /data-esm-list="constraints" data-esm-max-items="6">[\s\S]*?<div class="esm-field-row"><input [^>]*name="constraints"/, "an empty list still has one row to copy");
});

test("ESM-154: create-job adds a job after the others, with an ID from I want", async () => {
  const result = await edit([{ op: "create-job", persona: "pm", situation: "a release slips", motivation: "to tell customers what moved and why", outcome: "they can plan around it" }]);
  assert.equal(result.valid, true);
  assert.match(result.source, /        draft: true\n      - id: tell-customers-what-moved-and\n        situation: a release slips\n        motivation: to tell customers what moved and why\n        outcome: they can plan around it\n  - id: dev\n/);
  const jobs = parseStoryMap(result.source).personas[0].jobs;
  assert.deepEqual(jobs.map(job => job.id), ["plan-release", "tell-customers-what-moved-and"], "the core job stays first");
  assert.equal(jobs[1].draft, undefined, "a person wrote it, so it is not a draft");
});

test("ESM-154: create-job gives a persona their first job, and never reuses an ID", async () => {
  const first = await edit([{ op: "create-job", persona: "dev", situation: "a story is ready", motivation: "to agree its scope", outcome: "I build the right thing" }]);
  const dev = parseStoryMap(first.source).personas[1];
  assert.deepEqual(dev.jobs.map(job => job.id), ["agree-its-scope"]);
  const clash = await edit([{ op: "create-job", persona: "dev", situation: "a story is ready", motivation: "to plan release", outcome: "it ships" }]);
  assert.equal(parseStoryMap(clash.source).personas[1].jobs[0].id, "plan-release-2");
  await assert.rejects(edit([{ op: "create-job", persona: "dev", id: "plan-release", situation: "a", motivation: "b", outcome: "c" }]), /already a job plan-release/);
  await assert.rejects(edit([{ op: "create-job", persona: "pm", situation: "a", motivation: "", outcome: "c" }]), StoryMapEditError);
});

test("ESM-154: create-job refuses a ninth job", async () => {
  const jobs = Array.from({ length: 7 }, (_, index) => ({ op: "create-job", persona: "pm", situation: "a", motivation: `to do thing ${index}`, outcome: "c" }));
  const full = (await edit(jobs)).source;
  await assert.rejects(proposeStoryMapEdit(full, [{ op: "create-job", persona: "pm", situation: "a", motivation: "to do one more", outcome: "c" }]), /already has 8 jobs/);
});

test("ESM-154: delete-job removes the job and its tag from stories, and keeps the stories", async () => {
  const result = await edit([{ op: "delete-job", job: "plan-release" }]);
  assert.equal(result.valid, true);
  const after = parseStoryMap(result.source);
  assert.equal(after.personas[0].jobs, undefined);
  assert.equal(after.stories[0].id, "S-1");
  assert.equal(after.stories[0].jobs, undefined);
  assert.match(result.source, /    status: planned\n$/);
  await assert.rejects(edit([{ op: "delete-job", job: "plan-releas" }]), /There is no job plan-releas\. Did you mean plan-release\?/);
});

test("ESM-154: delete-job keeps a story's other jobs, and the next job becomes core", async () => {
  const added = (await edit([{ op: "create-job", persona: "pm", situation: "a release slips", motivation: "to tell customers", outcome: "they can plan" }])).source;
  const tagged = (await proposeStoryMapEdit(added, [{ op: "add-job", id: "S-1", job: "tell-customers" }])).source;
  const result = await proposeStoryMapEdit(tagged, [{ op: "delete-job", job: "plan-release" }]);
  const after = parseStoryMap(result.source);
  assert.deepEqual(after.personas[0].jobs.map(job => job.id), ["tell-customers"]);
  assert.deepEqual(after.stories[0].jobs, ["tell-customers"]);
});

test("ESM-154: the Personas tab offers Add job and Delete job only with personaEditing", () => {
  assert.doesNotMatch(render(undefined), /create-job|data-esm-delete/);
  const editable = render({ endpoint: "/e", token: "t", revision: "r" });
  assert.match(editable, /<button type="button" class="esm-edit-button" data-esm-edit-open="([^"]+)" aria-label="Add a job for Product manager"[^>]*hidden="">\+ Add job<\/button><form class="esm-inline-form" id="\1" data-esm-edit="create-job" data-esm-persona="pm"/);
  for (const name of ["situation", "motivation", "outcome"]) assert.match(editable, new RegExp(`<textarea name="${name}" rows="2" maxLength="200" required=""`));
  assert.match(editable, /<button type="button" class="esm-delete" data-esm-delete="the core job" data-esm-delete-consequence="1 story that serves it loses the tag, and stays on the map\. The next job becomes the core job\.">Delete job<\/button>/);
});

test("ESM-155: create-persona adds a persona after the others, with an ID from the title", async () => {
  const result = await edit([{ op: "create-persona", title: "Release Manager", summary: "Decides when a release goes out." }]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.addedPersonaIds, ["release-manager"]);
  assert.match(result.source, /  - id: dev\n    title: Developer\n  - id: release-manager\n    title: Release Manager\n    summary: Decides when a release goes out\.\nstories:\n/);
  const personas = parseStoryMap(result.source).personas;
  assert.deepEqual(personas.map(persona => persona.id), ["pm", "dev", "release-manager"], "everyone keeps their place and colour");
  assert.equal(personas[2].jobs, undefined);
});

test("ESM-155: create-persona leaves out an empty summary, and never reuses an ID", async () => {
  const result = await edit([{ op: "create-persona", title: "Developer", summary: "" }]);
  assert.deepEqual(result.addedPersonaIds, ["developer"]);
  assert.match(result.source, /  - id: developer\n    title: Developer\nstories:\n/);
  const clash = await edit([{ op: "create-persona", title: "PM" }]);
  assert.deepEqual(clash.addedPersonaIds, ["pm-2"]);
  await assert.rejects(edit([{ op: "create-persona", id: "dev", title: "Dev" }]), /already a persona dev/);
  await assert.rejects(edit([{ op: "create-persona", title: " " }]), StoryMapEditError);
});

test("ESM-155: create-persona adds the first persona to a map with none, before the activities", async () => {
  const bare = map.replace(/personas:\n[\s\S]*?(?=stories:)/, "").replace("    jobs: [plan-release]\n", "");
  const result = await proposeStoryMapEdit(bare, [{ op: "create-persona", title: "Product manager" }]);
  assert.equal(result.valid, true);
  assert.match(result.source, /  title: Roadmap\npersonas:\n  - id: product-manager\n    title: Product manager\nactivities:\n/);
});

test("ESM-155: create-persona refuses a thirteenth persona", async () => {
  const full = (await edit(Array.from({ length: 10 }, (_, index) => ({ op: "create-persona", title: `Persona ${index}` })))).source;
  await assert.rejects(proposeStoryMapEdit(full, [{ op: "create-persona", title: "One more" }]), /already has 12 personas/);
});

test("ESM-155: the Personas tab offers Add persona only with personaEditing, in the list and the picker", () => {
  assert.doesNotMatch(render(undefined), /create-persona|Add a persona/);
  const editable = render({ endpoint: "/e", token: "t", revision: "r" });
  const openers = editable.match(/<button type="button" class="esm-edit-button" data-esm-edit-open="([^"]+-add-persona)" aria-label="Add a persona"[^>]*hidden="">\+ Add persona<\/button>/g);
  assert.equal(openers.length, 2, "one in the persona list, one in the picker for small screens");
  assert.match(editable, /<article class="esm-persona-main"[^>]*><form class="esm-inline-form" id="[^"]+-add-persona" data-esm-edit="create-persona" aria-label="Add a persona" hidden="">/);
  assert.match(editable, /<input maxLength="120" required=""[^>]*name="title"\/>/);
  assert.match(editable, /<textarea name="summary" rows="3" maxLength="500"/);
});

test("ESM-155: an empty Personas tab offers Add persona beside the YAML steps", () => {
  const bare = map.replace(/personas:\n[\s\S]*?(?=stories:)/, "").replace("    jobs: [plan-release]\n", "");
  const page = getStoryMapPage(parseStoryMap(bare), { roles: [] }, { canViewInternal: () => true, searchParams: new URLSearchParams("view=personas") });
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: page, personaEditing: { endpoint: "/e", token: "t", revision: "r" } }));
  assert.match(html, /<article class="esm-persona-setup"[^>]*data-esm-edit-endpoint="\/e"/);
  assert.match(html, /No personas yet[\s\S]*data-esm-edit="create-persona"[\s\S]*Or add them to the map file:[\s\S]*<pre>/);
  const readOnly = renderToStaticMarkup(createElement(StoryMapBoard, { map: page }));
  assert.doesNotMatch(readOnly, /create-persona|data-esm-edit-endpoint/);
});

test("ESM-147: customers never get the forms, even with personaEditing", () => {
  assert.doesNotMatch(render({ endpoint: "/e", token: "t", revision: "r" }, "customer"), /esm-inline-form/);
});

// ---------------------------------------------------------------------------
// The writable preview

async function startPreview(t, ...args) {
  const directory = await mkdtemp(join(tmpdir(), "story-map-edit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, map);
  const child = spawn(process.execPath, [cli, "preview", "--port", "0", ...args, file], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  let output = "";
  const base = await new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      output += chunk;
      const found = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
      if (found) resolve(`http://127.0.0.1:${found[1]}`);
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("exit", code => reject(new Error(`preview exited with ${code}: ${output}`)));
  });
  const page = await (await fetch(`${base}/story-map?view=personas&persona=pm`)).text();
  const token = /data-esm-edit-token="([^"]+)"/.exec(page)?.[1];
  const revision = /data-esm-edit-revision="([^"]+)"/.exec(page)?.[1];
  return { base, file, page, token, revision };
}

function post(base, body, { token, origin = base, type = "application/json" } = {}) {
  return fetch(`${base}/api/story-map/edit`, {
    method: "POST",
    headers: { "Content-Type": type, Origin: origin, ...(token ? { "X-Story-Map-Token": token } : {}) },
    body: JSON.stringify(body),
  });
}

const rename = [{ op: "set-persona", persona: "pm", title: "Product lead" }];

test("ESM-147: preview is editable by default and saves a persona edit to the map file", async t => {
  const { base, file, token, revision } = await startPreview(t);
  assert.ok(token && revision, "the page carries the token and revision");
  const response = await post(base, { revision, operations: rename }, { token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.changed, true);
  const saved = await readFile(file, "utf8");
  assert.match(saved, /title: Product lead/);
  assert.match(saved, /# The person who plans releases\./, "comments are kept");
  assert.match(await (await fetch(`${base}/story-map?view=personas&persona=pm`)).text(), />Product lead</);
});

test("ESM-147: preview --writable still works, for commands written for it", async t => {
  const { token, revision } = await startPreview(t, "--writable");
  assert.ok(token && revision);
});

test("ESM-147: preview --read-only has no forms and refuses edits", async t => {
  const { base, file, page } = await startPreview(t, "--read-only");
  assert.doesNotMatch(page, /esm-inline-form|data-esm-edit-token/);
  const response = await post(base, { revision: "x", operations: rename }, { token: "x" });
  assert.equal(response.status, 403);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-147: preview refuses edits from other origins, without JSON or the token", async t => {
  const { base, file, token, revision } = await startPreview(t);
  assert.equal((await post(base, { revision, operations: rename }, { token, origin: "http://evil.test" })).status, 403);
  assert.equal((await post(base, { revision, operations: rename }, { token, type: "text/plain" })).status, 415);
  assert.equal((await post(base, { revision, operations: rename }, { token: "wrong-token" })).status, 403);
  assert.equal((await post(base, { revision, operations: [{ op: "status", id: "S-1", status: "shipped" }] }, { token })).status, 400, "only persona edits");
  assert.equal((await fetch(`${base}/api/story-map/edit`)).status, 405);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-147: preview refuses a save from a page older than the file", async t => {
  const { base, file, token, revision } = await startPreview(t);
  await writeFile(file, `${map}# edited elsewhere\n`);
  const response = await post(base, { revision, operations: rename }, { token });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed on disk since this page loaded/);
  assert.doesNotMatch(await readFile(file, "utf8"), /Product lead/);
});

test("ESM-147: preview explains an edit that would make the map invalid", async t => {
  const { base, file, token, revision } = await startPreview(t);
  const response = await post(base, { revision, operations: [{ op: "set-job", job: "plan-release", outcome: "x".repeat(201) }] }, { token });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).error);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-147: the edit server refuses a non-loopback Host, which stops DNS rebinding", async t => {
  const { base, file, token, revision } = await startPreview(t);
  const { request } = await import("node:http");
  const target = new URL(`${base}/api/story-map/edit`);
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: target.hostname, port: target.port, path: target.pathname, method: "POST", headers: { Host: `evil.test:${target.port}`, Origin: `http://evil.test:${target.port}`, "Content-Type": "application/json", "X-Story-Map-Token": token } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("error", reject);
    req.end(JSON.stringify({ revision, operations: rename }));
  });
  assert.notEqual(status, 200);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-147: createStoryMapEditServer gives the props the board needs", async () => {
  const { createStoryMapEditServer, storyMapRevision } = await import("auto-story-map");
  const server = createStoryMapEditServer({ map: "unused.yaml", authorize: () => true });
  const props = server.editing(map);
  assert.equal(props.endpoint, "/api/story-map/edit");
  assert.equal(props.revision, storyMapRevision(map));
  assert.ok(props.token.length >= 32);
});
