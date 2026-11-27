import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stringify } from "yaml";
import {
  diffStoryMaps,
  formatStoryMapDiff,
  hasStoryMapChanges,
  isStoryMapRuleId,
  needsPersonChanges,
  needsPersonRules,
  parseStoryMap,
} from "auto-story-map";

/** A small valid map with drafts, so each change below needs a person or not. */
const base = () => ({
  version: 1,
  id: "quotes",
  title: "Quotes",
  settings: { plans: false },
  personas: [{
    id: "builder",
    title: "Builder",
    context: { success: "Quotes hold", draft: true },
    jobs: [{ id: "price", situation: "I am pricing a job", motivation: "to use current prices", outcome: "my quote holds", draft: true }],
  }],
  activities: [{ id: "prepare", title: "Prepare" }],
  releases: [{ id: "r1", title: "First", impact: [{ metric: "Quote turnaround", expected: "Down to a day", draft: true }] }],
  stories: [
    { id: "S-1", title: "Price a quote", activity: "prepare", release: "r1", status: "planned", jobs: ["price"] },
    { id: "S-2", title: "Save a quote", activity: "prepare", release: "r1", status: "planned", jobs: ["price"], estimate: 3 },
    { id: "S-3", title: "Send a quote", activity: "prepare", release: "r1", status: "planned", jobs: ["price"] },
  ],
});

const map = (change = () => {}) => {
  const document = base();
  change(document);
  return parseStoryMap(stringify(document));
};

const rows = diff => diff.needsPerson.map(({ rule, itemType, itemId, change }) => [rule, itemType, itemId, change]);

test("ESM-162: a change with nothing for a person has an empty needsPerson list and no section", () => {
  const before = map();
  const after = map(document => {
    document.stories[0].status = "in-progress";
    document.stories[0].summary = "Uses the supplier's price list.";
    document.stories.push({ id: "S-4", title: "Copy a quote", activity: "prepare", release: "r1", status: "planned" });
    document.stories[2].status = "cut";
    document.stories[2].statusReason = "Not needed.";
    // An agent may add drafts and reword them; only removing draft needs a person.
    document.releases[0].impact.push({ metric: "Quotes sent", expected: "Up a tenth", draft: true });
  });
  const diff = diffStoryMaps(before, after);
  assert.deepEqual(diff.needsPerson, []);
  assert.doesNotMatch(formatStoryMapDiff(diff), /Needs a person/);
  assert.deepEqual(diffStoryMaps(before, before).needsPerson, []);
});

test("ESM-162: confirmed drafts are listed for jobs, persona context and impact", () => {
  const diff = diffStoryMaps(map(), map(document => {
    delete document.personas[0].jobs[0].draft;
    delete document.personas[0].context.draft;
    delete document.releases[0].impact[0].draft;
  }));
  assert.deepEqual(rows(diff), [
    ["draft-confirmed", "job", "price", "confirmed drafted job"],
    ["draft-confirmed", "persona", "builder", "confirmed drafted context"],
    ["draft-confirmed", "release", "r1", "confirmed drafted impact “Quote turnaround”"],
  ]);
  const markdown = formatStoryMapDiff(diff);
  assert.match(markdown, /### Needs a person\n\n`AGENTS\.md` leaves these changes to people\. Check that a person made or agreed each one\.\n\n- \*\*Draft confirmed:\*\* job `price` \(Builder\): confirmed drafted job \(`draft-confirmed`\)\n/);
  assert.match(markdown, /- \*\*Draft confirmed:\*\* release `r1` First: confirmed drafted impact “Quote turnaround” \(`draft-confirmed`\)\n/);
});

test("ESM-162: estimates set, changed or removed are listed, including on new stories", () => {
  const diff = diffStoryMaps(map(), map(document => {
    document.stories[0].estimate = 5;
    delete document.stories[1].estimate;
    document.stories.push({ id: "S-4", title: "Copy a quote", activity: "prepare", release: "r1", status: "planned", estimate: 2 });
  }));
  assert.deepEqual(rows(diff), [
    ["estimate-changed", "story", "S-4", "none → 2"],
    ["estimate-changed", "story", "S-1", "none → 5"],
    ["estimate-changed", "story", "S-2", "3 → none"],
  ]);
  assert.match(formatStoryMapDiff(diff), /- \*\*Estimate:\*\* story `S-1` Price a quote: none → 5 \(`estimate-changed`\)\n/);
  assert.deepEqual(rows(diffStoryMaps(map(), map(document => { document.stories[1].estimate = 5; }))), [["estimate-changed", "story", "S-2", "3 → 5"]]);
});

test("ESM-162: removed stories are listed, and one that comes back under a new ID as a possible renumber", () => {
  const diff = diffStoryMaps(map(), map(document => {
    document.stories.splice(1, 2);
    document.stories.push({ id: "S-9", title: "save a  quote", activity: "prepare", release: "r1", status: "planned" });
  }));
  assert.deepEqual(rows(diff), [
    ["possible-renumber", "story", "S-2", "removed, and S-9 was added with the same title"],
    ["story-removed", "story", "S-3", "removed rather than cut"],
  ]);
  assert.equal(diff.needsPerson[0].addedId, "S-9");
  const markdown = formatStoryMapDiff(diff);
  assert.match(markdown, /- \*\*Possible renumber:\*\* story `S-2` Save a quote: removed, and S-9 was added with the same title \(`possible-renumber`\)\n/);
  assert.match(markdown, /- \*\*Story removed:\*\* story `S-3` Send a quote: removed rather than cut \(`story-removed`\)\n/);
});

test("ESM-162: customer copy added or changed, and a switch to all-users, are listed", () => {
  const visible = document => {
    document.visibility = "all-users";
    document.customer = { title: "Your quotes" };
    document.activities[0].customer = { title: "Prepare" };
    document.releases[0].customer = { title: "Soon" };
    document.stories[0].customer = { title: "Price a quote" };
  };
  const opened = diffStoryMaps(map(), map(visible));
  assert.deepEqual(rows(opened), [
    ["customer-copy-changed", "map", "quotes", "visibility switched to all-users"],
    ["customer-copy-changed", "map", "quotes", "added customer copy"],
    ["customer-copy-changed", "activity", "prepare", "added customer copy"],
    ["customer-copy-changed", "release", "r1", "added customer copy"],
    ["customer-copy-changed", "story", "S-1", "added customer copy"],
  ]);
  const reworded = diffStoryMaps(map(visible), map(document => {
    visible(document);
    document.stories[0].customer.summary = "Uses today's prices.";
    document.personas[0].customer = { title: "Builders" };
  }));
  assert.deepEqual(rows(reworded), [
    ["customer-copy-changed", "persona", "builder", "added customer copy"],
    ["customer-copy-changed", "story", "S-1", "changed customer copy"],
  ]);
  // Removing copy or switching back to internal shows customers less, so it does not need a person.
  assert.deepEqual(diffStoryMaps(map(visible), map(document => { visible(document); document.visibility = "internal"; delete document.stories[0].customer; })).needsPerson, []);
  const markdown = formatStoryMapDiff(opened);
  assert.ok(markdown.indexOf("### Customer-facing changes") < markdown.indexOf("### Needs a person"), "Needs a person follows Customer-facing changes");
  assert.ok(markdown.indexOf("### Needs a person") < markdown.indexOf("### Stories"));
  assert.match(markdown, /- \*\*Customer copy:\*\* map `quotes` Quotes: visibility switched to all-users \(`customer-copy-changed`\)\n/);
});

test("ESM-162: settings changes are listed, even ones the diff has no line for", () => {
  const diff = diffStoryMaps(map(), map(document => {
    document.settings = { plans: "docs/plans", storyIds: "lowest-free", stalledAfterWeeks: 4 };
  }));
  assert.deepEqual(rows(diff), [
    ["settings-changed", "map", "plans", "false → \"docs/plans\""],
    ["settings-changed", "map", "stalledAfterWeeks", "not set → 4"],
    ["settings-changed", "map", "storyIds", "not set → \"lowest-free\""],
  ]);
  assert.match(formatStoryMapDiff(diff), /- \*\*Setting:\*\* setting `plans`: false → "docs\/plans" \(`settings-changed`\)\n/);
  // Setting the stalled threshold to its default has no Settings line, but it is still a change to the file.
  const defaulted = diffStoryMaps(map(), map(document => { document.settings.stalledAfterWeeks = 4; }));
  assert.equal(defaulted.stalledAfterWeeks, undefined);
  assert.equal(hasStoryMapChanges(defaulted), true);
  assert.match(formatStoryMapDiff(defaulted), /### Needs a person/);
  // A new map has no earlier settings to compare.
  assert.deepEqual(diffStoryMaps(null, map()).needsPerson.filter(change => change.rule === "settings-changed"), []);
});

test("ESM-162: needsPersonChanges is exported for other comparisons, and each rule is a validation rule", () => {
  const before = map();
  const after = map(document => { document.stories[0].estimate = 1; });
  const diff = diffStoryMaps(before, after);
  assert.deepEqual(needsPersonChanges(before, after, diff), diff.needsPerson);
  assert.deepEqual([...needsPersonRules], ["draft-confirmed", "estimate-changed", "story-removed", "possible-renumber", "customer-copy-changed", "settings-changed"]);
  for (const rule of needsPersonRules) assert.ok(isStoryMapRuleId(rule), `${rule} is in storyMapRules`);
});

test("ESM-162: story-map diff shows Needs a person in Markdown and needsPerson in JSON", async t => {
  const root = await mkdtemp(join(tmpdir(), "esm-needs-person-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), stringify(base()));
  git("add", "-A");
  git("commit", "-q", "-m", "add map");

  const quiet = JSON.parse(run("diff", "--format", "json", "HEAD").stdout);
  assert.deepEqual(quiet.needsPerson, []);

  const document = base();
  document.stories[0].estimate = 8;
  await writeFile(join(root, "product/story-map.yaml"), stringify(document));
  const markdown = run("diff", "HEAD");
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /### Needs a person\n\n[^\n]+\n\n- \*\*Estimate:\*\* story `S-1` Price a quote: none → 8 \(`estimate-changed`\)\n/);
  const json = JSON.parse(run("diff", "--format", "json", "HEAD").stdout);
  assert.deepEqual(json.needsPerson, [{ rule: "estimate-changed", itemType: "story", itemId: "S-1", title: "Price a quote", change: "none → 8" }]);
});
