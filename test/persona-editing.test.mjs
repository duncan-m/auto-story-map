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
  assert.doesNotMatch(editable, /<textarea/);
  // Uses today and Constraints keep a form, with one row per entry.
  assert.match(editable, /<form class="esm-inline-form"[^>]*data-esm-edit="set-persona-context" data-esm-persona="pm"[^>]*hidden=""><fieldset[^>]*data-esm-list="usesToday"/);
  assert.match(editable, /Stays a draft until a person confirms it\./);
  // Empty context cards appear so they can be filled in.
  assert.match(editable, />Constraints<\/h4>/);
  assert.match(editable, /Not set yet\./);
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

test("ESM-147: preview --writable saves a persona edit to the map file", async t => {
  const { base, file, token, revision } = await startPreview(t, "--writable");
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

test("ESM-147: the read-only preview has no forms and refuses edits", async t => {
  const { base, file, page } = await startPreview(t);
  assert.doesNotMatch(page, /esm-inline-form|data-esm-edit-token/);
  const response = await post(base, { revision: "x", operations: rename }, { token: "x" });
  assert.equal(response.status, 403);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-147: preview --writable refuses edits from other origins, without JSON or the token", async t => {
  const { base, file, token, revision } = await startPreview(t, "--writable");
  assert.equal((await post(base, { revision, operations: rename }, { token, origin: "http://evil.test" })).status, 403);
  assert.equal((await post(base, { revision, operations: rename }, { token, type: "text/plain" })).status, 415);
  assert.equal((await post(base, { revision, operations: rename }, { token: "wrong-token" })).status, 403);
  assert.equal((await post(base, { revision, operations: [{ op: "status", id: "S-1", status: "shipped" }] }, { token })).status, 400, "only persona edits");
  assert.equal((await fetch(`${base}/api/story-map/edit`)).status, 405);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-147: preview --writable refuses a save from a page older than the file", async t => {
  const { base, file, token, revision } = await startPreview(t, "--writable");
  await writeFile(file, `${map}# edited elsewhere\n`);
  const response = await post(base, { revision, operations: rename }, { token });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed on disk since this page loaded/);
  assert.doesNotMatch(await readFile(file, "utf8"), /Product lead/);
});

test("ESM-147: preview --writable explains an edit that would make the map invalid", async t => {
  const { base, file, token, revision } = await startPreview(t, "--writable");
  const response = await post(base, { revision, operations: [{ op: "set-job", job: "plan-release", outcome: "x".repeat(201) }] }, { token });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).error);
  assert.equal(await readFile(file, "utf8"), map);
});
