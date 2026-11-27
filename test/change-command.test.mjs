import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStoryMapForViewer, getStoryMapPage, parseStoryMap } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { shellQuote, storyMapChangeCommand, storyMapEditCommand } from "auto-story-map/board.js";
import { edit } from "../dist/commands/edit.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const sample = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
const map = parseStoryMap(sample);
const engineer = { roles: ["engineer"] };
const numRuns = Number(process.env.FC_NUM_RUNS) || 60;

/** The panel for the story with this title, from its opening tag to the next panel. */
const panelFor = (html, title) => new RegExp(`<div class="esm-detail" id="[^"]+"[^>]*>(?:(?!<div class="esm-detail").)*?<h3 id="[^"]+">${title}</h3>(?:(?!<div class="esm-detail").)*`, "s").exec(html)?.[0];

/** The words a POSIX shell makes of a command's arguments, after `npx story-map edit`. */
function shellWords(command) {
  const args = command.replace(/^npx story-map edit /, "");
  const result = spawnSync("sh", ["-c", `set -- ${args}; printf '%s\\0' "$@"`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").slice(0, -1);
}

test("ESM-181: internal story panels have a hidden Actions menu beside Share, with status, reason and release pickers", () => {
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapPage(map, engineer, { searchParams: new URLSearchParams("status=all") }) }));
  const planned = panelFor(html, "Submit the estimate to finance");
  const head = /<div class="esm-detail-actions">([\s\S]*?)<\/details>/.exec(planned)?.[0] ?? "";
  const menu = /<details class="esm-menu esm-panel-menu esm-change-menu" hidden="">[\s\S]*?<\/details>/.exec(planned);
  assert.ok(menu, "the menu stays hidden until board.js shows it");
  assert.ok(head.includes(menu[0]), "the menu is first in the panel's actions, before Share");
  assert.match(menu[0], /<summary class="esm-copy-link esm-menu-button">.*<span data-esm-copy-label="">Actions<\/span><span class="esm-visually-hidden"> for this story<\/span>/);
  assert.match(menu[0], /<form class="esm-change-form" aria-label="Change BUILDER-103" data-esm-change="BUILDER-103" data-esm-status="planned" data-esm-release="builder-mvp" data-esm-reason="">/);
  assert.doesNotMatch(planned, /esm-change-section|<h4 id="[^"]+">Change<\/h4>/, "the old Change section is gone");

  // The pickers start at the story's status and release, and list every status and release.
  const statuses = /<select class="esm-select" name="status">([\s\S]*?)<\/select>/.exec(menu[0])[1];
  assert.deepEqual([...statuses.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), ["planned", "in-progress", "merged", "shipped", "blocked", "cut"]);
  assert.match(statuses, /<option value="planned" selected="">Planned<\/option>/);
  const releases = /<select class="esm-select" name="release">([\s\S]*?)<\/select>/.exec(menu[0])[1];
  assert.deepEqual([...releases.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), map.releases.map(release => release.id));
  assert.match(releases, /<option value="builder-mvp" selected="">Builder workflow<\/option>/);

  // The reason field is for blocked and cut, so it is hidden here. Copy waits for a change and for
  // board.js, and the command itself is never shown.
  assert.match(menu[0], /<label class="esm-change-field esm-change-reason" data-esm-change-reason="" hidden="">/);
  assert.match(menu[0], /<button type="button" class="esm-change-copy" data-esm-change-copy="" disabled="" hidden="">.*<span>Copy command<\/span><\/button>/);
  assert.doesNotMatch(menu[0], /data-esm-change-command|story-map edit/);
  assert.match(menu[0], /This board does not save\./);

  // A cut story shows its reason, ready to change.
  const cut = panelFor(html, "Explore duplicate approval handling");
  assert.match(cut, /data-esm-status="cut" data-esm-release="reconciliation-internal" data-esm-reason="Finance will handle duplicate approvals manually until volumes justify it\.">/);
  assert.match(cut, /<label class="esm-change-field esm-change-reason" data-esm-change-reason=""><span>Reason<\/span><input class="esm-change-input" placeholder="Why it is blocked or cut" autoComplete="off" name="reason" value="Finance will handle/);
});

test("ESM-111: customer boards have no Actions menu to change a story", () => {
  const customer = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, { roles: [] }) }));
  assert.match(customer, /esm-detail/);
  assert.doesNotMatch(customer, /esm-change|data-esm-change|story-map edit/);
});

test("ESM-111: the command names only what changed, and waits for a reason for blocked and cut", () => {
  const story = { id: "ESM-108", status: "planned", release: "v0-7-7" };
  assert.deepEqual(storyMapChangeCommand(story, { status: "planned", release: "v0-7-7" }), { message: "Choose a new status or release to see its command." });
  assert.deepEqual(storyMapChangeCommand(story, { status: "planned", release: "v0-7-5" }), { command: "npx story-map edit ESM-108 --release v0-7-5 --write" });
  assert.deepEqual(storyMapChangeCommand(story, { status: "in-progress", release: "v0-7-7", reason: "ignored" }), { command: "npx story-map edit ESM-108 --status in-progress --write" });
  assert.deepEqual(storyMapChangeCommand(story, { status: "blocked", release: "v0-7-7", reason: "  " }), { message: "Say why it is blocked to see its command." });
  assert.deepEqual(
    storyMapChangeCommand(story, { status: "cut", release: "v0-8-0", reason: " Not worth it, says Sam's team " }),
    { command: `npx story-map edit ESM-108 --status cut --reason 'Not worth it, says Sam'\\''s team' --release v0-8-0 --write` },
  );

  // A story that stays blocked repeats its status with a new reason, since --reason goes with --status.
  const blocked = { ...story, status: "blocked", reason: "Waiting on the API" };
  assert.deepEqual(storyMapChangeCommand(blocked, { status: "blocked", release: "v0-7-5", reason: "Waiting on the API" }), { command: "npx story-map edit ESM-108 --release v0-7-5 --write" });
  assert.deepEqual(storyMapChangeCommand(blocked, { status: "blocked", release: "v0-7-7", reason: "Waiting on design" }), { command: "npx story-map edit ESM-108 --status blocked --reason 'Waiting on design' --write" });
  assert.deepEqual(storyMapChangeCommand(blocked, { status: "planned", release: "v0-7-7", reason: "Waiting on the API" }), { command: "npx story-map edit ESM-108 --status planned --write" });

  // A value that starts with a hyphen goes after an equals sign, as the parser asks.
  assert.equal(storyMapEditCommand({ id: "ESM-1", status: "blocked", reason: "-1 votes" }), "npx story-map edit ESM-1 --status blocked '--reason=-1 votes' --write");
  assert.equal(shellQuote(""), "''");
  assert.equal(shellQuote("v0-7-5"), "v0-7-5");
});

test("ESM-111: story-map edit's parser reads back every value the command quotes", () => {
  const word = fc.constantFrom("v0-7-5", "builder-mvp", "r_2", "2026.1");
  fc.assert(fc.property(
    fc.constantFrom("planned", "in-progress", "blocked", "cut"),
    // Characters a shell treats specially, mixed with any printable ones.
    fc.string({ minLength: 1, unit: fc.oneof(fc.constantFrom("'", '"', " ", "\\", "$", "`", "!", "-", "=", "\n", ";", "&", "*", "~", "#", "é"), fc.string({ minLength: 1, maxLength: 1, unit: "grapheme" })) })
      .map(text => text.replace(/\0/g, "")).filter(text => text.trim() !== ""),
    fc.option(word, { nil: undefined }),
    (status, reason, release) => {
      const change = { id: "ESM-108", status, ...(status === "blocked" || status === "cut" ? { reason } : {}), ...(release ? { release } : {}) };
      const parsed = edit.parse(shellWords(storyMapEditCommand(change)));
      assert.equal(parsed.write, true);
      assert.deepEqual(parsed.operations, [
        { op: "status", id: "ESM-108", status, ...(change.reason ? { reason } : {}) },
        ...(release ? [{ op: "release", id: "ESM-108", release }] : []),
      ]);
    },
  ), { numRuns });
});

test("ESM-111: a copied command with quotes and spaces makes the change when pasted into a shell", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-change-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), sample);
  const reason = `Finance said "not yet"; it's $HOME's call & that's \`final\``;
  const { command } = storyMapChangeCommand(
    { id: "BUILDER-103", status: "planned", release: "builder-mvp" },
    { status: "blocked", release: "finance-follow-up", reason },
  );
  const result = spawnSync("sh", ["-c", command.replace(/^npx story-map/, `"${process.execPath}" "${cli}"`)], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const story = parseStoryMap(await readFile(join(root, "product/story-map.yaml"), "utf8")).stories.find(item => item.id === "BUILDER-103");
  assert.deepEqual({ status: story.status, statusReason: story.statusReason, release: story.release }, { status: "blocked", statusReason: reason, release: "finance-follow-up" });
});

test("ESM-181: board.js shows the Actions menu, turns Copy on once the pickers change and copies the command without showing it", async t => {
  const written = [];
  const status = { textContent: "" };
  const fields = {
    "[name=status]": { value: "planned" },
    "[name=release]": { value: "builder-mvp" },
    "[name=reason]": { value: "" },
    "[data-esm-change-reason]": { hidden: true },
  };
  const label = { textContent: "Actions", dataset: {} };
  const summary = { dataset: {}, querySelector: () => label };
  const menu = { hidden: true, open: true, querySelector: selector => selector === "summary" ? summary : null };
  const listeners = {};
  const copy = {
    hidden: true,
    disabled: true,
    dataset: {},
    closest: selector => selector === "details.esm-panel-menu" ? menu : null,
    querySelector: () => null,
    addEventListener: (type, handler) => { listeners[`copy-${type}`] = handler; },
  };
  fields["button[data-esm-change-copy]"] = copy;
  const board = { querySelector: selector => selector === "[data-esm-copy-status]" ? status : null };
  const form = {
    dataset: { esmChange: "BUILDER-103", esmStatus: "planned", esmRelease: "builder-mvp", esmReason: "" },
    closest: selector => selector === "details.esm-change-menu" ? menu : selector === ".esm-board" ? board : null,
    querySelector: selector => fields[selector] ?? null,
    addEventListener: (type, handler) => { listeners[type] = handler; },
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async text => { written.push(text); } } }, configurable: true, writable: true });
  t.after(() => saved ? Object.defineProperty(globalThis, "navigator", saved) : delete globalThis.navigator);

  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  assert.equal(menu.hidden, false, "shows the menu");
  assert.equal(copy.hidden, false, "shows Copy with clipboard access");
  assert.equal(copy.disabled, true, "nothing to copy yet");

  // Choosing blocked shows the reason field, and Copy waits for a reason.
  fields["[name=status]"].value = "blocked";
  listeners.change();
  assert.equal(fields["[data-esm-change-reason]"].hidden, false);
  assert.equal(copy.disabled, true);
  fields["[name=reason]"].value = "Waiting on finance's sign-off";
  fields["[name=release]"].value = "finance-follow-up";
  listeners.input();
  assert.equal(copy.disabled, false);

  listeners["copy-click"]();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(written, [`npx story-map edit BUILDER-103 --status blocked --reason 'Waiting on finance'\\''s sign-off' --release finance-follow-up --write`], "copies once, though enhanced twice");
  assert.equal(menu.open, false, "closes the menu");
  assert.equal(label.textContent, "Copied", "the menu's button says it copied");
  assert.equal(status.textContent, "Copied command: BUILDER-103");

  // Going back to planned hides the reason again.
  fields["[name=status]"].value = "planned";
  listeners.change();
  assert.equal(fields["[data-esm-change-reason]"].hidden, true);
});

test("ESM-181: without clipboard access or a save route, the Actions menu stays hidden", async t => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  t.after(() => saved ? Object.defineProperty(globalThis, "navigator", saved) : delete globalThis.navigator);
  const menu = { hidden: true };
  const fields = { "[name=status]": { value: "planned" }, "[name=release]": { value: "builder-mvp" }, "button[data-esm-change-copy]": { hidden: true, addEventListener() {} } };
  const form = {
    dataset: { esmChange: "BUILDER-104", esmStatus: "planned", esmRelease: "builder-mvp", esmReason: "" },
    closest: selector => selector === "details.esm-change-menu" ? menu : null,
    querySelector: selector => fields[selector] ?? null,
    addEventListener() {},
  };
  const { enhanceStoryMapChanges } = await import("auto-story-map/board.js");
  enhanceStoryMapChanges({ querySelectorAll: () => [form] });
  assert.equal(menu.hidden, true);
});
