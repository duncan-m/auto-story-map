import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStoryMapPage, localEditOperations, parseStoryMap, proposeStoryMapEdit } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { storyMapChangeOperations, storyMapEditCommand } from "auto-story-map/board.js";
import { edit } from "../dist/commands/edit.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const sample = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
const map = parseStoryMap(sample);
const engineer = { roles: ["engineer"] };
const editing = { endpoint: "/api/story-map/edit", token: "page-token", revision: "abc123" };
const numRuns = Number(process.env.FC_NUM_RUNS) || 60;

/** The Actions menu's form in the panel for BUILDER-103. */
function changeSection(props) {
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("status=all") }), ...props }));
  return /<form class="esm-change-form" aria-label="Change BUILDER-103" data-esm-change="BUILDER-103"[\s\S]*?<\/form>/.exec(html)?.[0];
}

/** The words a POSIX shell makes of a command's arguments, after `npx story-map edit`. */
function shellWords(command) {
  const args = command.replace(/^npx story-map edit /, "");
  const result = spawnSync("sh", ["-c", `set -- ${args}; printf '%s\\0' "$@"`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").slice(0, -1);
}

test("ESM-181: with storyEditing, the Actions menu carries the save props, Save and Copy command", () => {
  const section = changeSection({ storyEditing: editing });
  assert.match(section, /data-esm-edit-endpoint="\/api\/story-map\/edit" data-esm-edit-token="page-token" data-esm-edit-revision="abc123"/);
  const errorId = /aria-describedby="([^"]+-change-error)"/.exec(section)[1];
  assert.match(section, new RegExp(`<p class="esm-form-error esm-change-error" id="${errorId}" role="alert" hidden=""></p>`));
  // Save comes first, then Copy command, with no note and no command to read.
  assert.match(section, /<div class="esm-change-actions"><button type="submit" class="esm-save esm-change-save" data-esm-change-save="" aria-describedby="[^"]+" disabled="">Save<\/button><button type="button" class="esm-change-copy" data-esm-change-copy=""/);
  assert.doesNotMatch(section, /esm-change-note|This board does not save|story-map edit/);
});

test("ESM-181: without storyEditing, or with false, the Actions menu only copies the command", () => {
  for (const props of [{}, { storyEditing: false }, { personaEditing: editing }]) {
    const section = changeSection(props);
    assert.doesNotMatch(section, /data-esm-change-save|data-esm-edit-token|esm-change-error/);
    assert.match(section, /data-esm-change-copy=""/);
    assert.match(section, /This board does not save\./);
  }
});

test("ESM-112: customers never get the save props, even with storyEditing", () => {
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapPage(map, { roles: [] }), storyEditing: editing }));
  assert.doesNotMatch(html, /data-esm-change|page-token/);
});

test("ESM-112: a save sends the same operations as the copied command", () => {
  fc.assert(fc.property(
    fc.option(fc.constantFrom("planned", "in-progress", "merged", "shipped", "blocked", "cut"), { nil: undefined }),
    fc.string({ minLength: 1, maxLength: 40 }).filter(text => text.trim() !== "" && !text.includes("\0")),
    fc.option(fc.constantFrom("v0-7-5", "builder-mvp", "-dashed", "r_2"), { nil: undefined }),
    (status, reason, release) => {
      fc.pre(status !== undefined || release !== undefined);
      const change = { id: "ESM-108", ...(status ? { status } : {}), ...(status === "blocked" || status === "cut" ? { reason } : {}), ...(release ? { release } : {}) };
      assert.deepEqual(storyMapChangeOperations(change), edit.parse(shellWords(storyMapEditCommand(change))).operations);
    },
  ), { numRuns });
});

test("ESM-112: the edit route accepts status and release, and nothing else a story panel could send", () => {
  assert.ok(localEditOperations.includes("status"));
  assert.ok(localEditOperations.includes("release"));
  for (const op of ["title", "summary", "customer-title", "add-job", "remove-job", "add", "estimated-cost", "tokens"]) {
    assert.ok(!localEditOperations.includes(op), `${op} is refused`);
  }
});

// The preview

async function startPreview(t, ...args) {
  const directory = await mkdtemp(join(tmpdir(), "story-map-save-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, sample);
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
  const page = await (await fetch(`${base}/story-map?view=internal&status=all`)).text();
  const form = /<form class="esm-change-form" aria-label="Change BUILDER-103" data-esm-change="BUILDER-103"[^>]*>/.exec(page)?.[0] ?? "";
  const token = /data-esm-edit-token="([^"]+)"/.exec(form)?.[1];
  const revision = /data-esm-edit-revision="([^"]+)"/.exec(form)?.[1];
  return { base, file, page, output, token, revision };
}

function post(base, body, { token, origin = base, type = "application/json" } = {}) {
  return fetch(`${base}/api/story-map/edit`, {
    method: "POST",
    headers: { "Content-Type": type, Origin: origin, ...(token ? { "X-Story-Map-Token": token } : {}) },
    body: JSON.stringify(body),
  });
}

const storyIn = async (file, id) => parseStoryMap(await readFile(file, "utf8")).stories.find(story => story.id === id);

const blockAndMove = storyMapChangeOperations({ id: "BUILDER-103", status: "blocked", reason: "Waiting on finance's sign-off", release: "finance-follow-up" });

test("ESM-112: the preview saves a status, reason and release change from the story panel to the map file", async t => {
  const { base, file, page, output, token, revision } = await startPreview(t);
  assert.ok(token && revision, "each story panel's Actions menu carries the token and revision");
  assert.match(page, /data-esm-change-save=""/);
  assert.match(page, /Edits on the Personas tab and in story panels save to this file\./);
  assert.match(output, /Edits on the Personas tab and in story panels save to the map file\./);

  const response = await post(base, { revision, operations: blockAndMove }, { token });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).changed, true);
  const story = await storyIn(file, "BUILDER-103");
  assert.deepEqual({ status: story.status, statusReason: story.statusReason, release: story.release }, { status: "blocked", statusReason: "Waiting on finance's sign-off", release: "finance-follow-up" });

  // It writes exactly what story-map edit --write writes for the same change.
  const expected = await proposeStoryMapEdit(sample, blockAndMove);
  assert.equal(await readFile(file, "utf8"), expected.source);

  // The next page shows it, with a new revision.
  const next = await (await fetch(`${base}/story-map?view=internal&status=all`)).text();
  assert.match(next, /data-esm-change="BUILDER-103" data-esm-status="blocked" data-esm-release="finance-follow-up"/);
  assert.notEqual(/data-esm-edit-revision="([^"]+)"/.exec(next)[1], revision);

  // Unblocking clears the reason, as edit does.
  const unblock = await post(base, { revision: /data-esm-edit-revision="([^"]+)"/.exec(next)[1], operations: storyMapChangeOperations({ id: "BUILDER-103", status: "planned" }) }, { token });
  assert.equal(unblock.status, 200);
  const after = await storyIn(file, "BUILDER-103");
  assert.equal(after.status, "planned");
  assert.equal(after.statusReason, undefined);
});

test("ESM-112: the preview refuses a change story-map edit would refuse, and writes nothing", async t => {
  const { base, file, token, revision } = await startPreview(t);
  const noReason = await post(base, { revision, operations: [{ op: "status", id: "BUILDER-103", status: "cut" }] }, { token });
  assert.equal(noReason.status, 422);
  assert.match((await noReason.json()).error, /needs a reason/);
  const unknownRelease = await post(base, { revision, operations: [{ op: "release", id: "BUILDER-103", release: "no-such-release" }] }, { token });
  assert.equal(unknownRelease.status, 422);
  const otherField = await post(base, { revision, operations: [{ op: "customer-title", id: "BUILDER-103", title: "Shown to customers" }] }, { token });
  assert.equal(otherField.status, 400);
  assert.equal(await readFile(file, "utf8"), sample);
});

test("ESM-112: the preview refuses a story change from a stale page, another origin, or without the token or JSON", async t => {
  const { base, file, token, revision } = await startPreview(t);
  assert.equal((await post(base, { revision, operations: blockAndMove }, { token, origin: "http://evil.test" })).status, 403);
  assert.equal((await post(base, { revision, operations: blockAndMove }, { token: "wrong-token" })).status, 403);
  assert.equal((await post(base, { revision, operations: blockAndMove })).status, 403);
  assert.equal((await post(base, { revision, operations: blockAndMove }, { token, type: "text/plain" })).status, 415);
  assert.equal(await readFile(file, "utf8"), sample);

  // An agent's edit or a git pull changes the file after the page loaded.
  await writeFile(file, `${sample}# edited elsewhere\n`);
  const stale = await post(base, { revision, operations: blockAndMove }, { token });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /Reload/);
  assert.equal(await readFile(file, "utf8"), `${sample}# edited elsewhere\n`);
});

test("ESM-112: preview --read-only only copies the command and refuses story changes", async t => {
  const { base, file, page, token } = await startPreview(t, "--read-only");
  assert.equal(token, undefined);
  assert.doesNotMatch(page, /data-esm-change-save/);
  assert.match(page, /This board does not save\./);
  assert.equal((await post(base, { revision: "x", operations: blockAndMove }, { token: "x" })).status, 403);
  assert.equal(await readFile(file, "utf8"), sample);
});

// board.js

/** A Change form for BUILDER-103 as board.js sees it, with stand-ins for the page around it. */
function fakeChangeForm({ endpoint = "/api/story-map/edit" } = {}) {
  const listeners = {};
  const fields = {
    "[name=status]": { value: "planned" },
    "[name=release]": { value: "builder-mvp" },
    "[name=reason]": { value: "" },
    "[data-esm-change-reason]": { hidden: true },
    "button[data-esm-change-save]": { disabled: true },
    ".esm-change-error": { hidden: true, textContent: "" },
  };
  const form = {
    dataset: { esmChange: "BUILDER-103", esmStatus: "planned", esmRelease: "builder-mvp", esmReason: "", ...(endpoint ? { esmEditEndpoint: endpoint, esmEditToken: "page-token", esmEditRevision: "abc123" } : {}) },
    closest: () => null,
    querySelector: selector => fields[selector] ?? null,
    addEventListener: (type, handler) => { listeners[type] = handler; },
  };
  return { form, fields, listeners };
}

function stubGlobals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => saved ? Object.defineProperty(globalThis, name, saved) : delete globalThis[name]);
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test("ESM-112: board.js posts the chosen change and reopens the story's panel", async t => {
  const requests = [];
  const visited = [];
  const stored = new Map();
  stubGlobals(t, {
    fetch: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify({ changed: true }), { status: 200 }); },
    location: { href: "http://127.0.0.1:4173/story-map?view=internal&status=all", assign: url => visited.push(url), reload: () => visited.push("reload") },
    history: { state: null, replaceState: () => {} },
    sessionStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) ?? null, removeItem: key => stored.delete(key) },
  });
  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  const { form, fields, listeners } = fakeChangeForm();
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  const save = fields["button[data-esm-change-save]"];
  assert.equal(save.disabled, true, "nothing to save yet");

  fields["[name=status]"].value = "blocked";
  listeners.change();
  assert.equal(save.disabled, true, "a blocked story needs a reason first");
  fields["[name=reason]"].value = "  Waiting on finance  ";
  fields["[name=release]"].value = "finance-follow-up";
  listeners.input();
  assert.equal(save.disabled, false);

  listeners.submit({ preventDefault() {} });
  assert.equal(save.disabled, true, "Save is off while it saves");
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/story-map/edit");
  assert.equal(requests[0].init.headers["Content-Type"], "application/json");
  assert.equal(requests[0].init.headers["X-Story-Map-Token"], "page-token");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    revision: "abc123",
    operations: [
      { op: "status", id: "BUILDER-103", status: "blocked", reason: "Waiting on finance" },
      { op: "release", id: "BUILDER-103", release: "finance-follow-up" },
    ],
  });
  assert.deepEqual(visited, ["http://127.0.0.1:4173/story-map?view=internal&status=all&story=BUILDER-103#esm-story-BUILDER-103"]);
  assert.equal(stored.get("esm-change-saved"), "BUILDER-103");
});

test("ESM-112: board.js reloads when the page is already on the story's panel", async t => {
  const visited = [];
  stubGlobals(t, {
    fetch: async () => new Response("{}", { status: 200 }),
    location: { href: "http://127.0.0.1:4173/story-map?story=BUILDER-103#esm-story-BUILDER-103", assign: url => visited.push(url), reload: () => visited.push("reload") },
    history: { state: null, replaceState: () => {} },
    sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} },
  });
  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  const { form, fields, listeners } = fakeChangeForm();
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  fields["[name=status]"].value = "in-progress";
  listeners.change();
  listeners.submit({ preventDefault() {} });
  await settle();
  assert.deepEqual(visited, ["reload"]);
});

test("ESM-112: board.js shows why a save was refused, such as a stale page, and lets the person try again", async t => {
  stubGlobals(t, {
    fetch: async () => new Response(JSON.stringify({ error: "The map file changed on disk since this page loaded. Reload to see the latest version, then make the edit again. Nothing was saved." }), { status: 409 }),
    location: { href: "http://127.0.0.1:4173/story-map", assign: () => assert.fail("does not navigate"), reload: () => assert.fail("does not reload") },
  });
  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  const { form, fields, listeners } = fakeChangeForm();
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  fields["[name=release]"].value = "finance-follow-up";
  listeners.change();
  listeners.submit({ preventDefault() {} });
  await settle();
  const error = fields[".esm-change-error"];
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /changed on disk since this page loaded/);
  assert.equal(fields["button[data-esm-change-save]"].disabled, false);
});

test("ESM-112: board.js says when the preview cannot be reached", async t => {
  stubGlobals(t, { fetch: async () => { throw new TypeError("Failed to fetch"); } });
  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  const { form, fields, listeners } = fakeChangeForm();
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  fields["[name=release]"].value = "finance-follow-up";
  listeners.change();
  listeners.submit({ preventDefault() {} });
  await settle();
  assert.match(fields[".esm-change-error"].textContent, /Could not reach the preview/);
});

test("ESM-112: board.js never posts from a board without storyEditing", async t => {
  stubGlobals(t, { fetch: async () => assert.fail("does not post") });
  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  const { form, fields, listeners } = fakeChangeForm({ endpoint: "" });
  delete fields["button[data-esm-change-save]"];
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  fields["[name=release]"].value = "finance-follow-up";
  listeners.change();
  listeners.submit({ preventDefault() {} });
  await settle();
});
