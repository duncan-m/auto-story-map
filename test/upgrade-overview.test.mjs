import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  currentSetupTemplateHashes,
  findSetupBehind,
  loadKnownSetupVersions,
  loadSetupChanges,
  maxOverviewLines,
  parseSetupChanges,
  setupChangeParts,
  setupParts,
  stampSetupFile,
  storyMapVersion,
  upgradeOverview,
  upgradeReport,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packaged = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const empty = { agents: {}, guide: {}, workflow: {} };

/** Releases from this one on must have a line for every part their templates changed. */
const coveredFrom = "0.7.0";

const compare = (a, b) => {
  const [x, y] = [a, b].map(version => version.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

async function host(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-overview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package-lock.json"), "{}");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Text as a regular expression that matches it literally. */
const escapeRegExp = text => text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

/** Lines to build overviews from in tests, so they do not change with the shipped file. */
const changes = {
  install: { agents: "Agents follow the rules.", guide: "The guide explains it.", workflow: "CI checks it.", skill: "The skill has the rules." },
  releases: {
    "0.7.8": { agents: ["Agents ask about plans."], guide: ["The guide covers upgrades."] },
    "0.7.6": { agents: ["Agents survey first."], workflow: ["CI checks tests."] },
    "0.7.5": { agents: ["Agents claim stories."] },
  },
};

const file = (part, state, recommendation, extra = {}) => ({ part, kind: "file", title: part, path: part, state, change: "", recommendation, ...extra });
const choice = (part, state) => ({ part, kind: "choice", title: part, path: "map", state, change: "", recommendation: state === "chosen" ? "keep" : "ask" });
const chosen = [choice("plans", "chosen"), choice("storyIds", "chosen")];

test("ESM-168: the shipped changes.yaml has a line for what each part does", async () => {
  const shipped = await loadSetupChanges();
  assert.deepEqual(Object.keys(shipped.install).sort(), [...setupChangeParts].sort());
  for (const part of setupChangeParts) assert.ok(shipped.install[part].length < 200, `${part}'s install line is short`);
  for (const [version, parts] of Object.entries(shipped.releases)) {
    // The skill records no version, so release lines for it would never be shown.
    assert.equal(parts.skill, undefined, `${version} has no skill lines`);
    for (const lines of Object.values(parts)) for (const line of lines) assert.match(line, /^[A-Z].*\.$/, `${version}: one sentence: ${line}`);
  }
  assert.throws(() => parseSetupChanges("install:\n  agents: a\nreleases: {}\n"), /no install line for guide/);
  assert.throws(() => parseSetupChanges(`install: ${JSON.stringify(changes.install)}\nreleases:\n  next: { agents: [a] }\n`), /not a version/);
  assert.throws(() => parseSetupChanges(`install: ${JSON.stringify(changes.install)}\nreleases:\n  "1.0.0": { board: [a] }\n`), /unknown part board/);
});

test("ESM-168: changes.yaml has a line for every release that changed a template, and none for one that did not", async () => {
  const shipped = await loadSetupChanges();
  const known = await loadKnownSetupVersions();
  const current = await currentSetupTemplateHashes();
  const released = [...new Set(setupParts.flatMap(part => Object.values(known[part]).flat()))].sort(compare);
  const newest = released.at(-1);
  /** The template hashes each released version shipped for a part. */
  const shippedBy = (part, version) => new Set(Object.entries(known[part]).filter(([, versions]) => versions.includes(version)).map(([hash]) => hash));
  const same = (a, b) => a.size === b.size && [...a].every(hash => b.has(hash));

  for (const version of Object.keys(shipped.releases)) {
    if (compare(version, newest) <= 0) assert.ok(released.includes(version), `${version} in changes.yaml was never released`);
  }
  for (const part of setupParts) {
    for (const [index, version] of released.entries()) {
      if (index === 0 || compare(version, coveredFrom) < 0) continue;
      const changed = !same(shippedBy(part, version), shippedBy(part, released[index - 1]));
      const lines = shipped.releases[version]?.[part];
      if (changed) assert.ok(lines?.length, `${version} changed the ${part} template, so changes.yaml needs a line for it`);
      else assert.equal(lines, undefined, `${version} did not change the ${part} template, so changes.yaml should have no line for it`);
    }
    // The templates in this checkout are the next release's.
    const changed = !same(current[part], shippedBy(part, newest));
    const next = Object.entries(shipped.releases).filter(([version, parts]) => compare(version, newest) > 0 && parts[part]);
    if (changed) assert.ok(next.length, `the ${part} template changed since ${newest}, so changes.yaml needs a line for it in the next release`);
    else assert.deepEqual(next, [], `the ${part} template has not changed since ${newest}, so changes.yaml should have no line for it in the next release`);
  }
});

test("ESM-168: on install, the overview says what each part being added does, and what to decide", () => {
  const parts = [
    file("agents", "not-added", "add"),
    file("guide", "not-added", "add"),
    file("workflow", "not-added", "add"),
    file("skill", "not-added", "optional"),
    choice("plans", "not-chosen"),
    choice("storyIds", "not-chosen"),
  ];
  assert.deepEqual(upgradeOverview(parts, changes, "0.7.8"), {
    kind: "install",
    heading: "How Auto Story Map works in this repository",
    lines: ["Agents follow the rules.", "The guide explains it.", "CI checks it."],
    decide: "To decide: whether to use delivery plans and the story ID policy.",
    more: "More: docs/story-map.md",
  });
  // A skill the AGENTS.md section points to is added too.
  parts[3] = file("skill", "not-added", "add");
  assert.ok(upgradeOverview(parts, changes, "0.7.8").lines.includes("The skill has the rules."));
});

test("ESM-168: on upgrade, the overview lists only the changes to the parts being applied, newest first", () => {
  const parts = [
    file("agents", "outdated", "replace", { from: "0.7.5" }),
    file("guide", "current", "keep", { from: "0.7.8" }),
    file("workflow", "outdated", "replace", { from: "0.7.6" }),
    file("skill", "not-added", "optional"),
    choice("plans", "not-chosen"),
    choice("storyIds", "chosen"),
  ];
  const overview = upgradeOverview(parts, changes, "0.7.8");
  assert.equal(overview.kind, "upgrade");
  assert.equal(overview.heading, "What changes for you since 0.7.5");
  // Not the guide, which is current, the 0.7.5 agents line, which this host already has, or the 0.7.6 workflow line.
  assert.deepEqual(overview.lines, ["Agents ask about plans.", "Agents survey first."]);
  assert.equal(overview.decide, "To decide: whether to use delivery plans.");
  assert.equal(overview.kept, undefined);
  assert.equal(overview.more, "More: docs/story-map.md#review-the-set-up-after-an-upgrade");
});

test("ESM-168: parts the host edited are kept and named, not described, and an edited workflow gets its new steps", () => {
  const parts = [
    file("agents", "edited-outdated", "review", { from: "0.7.5" }),
    file("guide", "edited-outdated", "review"),
    file("workflow", "edited-outdated", "review", { from: "0.7.5", additions: ["story-map pr-check"] }),
    file("skill", "not-added", "optional"),
    ...chosen,
  ];
  const overview = upgradeOverview(parts, changes, "0.7.8");
  assert.deepEqual(overview.lines, ["CI checks tests."]);
  assert.equal(overview.kept, "Kept as you have them: 2 parts you edited, agents and guide. Run story-map upgrade --diff to compare them with this version.");
  // With no line since the version it came from, the overview names the steps.
  parts[2] = file("workflow", "edited-outdated", "review", { additions: ["story-map pr-check", "story-map diff"] });
  assert.deepEqual(upgradeOverview(parts, { ...changes, releases: {} }, "0.7.8").lines, ["CI runs the story-map pr-check and story-map diff steps too."]);
  // An edited part this version does not change is not mentioned at all.
  const quiet = upgradeOverview([file("agents", "edited", "keep", { from: "0.7.8" }), file("guide", "current", "keep"), file("workflow", "current", "keep"), ...chosen], changes, "0.7.8");
  assert.deepEqual(quiet, { kind: "current", heading: "Nothing to change: your set-up is up to date with 0.7.8", lines: [], more: "More: docs/story-map.md#review-the-set-up-after-an-upgrade" });
});

test("ESM-168: the overview stays short", () => {
  const many = { install: changes.install, releases: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`0.${index + 1}.0`, { guide: [`Change ${index + 1}.`] }])) };
  const lines = upgradeOverview([file("guide", "outdated", "replace", { from: "0.0.1" }), ...chosen], many, "0.12.0").lines;
  assert.equal(lines.length, maxOverviewLines);
  assert.equal(lines[0], "Change 12.");
  assert.equal(lines.at(-1), `And ${12 - maxOverviewLines + 1} more changes from earlier releases.`);
});

test("ESM-168: story-map upgrade opens with the overview in text, Markdown and JSON", async t => {
  const empty = await host(t);
  const install = run(empty, "upgrade");
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /^How Auto Story Map works in this repository\n\n- Agents follow the rules in AGENTS\.md/);
  assert.match(install.stdout, /\nTo decide: whether to use delivery plans and the story ID policy\.\nMore: docs\/story-map\.md\n\nSet-up compared with/);

  // An unedited guide from an earlier version is replaced, so its changes since then are listed.
  const shipped = await loadSetupChanges();
  const [olderVersion] = Object.keys(shipped.releases).filter(version => shipped.releases[version].guide).sort(compare);
  const guide = stampSetupFile("guide", "# Using the story map\n\nAn old guide.\n", olderVersion);
  const root = await host(t);
  assert.equal(run(root, "init", "--dir", root).status, 0);
  await writeFile(join(root, "docs/story-map.md"), guide);
  const report = await upgradeReport({ root, known: empty });
  assert.equal(report.overview.kind, "upgrade");
  assert.equal(report.overview.heading, `What changes for you since ${olderVersion}`);
  const newer = Object.entries(shipped.releases).filter(([version, parts]) => compare(version, olderVersion) > 0 && parts.guide).flatMap(([, parts]) => parts.guide);
  assert.ok(newer.length, "a later release changed the guide");
  for (const line of newer.slice(0, maxOverviewLines - 1)) assert.ok(report.overview.lines.includes(line), line);
  for (const line of shipped.releases[olderVersion].guide) assert.ok(!report.overview.lines.includes(line), `not ${olderVersion}'s own line`);

  const text = run(root, "upgrade");
  assert.match(text.stdout, new RegExp(`^What changes for you since ${escapeRegExp(olderVersion)}\n\n- `));
  const markdown = run(root, "upgrade", "--format", "markdown");
  assert.match(markdown.stdout, new RegExp(`^### What changes for you since ${escapeRegExp(olderVersion)}\n\n- The guide`));
  assert.match(markdown.stdout, /\nMore: docs\/story-map\.md\\#review-the-set-up-after-an-upgrade\n\n### Set-up compared with/);
  const json = JSON.parse(run(root, "upgrade", "--format", "json").stdout);
  assert.equal(json.packageVersion, storyMapVersion);
  assert.equal(json.overview.heading, `What changes for you since ${olderVersion}`);
  assert.ok(Object.keys(json).indexOf("overview") < Object.keys(json).indexOf("parts"), "the overview comes before the parts");
});

test("ESM-168: the validate reminder and the upgrade report agree on an edited workflow that runs every step", async t => {
  const workflow = await packaged("templates/story-map-ci.yml");
  // Recorded from an older template, but the host's edits already run every step this version's does.
  const edited = `# auto-story-map 0.7.0 sha256:${"0".repeat(64)}\n${workflow.replace("lts/*", "22")}`;
  const root = await host(t, { ".github/workflows/story-map.yml": edited });
  const report = await upgradeReport({ root, known: empty });
  assert.equal(report.parts.find(part => part.part === "workflow").state, "edited");
  assert.deepEqual(await findSetupBehind(root, { known: empty }), []);
  // Without a step, both call it behind.
  const missing = edited.replace(/\n {6}- name: Summarise story map changes[\s\S]*?(?=\n {6}- |\n*$)/, "");
  assert.notEqual(missing, edited);
  await writeFile(join(root, ".github/workflows/story-map.yml"), missing);
  assert.equal((await upgradeReport({ root, known: empty })).parts.find(part => part.part === "workflow").state, "edited-outdated");
  assert.deepEqual((await findSetupBehind(root, { known: empty })).map(part => part.part), ["workflow"]);
});
