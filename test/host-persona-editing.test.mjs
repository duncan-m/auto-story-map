import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStoryMapEditServer, getStoryMapPage, parseStoryMap, storyMapEditPath, storyMapRevision } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

const map = `version: 1
id: host-editing
title: Host editing
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
    jobs:
      - id: plan-release
        situation: a release is being planned
        motivation: to agree its scope
        outcome: everyone starts from the same list
        draft: true
stories:
  - id: S-1
    title: Plan a release
    activity: plan
    release: r1
    status: planned
    jobs: [plan-release]
`;

const local = "http://localhost:3000";
const rename = title => [{ op: "set-persona", persona: "pm", title }];

async function mapFile(t) {
  const directory = await mkdtemp(join(tmpdir(), "story-map-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "story-map.yaml");
  await writeFile(file, map);
  return file;
}

function pageRequest(base = local) {
  return new Request(`${base}/story-map?view=personas`, { headers: { Host: new URL(base).host } });
}

function saveRequest(editing, operations, { base = local, origin = base, type = "application/json", token = editing.token, revision = editing.revision, method = "POST", body } = {}) {
  return new Request(`${base}${storyMapEditPath}`, {
    method,
    headers: { Host: new URL(base).host, Origin: origin, "Content-Type": type, "X-Story-Map-Token": token },
    body: method === "GET" ? undefined : body ?? JSON.stringify({ revision, operations }),
  });
}

test("ESM-156: read() returns the file as it is now, so a second save from a fresh read is accepted", async t => {
  const file = await mapFile(t);
  const editor = createStoryMapEditServer({ map: file, authorize: () => true, enabled: true });
  const first = await editor.read(pageRequest());
  assert.equal(first.source, map);
  assert.equal(first.document.personas[0].title, "Product manager");
  assert.equal(first.editing.endpoint, storyMapEditPath);
  assert.equal(first.editing.revision, storyMapRevision(map));

  const saved = await editor.handleRequest(saveRequest(first.editing, rename("Product lead")));
  assert.equal(saved.status, 200);
  const second = await editor.read(pageRequest());
  assert.equal(second.document.personas[0].title, "Product lead", "the save shows on the next load");
  assert.equal(second.editing.revision, storyMapRevision(await readFile(file, "utf8")));

  const again = await editor.handleRequest(saveRequest(second.editing, rename("Release lead")));
  assert.equal(again.status, 200);
  assert.match(await readFile(file, "utf8"), /title: Release lead/);
  assert.match(await readFile(file, "utf8"), /# The person who plans releases\./, "comments are kept");
});

test("ESM-156: read() gives no edit props off this machine, when turned off, in production or when authorize refuses", async t => {
  const file = await mapFile(t);
  const on = createStoryMapEditServer({ map: file, authorize: () => true, enabled: true });
  assert.ok((await on.read(pageRequest())).editing, "on for localhost");
  assert.ok((await on.read(pageRequest("http://127.0.0.1:5173"))).editing, "on for 127.0.0.1");
  assert.ok((await on.read(pageRequest("http://[::1]:3000"))).editing, "on for [::1]");
  assert.equal((await on.read(pageRequest("https://app.example.com"))).editing, undefined, "off for a deployed domain");
  assert.equal((await on.read()).editing, undefined, "off without a request to check");
  assert.equal((await on.read()).source, map, "the map is still read");

  const off = createStoryMapEditServer({ map: file, authorize: () => true, enabled: false });
  assert.equal((await off.read(pageRequest())).editing, undefined, "off with enabled: false");

  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const production = createStoryMapEditServer({ map: file, authorize: () => true });
    assert.equal((await production.read(pageRequest())).editing, undefined, "off in a production build");
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }

  const seen = [];
  const refused = createStoryMapEditServer({ map: file, authorize: async request => { seen.push(request); return false; }, enabled: true });
  const request = pageRequest();
  assert.equal((await refused.read(request)).editing, undefined, "off when authorize refuses");
  assert.deepEqual(seen, [request], "authorize gets the request");
  const status = (await refused.handleRequest(saveRequest(on.editing(map), rename("Product lead")))).status;
  assert.equal(status, 403, "and the save route refuses too");
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-156: handleRequest answers each request as handle() does", async t => {
  const file = await mapFile(t);
  const editor = createStoryMapEditServer({ map: file, authorize: () => true, enabled: true });
  const server = createServer((request, response) => editor.handle(request, response));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const editing = editor.editing(map);

  const cases = [
    ["a GET", [], { method: "GET" }],
    ["another origin", rename("Product lead"), { origin: "http://evil.test" }],
    ["plain text", rename("Product lead"), { type: "text/plain" }],
    ["a wrong token", rename("Product lead"), { token: "x".repeat(32) }],
    ["no operations", [], {}],
    ["not JSON", [], { body: "{" }],
    ["a story edit", [{ op: "status", id: "S-1", status: "shipped" }], {}],
    ["an old page", rename("Product lead"), { revision: "stale" }],
    ["an invalid edit", [{ op: "set-job", job: "plan-release", outcome: "x".repeat(201) }], {}],
    ["a save", rename("Product lead"), {}],
  ];
  for (const [name, operations, options] of cases) {
    await writeFile(file, map);
    const request = saveRequest(editing, operations, { base, ...options });
    const fromFetch = await editor.handleRequest(request.clone());
    const fetchFile = await readFile(file, "utf8");
    await writeFile(file, map);
    const fromNode = await fetch(request);
    assert.equal(fromFetch.status, fromNode.status, name);
    assert.equal(fromFetch.headers.get("content-type"), fromNode.headers.get("content-type"), name);
    assert.equal(fromFetch.headers.get("cache-control"), "private, no-store", name);
    assert.equal(await fromFetch.text(), await fromNode.text(), name);
    assert.equal(fetchFile, await readFile(file, "utf8"), name);
  }

  await writeFile(file, map);
  const large = await editor.handleRequest(saveRequest(editing, rename("x".repeat(70 * 1024)), { base }));
  assert.equal(large.status, 413);
  assert.equal(await readFile(file, "utf8"), map);
});

test("ESM-156: createStoryMapEditServer needs authorize, and says what to pass", () => {
  assert.throws(() => createStoryMapEditServer({ map: "unused.yaml" }), error => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /authorize/);
    assert.match(error.message, /canViewInternal/);
    return true;
  });
});

function render(personaEditing, view = "internal", source = map) {
  const page = getStoryMapPage(parseStoryMap(source), { roles: [] }, { canViewInternal: () => view === "internal", searchParams: new URLSearchParams("view=personas&persona=pm") });
  return renderToStaticMarkup(createElement(StoryMapBoard, { map: page, personaEditing }));
}

test("ESM-156: the board marks the internal Personas tab for board.js and never renders the set-up note", () => {
  const plain = render(undefined);
  assert.match(plain, /class="esm-persona-page" data-esm-internal=""/);
  assert.doesNotMatch(plain, /data-esm-read-only|data-esm-edit-endpoint/);

  const editable = render({ endpoint: "/e", token: "t", revision: "r" });
  assert.match(editable, /data-esm-edit-endpoint="\/e"/);
  assert.doesNotMatch(editable, /data-esm-internal/);

  const off = render(false);
  assert.match(off, /data-esm-internal="" data-esm-read-only=""/, "false says editing is off on purpose");
  assert.doesNotMatch(off, /esm-edit-button/);

  const empty = render(undefined, "internal", map.replace(/personas:[\s\S]*?stories:/, "stories:").replace("    jobs: [plan-release]\n", ""));
  assert.match(empty, /class="esm-persona-setup"[^>]*data-esm-internal=""/, "the no-personas page is marked too");

  for (const html of [plain, editable, off, empty, render(undefined, "customer")]) {
    assert.doesNotMatch(html, /esm-edit-setup-note|not set up/, "the note comes from board.js only");
  }
  assert.doesNotMatch(render(undefined, "customer"), /data-esm-internal/, "customers get no marker");
});
