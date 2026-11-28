import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkStoryMap, diffStoryMaps, formatStoryMapDiff, getStoryMapForViewer, parseStoryMap, proposeStoryMapEdit, storyMapPlan, storyMapVersion } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packageRoot = new URL("../", import.meta.url);
const guide = await readFile(new URL("docs/story-map.md", packageRoot), "utf8");
const fixture = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");
const withPlans = (folder) => fixture.replace("visibility: all-users\n", `visibility: all-users\nsettings:\n  plans: ${folder}\n`);

/** A scratch host holding a copy of the map, and optionally the guide. */
async function host(t, { map = fixture, withGuide = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-plans-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), map);
  if (withGuide) {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/story-map.md"), guide);
  }
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  return { root, run, read: () => readFile(join(root, "product/story-map.yaml"), "utf8") };
}

const internal = (source) => getStoryMapForViewer(parseStoryMap(source), {}, { canViewInternal: () => true });

test("ESM-148: the guide has a Write a delivery plan section with the question and the parts of a plan", () => {
  const section = guide.slice(guide.indexOf("\n## Write a delivery plan\n"), guide.indexOf("\n## Example\n"));
  assert.ok(section.length > 100, "the section comes before Example");
  assert.match(section, /### Choose whether to use delivery plans/);
  assert.match(section, /> Auto Story Map can keep a delivery plan in this repository .* Do you want to use delivery plans here\? If so, which folder should they go in\? The default is `docs\/plans`\./);
  for (const part of ["A title and a status line", "Why", "Numbered items in build order", "What it builds on", "`## UI mockup`", "`## Decisions to make`", "`## Not now`", "`## Effort and release fit`"]) {
    assert.ok(section.includes(`**${part}**`), `missing part: ${part}`);
  }
  for (const answer of ["Yes", "No", "Not now"]) assert.ok(section.includes(`- **${answer}**`), `missing answer: ${answer}`);
  // The first-run hand-off and the upgrade steps ask too.
  const firstRun = guide.slice(guide.indexOf("## Populate the first map"), guide.indexOf("### Survey a repository"));
  assert.match(firstRun, /ask the person whether to use \[delivery plans\]\(#choose-whether-to-use-delivery-plans\)/);
  assert.match(guide, /## Upgrade to 0\.7\.7\n[\s\S]*?Ask the person the question in \[Choose whether to use delivery plans\]/);
});

test("ESM-153: validate asks for the delivery plans choice as a notice that never fails, even with strict", async t => {
  const result = await checkStoryMap(fixture, { root: (await host(t)).root });
  const notices = result.issues.filter(issue => issue.severity === "notice");
  assert.equal(notices.length, 1);
  assert.equal(result.notices, 1);
  assert.equal(result.issues[0], notices[0], "the notice comes first");
  assert.match(notices[0].message, /^Delivery plans: not chosen yet\. Ask the person whether to use them/);
  // A host whose guide is older links to the section on GitHub at this version's tag.
  assert.ok(notices[0].message.includes(`https://github.com/duncan-m/auto-story-map/blob/v${storyMapVersion}/docs/story-map.md#write-a-delivery-plan`));
  assert.equal(result.warnings, result.issues.filter(issue => issue.severity === "warning").length);

  const strict = await checkStoryMap(fixture.replace(/\n {8}draft: true/g, ""), { strict: true, root: (await host(t)).root });
  assert.equal(strict.notices, 1);
  assert.equal(strict.warnings, 0);
  assert.equal(strict.valid, true, "a notice never fails --strict");

  // A host with the current guide gets its own copy's link.
  const current = await host(t, { withGuide: true });
  const local = await checkStoryMap(fixture, { root: current.root });
  assert.match(local.issues[0].message, /see docs\/story-map\.md#write-a-delivery-plan,/);

  // Once chosen, either way, nothing asks.
  for (const answer of ["docs/plans", "false"]) {
    assert.equal((await checkStoryMap(withPlans(answer), { root: current.root })).notices, 0);
  }
});

test("ESM-153: validate prints the notice in every format", async t => {
  const { run } = await host(t);
  const text = run("validate", "product/story-map.yaml");
  assert.equal(text.status, 0);
  assert.match(text.stderr, /^product\/story-map\.yaml: notice: Delivery plans: not chosen yet\./);
  assert.match(text.stdout, /valid \(.*\)(, \d+ warnings?)?, 1 notice\n/);
  const github = run("validate", "--format", "github", "--strict", "product/story-map.yaml");
  assert.match(github.stdout, /^::notice file=product\/story-map\.yaml,title=choose-delivery-plans::Delivery plans: not chosen yet/);
  const json = JSON.parse(run("validate", "--format", "json", "product/story-map.yaml").stdout);
  assert.equal(json.maps[0].notices, 1);
  assert.equal(json.maps[0].issues[0].severity, "notice");
});

test("ESM-153: settings --plans records the answer, with a dry run first, and diff lists it", async t => {
  const { run, read } = await host(t);
  const dry = run("settings", "--plans", "docs/plans");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\+settings:\n\+  plans: docs\/plans\n/);
  assert.match(dry.stdout, /### Settings\n\n- Delivery plans: kept in `docs\/plans` \(was not chosen\)\./);
  assert.match(dry.stderr, /Dry run: nothing written/);
  assert.equal(await read(), fixture);

  assert.equal(run("settings", "--plans", "docs/plans", "--write").status, 0);
  const saved = await read();
  assert.equal(parseStoryMap(saved).settings.plans, "docs/plans");
  assert.equal(saved.replace("settings:\n  plans: docs/plans\n", ""), fixture, "only the setting is added");

  // An existing settings block keeps its other fields, and off records false.
  assert.equal(run("settings", "--plans", "off", "--write").status, 0);
  assert.equal(parseStoryMap(await read()).settings.plans, false);
  const summary = formatStoryMapDiff(diffStoryMaps(parseStoryMap(saved), parseStoryMap(await read())));
  assert.match(summary, /- Delivery plans: not used \(was kept in `docs\/plans`\)\./);

  const stalled = fixture.replace("visibility: all-users\n", "visibility: all-users\nsettings:\n  stalledAfterWeeks: 6\n");
  const edited = await proposeStoryMapEdit(stalled, [{ op: "plans", plans: "plans" }]);
  assert.match(edited.source, /settings:\n {2}stalledAfterWeeks: 6\n {2}plans: plans\n/);

  // A folder outside the repository is refused, and --plans is required.
  const outside = run("settings", "--plans", "../plans", "--write");
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /settings\.plans: Use a folder inside the repository/);
  assert.equal(run("settings").status, 2);
});

test("ESM-153: check-sources checks the story IDs in the chosen plans folder", async t => {
  const { root, run } = await host(t, { map: withPlans("docs/plans") });
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/example-builder-estimate-plan.md"), "# Example\n\n## Builder workflow\n");
  // A host that said yes but has not written a plan yet is fine.
  assert.equal(run("validate", "--check-sources", "product/story-map.yaml").status, 0);

  await mkdir(join(root, "docs/plans"));
  await writeFile(join(root, "docs/plans/builder.md"), "# Plan\n\nThe work is BUILDER-102 and BUILDER-999.\n");
  const checked = run("validate", "--check-sources", "product/story-map.yaml");
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /docs\/plans\/builder\.md:3:\d+: Unknown story ID 'BUILDER-999'/);
  // --plans docs already covers the folder, so each problem is reported once.
  const both = run("validate", "--check-sources", "--plans", "docs", "product/story-map.yaml");
  assert.equal(both.stderr.match(/BUILDER-999/g).length, 1);
  // Without --check-sources, the plans are not read.
  assert.equal(run("validate", "product/story-map.yaml").status, 0);
});

test("ESM-153: init asks about delivery plans until the map records the answer", async t => {
  const root = await mkdtemp(join(tmpdir(), "story-map-init-plans-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = spawnSync(process.execPath, [cli, "init", "--no-ci", "--dir", root], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^ask {6}delivery plans \(not chosen yet; see docs\/story-map\.md#choose-whether-to-use-delivery-plans\)$/m);
  assert.match(first.stdout, /Then ask me whether to use delivery plans and which story ID policy to use,\n {2}linking to the guide sections listed above, and record my answers with\n {2}`story-map settings`\./);

  const map = join(root, "product/story-map.yaml");
  // The starter map already has settings, from ESM-186's architectureDecisions.
  await writeFile(map, (await readFile(map, "utf8")).replace("settings:\n", "settings:\n  plans: false\n"));
  // Run again, init hands over to the upgrade review, which reports the answer as chosen.
  const again = spawnSync(process.execPath, [cli, "init", "--no-ci", "--dir", root], { encoding: "utf8" });
  assert.doesNotMatch(again.stdout, /^ask +delivery plans/m);
  assert.match(again.stdout, /^Delivery plans +chosen: false/m);
});

test("ESM-149: the example plan follows the guide's structure and ships in the package", async () => {
  const plan = await readFile(new URL("docs/example-builder-estimate-plan.md", packageRoot), "utf8");
  assert.match(plan, /^# Plan: .+\n\nStatus: proposed\. The work is BUILDER-102 and BUILDER-103 in the \*\*Builder workflow\*\* release of the map\./);
  // The sample map's source still resolves.
  assert.match(plan, /^## Builder workflow$/m);
  for (const heading of ["## 1. Look up prices in the material catalogue", "## 2. Submit the estimate to finance", "## What it builds on", "## UI mockup", "## Decisions to make", "## Not now", "## Effort and release fit"]) {
    assert.ok(plan.includes(`\n${heading}\n`), `missing ${heading}`);
  }
  assert.match(plan, /BUILDER-101/);
  assert.match(plan, /FINANCE-202/);
  assert.match(plan, /!\[[^\]]+\]\(example-builder-estimate-mockup\.png\)/);
  const { files } = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
  for (const file of ["docs/example-builder-estimate-plan.md", "docs/example-builder-estimate-mockup.html", "docs/example-builder-estimate-mockup.png"]) {
    assert.ok(files.includes(file), `${file} is not in the package`);
    await readFile(new URL(file, packageRoot));
  }
});

test("ESM-151: plan prints a skeleton filled in from the map", () => {
  const { markdown, path, stories } = storyMapPlan(internal(fixture), { stories: ["BUILDER-102", "BUILDER-103"] });
  assert.deepEqual(stories, ["BUILDER-102", "BUILDER-103"]);
  assert.equal(path, "docs/plans/builder-workflow.md");
  assert.match(markdown, /^# Plan: Builder workflow\n\nStatus: proposed\. The work is BUILDER-102 and BUILDER-103 in the \*\*Builder workflow\*\* release of the map\. None has an agreed estimate yet\.\n/);
  assert.match(markdown, /^1\. \[Look up prices in the material catalogue\]\(#1-look-up-prices-in-the-material-catalogue\) \(BUILDER-102\)$/m);
  assert.match(markdown, /^## 1\. Look up prices in the material catalogue\n\nBUILDER-102\./m);
  for (const heading of ["## What it builds on", "## UI mockup", "## Decisions to make", "## Not now", "## Effort and release fit"]) {
    assert.ok(markdown.includes(`\n${heading}\n`), `missing ${heading}`);
  }
  assert.match(markdown, /\| BUILDER-102: Look up prices in the material catalogue \| not agreed \|\n\| BUILDER-103: Submit the estimate to finance \| not agreed \|\n\| \*\*Total\*\* \| \*\*not agreed\*\* \|/);

  // Estimates come from the map, and a release's planned and in-progress stories in map order.
  const sized = fixture.replace("    status: planned\n    updatedBy: Sam Patel", "    status: planned\n    estimate: 3\n    updatedBy: Sam Patel");
  const release = storyMapPlan(internal(sized), { release: "builder-mvp" }, { plansFolder: "plans/" });
  assert.deepEqual(release.stories, ["BUILDER-101", "BUILDER-102", "BUILDER-103"]);
  assert.equal(release.path, "plans/builder-workflow.md");
  assert.match(release.markdown, /1 of 3 have an agreed estimate\./);
  assert.match(release.markdown, /\| \*\*Total\*\* \| \*\*3, plus 2 not agreed\*\* \|/);
});

test("ESM-151: plan lists the stories the work builds on and overlaps, with their plan links", () => {
  const shipped = fixture.replace("    status: in-progress\n    updatedBy: Alex Morgan", "    status: shipped\n    updatedBy: Alex Morgan\n    sources:\n      - docs/plans/drafting.md#1-draft-an-estimate");
  const { markdown } = storyMapPlan(internal(shipped), { stories: ["BUILDER-102"] });
  const builds = markdown.slice(markdown.indexOf("## What it builds on"), markdown.indexOf("## 1."));
  assert.match(builds, /Merged or shipped:\n\n- \*\*BUILDER-101\*\*, \[Draft an estimate against a project\]\(drafting\.md#1-draft-an-estimate\):/);
  assert.match(builds, /Planned, and overlapping:\n\n- None found nearby\./);
  // A target is never listed as its own neighbour.
  const both = storyMapPlan(internal(shipped), { stories: ["BUILDER-101", "BUILDER-102"] }).markdown;
  assert.doesNotMatch(both.slice(both.indexOf("## What it builds on"), both.indexOf("## 1.")), /BUILDER-10[12]/);
});

test("ESM-151: the plan command prints to standard output and writes nothing", async t => {
  const { root, run } = await host(t, { map: withPlans("docs/plans") });
  const printed = run("plan", "BUILDER-102");
  assert.equal(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /^# Plan: Look up prices in the material catalogue\n/);
  assert.match(printed.stderr, /Suggested path: docs\/plans\/look-up-prices-in-the-material-catalogue\.md\./);
  assert.doesNotMatch(printed.stderr, /notice/);
  await assert.rejects(readFile(join(root, "docs/plans/look-up-prices-in-the-material-catalogue.md")));

  const unknown = run("plan", "BUILDER-120");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Story BUILDER-120 is not in the map\. Did you mean .*BUILDER-102/);
  assert.equal(run("plan").status, 2);
  assert.equal(run("plan", "BUILDER-102", "--release", "builder-mvp").status, 2);

  const unset = await host(t);
  assert.match(unset.run("plan", "--release", "builder-mvp").stderr, /^notice: Delivery plans: not chosen yet\./);
  const declined = await host(t, { map: withPlans("false") });
  const note = declined.run("plan", "BUILDER-102");
  assert.equal(note.status, 0);
  assert.match(note.stderr, /chosen not to keep delivery plans/);
});

test("ESM-150: the AGENTS.md template asks about delivery plans and carries the planning rules", async () => {
  const agents = await readFile(new URL("templates/AGENTS.md", packageRoot), "utf8");
  const plan = agents.slice(agents.indexOf("### Plan the work"), agents.indexOf("### Maintain the map"));
  assert.ok(agents.indexOf("### Populate the first map") < agents.indexOf("### Plan the work"));
  assert.match(plan, /If `settings\.plans` is not set .* ask the person whether to use delivery plans/);
  assert.match(plan, /Only record an answer they gave you\. If they say not now, leave it unset and carry on\./);
  assert.match(plan, /When `settings\.plans` names a folder, write a delivery plan there/);
  assert.match(plan, /Name the merged or shipped stories the work builds on and any planned stories it overlaps/);
  assert.match(plan, /`## UI mockup` section/);
  assert.match(plan, /When a plan has a mockup, screenshot or design/);
  // Links point at sections the guide has.
  for (const [, anchor] of agents.matchAll(/docs\/story-map\.md#([a-z0-9-]+)/g)) {
    assert.ok(guide.includes(`\n## ${anchor.replace(/-/g, " ")}`) || new RegExp(`^#+ ${anchor.replace(/-/g, "[ -]")}$`, "im").test(guide), `no heading for #${anchor}`);
  }
});

test("ESM-150: init says when the AGENTS.md section differs from this version's", async t => {
  const { initStoryMap } = await import("../dist/init.js");
  const root = await mkdtemp(join(tmpdir(), "story-map-agents-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = await readFile(new URL("templates/AGENTS.md", packageRoot), "utf8");
  await writeFile(join(root, "AGENTS.md"), `# Our rules\n\n${template.replace(/### Plan the work[\s\S]*?### Maintain the map/, "### Maintain the map")}`);
  const steps = await initStoryMap(root, { ci: false });
  assert.deepEqual(steps.find(step => step.path === "AGENTS.md"), {
    path: "AGENTS.md",
    action: "skipped",
    reason: "has the story map section, but it differs from this version's; compare it with node_modules/auto-story-map/templates/AGENTS.md",
  });
  assert.doesNotMatch(await readFile(join(root, "AGENTS.md"), "utf8"), /### Plan the work/, "init never replaces the section");

  // Text outside the markers, and Windows line endings, do not count as a difference.
  await writeFile(join(root, "AGENTS.md"), `# Our rules\r\n\r\n${template.replace(/\n/g, "\r\n")}\r\nMore of our rules.\r\n`);
  const current = await initStoryMap(root, { ci: false });
  assert.equal(current.find(step => step.path === "AGENTS.md").reason, "already has the story map section");
});

test("ESM-152: the skill carries the planning rules in full, and the AGENTS.md pointer asks too", async () => {
  const { skillFile } = await import("../dist/init.js");
  const skill = await skillFile();
  assert.match(skill, /^description: .*planning work/m);
  const start = skill.indexOf("## Delivery plans in detail");
  const detail = skill.slice(start, skill.indexOf("\n## ", start + 1));
  assert.ok(detail.length > 100);
  assert.match(detail, /\*\*`settings\.plans` is left out\*\*/);
  assert.match(detail, /\*\*`settings\.plans` is `false`\*\*/);
  assert.match(detail, /\*\*`settings\.plans` names a folder\*\*/);
  assert.match(detail, /\(\.\.\/\.\.\/\.\.\/docs\/story-map\.md#choose-whether-to-use-delivery-plans\)/);
  assert.equal(detail.match(/^\d\. /gm).length, 9, "every part of a plan, in order, with ESM-186's Architecture decisions");
  assert.match(skill, /npx --no-install story-map plan <ID\.\.\.>/);
  // The short rules from AGENTS.md are there too, so agents that read either get them.
  assert.match(skill, /## Plan the work\n\nIf `settings\.plans` is not set/);
  const pointer = await readFile(new URL("templates/AGENTS-skill.md", packageRoot), "utf8");
  assert.match(pointer, /If `settings\.plans` is not set in the map, ask the person whether to use delivery plans/);
});

test("ESM-151: plan escapes table characters in titles and trims the folder's trailing slashes", () => {
  const odd = fixture.replace("title: Submit the estimate to finance", "title: 'Submit a | b \\ c'");
  const { markdown, path } = storyMapPlan(internal(odd), { stories: ["BUILDER-103"] }, { plansFolder: "plans///" });
  assert.match(markdown, /^\| BUILDER-103: Submit a \\\| b \\\\ c \| not agreed \|$/m);
  assert.match(path, /^plans\/[^/]/);
  assert.match(markdown, /release of the map\. It has no agreed estimate yet\.\n/);
});
