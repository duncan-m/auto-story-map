// ESM-186: the review step and architecture decisions, as hosts receive them from init and the upgrade review.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyUpgrade, parseStoryMap, setupBody, storyMapPlan, upgradeReport } from "auto-story-map";
import { planArchitectureProblems } from "../dist/plan-architecture.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/upgrade-0.7.5", import.meta.url));
const packaged = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
const read = (root, path) => readFile(join(root, path), "utf8");
const settings = async root => parseStoryMap(await read(root, "product/story-map.yaml")).settings;
/** The text of a rule in a template, after its marker. */
const ruleText = (template, id) => new RegExp(`<!-- rule: ${id} -->\\n([^\\n]+)\\n`).exec(template)[1];
/** `validate --strict --check-sources`, as a host's CI runs it. */
const strict = root => run(root, "validate", "--strict", "--check-sources", "product/story-map.yaml");

async function host(t, from) {
  const root = await mkdtemp(join(tmpdir(), "story-map-hosts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (from) await cp(from, root, { recursive: true });
  else await writeFile(join(root, "package-lock.json"), "{}");
  return root;
}

async function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** An open plan with no architecture section, as hosts' plans from before 0.7.11 are. */
const openPlan = "# Plan: price lookup\n\nStatus: proposed. The work is not in the map yet.\n\n## 1. Look up prices\n\nLook up each line's price in the catalogue.\n";

/** Gives a 0.7.5 host's map the delivery plans answer, as `story-map settings --plans` records it. */
async function choosePlans(root, plans) {
  const map = await read(root, "product/story-map.yaml");
  await write(root, { "product/story-map.yaml": map.replace("visibility: internal\n", `visibility: internal\nsettings:\n  plans: ${plans}\n`) });
}

test("ESM-186: an old host with an edited AGENTS.md section keeps its edits and is offered both new rules", async t => {
  const root = await host(t, fixture);
  const original = await read(root, "AGENTS.md");
  const reworded = "A story's `estimate` is agreed by the whole team in Monday planning. Never set one yourself.";
  const own = "Deploy from main only, after the release notes are agreed.";
  const edited = original
    .replace(/^A story's `estimate` is the team's agreed size[^\n]+$/m, reworded)
    .replace("### Branches and pull requests\n", `### Branches and pull requests\n\n${own}\n`);
  assert.notEqual(edited, original);
  await write(root, { "AGENTS.md": `# Fixture host\n\nOur own notes for agents.\n\n${edited}` });

  // The review offers both rules as new, and keeps the host's reworded and own rules.
  const report = await upgradeReport({ root });
  const agents = report.parts.find(part => part.part === "agents");
  assert.equal(agents.state, "edited-outdated");
  const rules = Object.fromEntries(agents.rules.map(rule => [rule.id ?? rule.title, rule]));
  for (const id of ["review-before-ready", "architecture-decisions"]) assert.deepEqual([rules[id].state, rules[id].recommendation], ["new", "add"], id);
  assert.equal(rules["agreed-estimates"].text, reworded);
  assert.notEqual(rules["agreed-estimates"].recommendation, "replace", "a reworded rule is never replaced");
  assert.equal(agents.rules.find(rule => rule.text === own)?.state, "added");
  assert.match(agents.change, /new rules to add/);

  // The dry run says it will record the setting, and writes nothing.
  const dry = run(root, "upgrade", "--mode", "simple");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^Architecture decisions +record +record "required" in settings\.architectureDecisions/m);
  assert.match(dry.stdout, /Records required in settings\.architectureDecisions, since the AGENTS\.md section now asks for architecture decisions\./);
  assert.match(dry.stdout, /story-map settings --architecture-decisions recommended --write/);
  assert.equal(await settings(root), undefined);

  const applied = run(root, "upgrade", "--mode", "simple", "--write");
  assert.equal(applied.status, 0, applied.stderr);
  const after = await read(root, "AGENTS.md");
  const template = await packaged("templates/AGENTS.md");
  assert.ok(after.startsWith("# Fixture host\n\nOur own notes for agents.\n\n"), "the rest of AGENTS.md is the host's");
  assert.ok(after.includes(`\n${reworded}\n`), "the reworded rule is kept");
  assert.ok(after.includes(`\n${own}\n`), "the host's own rule is kept");
  for (const id of ["review-before-ready", "architecture-decisions"]) {
    assert.ok(after.includes(`<!-- rule: ${id} -->\n${ruleText(template, id)}\n`), `${id} is added with this version's wording`);
  }
  assert.ok(after.indexOf(own) > after.indexOf("### Branches and pull requests"), "the own rule stays under its heading");
  assert.deepEqual(await settings(root), { architectureDecisions: "required" });

  const checked = strict(root);
  assert.equal(checked.status, 0, checked.stderr);
  assert.doesNotMatch(checked.stderr, /plan-architecture-section/);

  // A second run records nothing more.
  const map = await read(root, "product/story-map.yaml");
  const again = await applyUpgrade({ root, mode: "simple" });
  assert.equal(again.architectureDecisionsRecorded, undefined);
  assert.ok(!again.files.includes("product/story-map.yaml"));
  assert.equal(await read(root, "product/story-map.yaml"), map);
});

test("ESM-186: a host with an open plan that does not take the rule gets a notice and passes --strict", async t => {
  const root = await host(t, fixture);
  await choosePlans(root, "docs/plans");
  await write(root, { "docs/plans/price-lookup.md": openPlan });
  const agents = await read(root, "AGENTS.md");

  // Advanced mode, taking the guide and workflow but not the AGENTS.md section.
  const applied = run(root, "upgrade", "--apply", "guide,workflow", "--write");
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(await read(root, "AGENTS.md"), agents);
  assert.deepEqual(await settings(root), { plans: "docs/plans" });

  const checked = strict(root);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stderr, /^docs\/plans\/price-lookup\.md:3:1: notice: This open plan has no `## Architecture decisions` section\..* \[plan-architecture-section\]$/m);

  // Taking the section later turns the notice into a warning, which --strict fails on, until the plan answers.
  assert.equal(run(root, "upgrade", "--mode", "simple", "--write").status, 0);
  assert.deepEqual(await settings(root), { plans: "docs/plans", architectureDecisions: "required" });
  const required = strict(root);
  assert.equal(required.status, 1);
  assert.match(required.stderr, /^docs\/plans\/price-lookup\.md:3:1: warning: .*\[plan-architecture-section\]$/m);
  await write(root, { "docs/plans/price-lookup.md": `${openPlan}\n## Architecture decisions\n\nNone: keeps the existing design because it reads the catalogue through the existing client.\n` });
  const answered = strict(root);
  assert.equal(answered.status, 0, answered.stderr);
});

test("ESM-186: a host with plans off gets the rules and sees no plan check", async t => {
  const root = await host(t, fixture);
  await choosePlans(root, "false");
  // A folder of old plans that the product no longer keeps.
  await write(root, { "docs/plans/price-lookup.md": openPlan });

  const applied = run(root, "upgrade", "--mode", "simple", "--write");
  assert.equal(applied.status, 0, applied.stderr);
  const agents = await read(root, "AGENTS.md");
  for (const id of ["review-before-ready", "architecture-decisions"]) assert.match(agents, new RegExp(`<!-- rule: ${id} -->`));
  // With no plans, the answers go on the pull request's Architecture line.
  assert.match(ruleText(agents, "architecture-decisions"), /on an \*\*Architecture\*\* line in the PR description when it has none/);
  assert.deepEqual(await settings(root), { plans: false, architectureDecisions: "required" });

  const checked = strict(root);
  assert.equal(checked.status, 0, checked.stderr);
  assert.doesNotMatch(checked.stderr, /plan-architecture-section/);
});

test("ESM-186: init --skill gives the short rules in AGENTS.md and the full ones in the skill", async t => {
  const root = await host(t);
  const init = run(root, "init", "--skill", "--dir", root);
  assert.equal(init.status, 0, init.stderr);

  const agents = setupBody("agents", await read(root, "AGENTS.md"));
  const pointer = await packaged("templates/AGENTS-skill.md");
  for (const id of ["skill-review-before-ready", "skill-architecture-decisions"]) {
    assert.ok(agents.includes(`<!-- rule: ${id} -->\n${ruleText(pointer, id)}\n`), id);
  }
  assert.doesNotMatch(agents, /<!-- rule: (review-before-ready|architecture-decisions) -->/);
  assert.match(ruleText(pointer, "skill-review-before-ready"), /`\/code-review <PR number>`/);

  const skill = await read(root, ".claude/skills/story-map/SKILL.md");
  const template = await packaged("templates/AGENTS.md");
  for (const id of ["review-before-ready", "architecture-decisions"]) {
    // The skill carries the full rules without markers, linking back to the guide from its folder.
    assert.ok(skill.includes(ruleText(template, id).replaceAll("](docs/", "](../../../docs/")), id);
  }
  assert.doesNotMatch(skill, /<!-- rule:/);
  assert.match(skill, /^## Review before ready in detail$/m);
  assert.match(skill, /story-map tokens <ID> --since <time>/);
  assert.match(skill, /^6\. `## Architecture decisions`/m);

  assert.deepEqual(await settings(root), { architectureDecisions: "required" });
  const report = await upgradeReport({ root });
  for (const part of report.parts.filter(part => ["agents", "skill"].includes(part.part))) assert.equal(part.state, "current", part.part);
  const checked = strict(root);
  assert.equal(checked.status, 0, checked.stderr);
});

test("ESM-186: a fresh install asks for architecture decisions, and the scaffold's section is checked until answered", async t => {
  const root = await host(t);
  const init = run(root, "init", "--dir", root);
  assert.equal(init.status, 0, init.stderr);
  const agents = setupBody("agents", await read(root, "AGENTS.md"));
  const template = await packaged("templates/AGENTS.md");
  for (const id of ["review-before-ready", "architecture-decisions"]) assert.ok(agents.includes(`<!-- rule: ${id} -->\n${ruleText(template, id)}\n`), id);
  assert.deepEqual(await settings(root), { architectureDecisions: "required" });
  assert.equal(strict(root).status, 0);

  // A plan scaffolded for a story holds the hints, which fail --strict until they are answered.
  assert.equal(run(root, "settings", "--plans", "docs/plans", "--write").status, 0);
  const map = await read(root, "product/story-map.yaml");
  await write(root, { "product/story-map.yaml": map.replace("stories: []", "stories:\n  - id: HOST-1\n    title: Find the first step\n    activity: first-step\n    release: unassigned\n    status: planned\n    jobs: [first-job]\n") });
  assert.equal(run(root, "release-impact", "unassigned", "--metric", "First steps finished without help", "--expected", "Most new users finish it", "--write").status, 0);
  const plan = run(root, "plan", "HOST-1");
  assert.equal(plan.status, 0, plan.stderr);
  await write(root, { "docs/plans/first-step.md": plan.stdout });
  const scaffolded = strict(root);
  assert.equal(scaffolded.status, 1);
  assert.match(scaffolded.stderr, /^docs\/plans\/first-step\.md:\d+:1: warning: The `## Architecture decisions` section still holds the scaffold's hints\..*\[plan-architecture-section\]$/m);

  const answered = plan.stdout.replace(/## Architecture decisions\n[\s\S]*?\n## Decisions to make/, "## Architecture decisions\n\nNone: keeps the existing design because it only changes the first screen's text.\n\n## Decisions to make");
  await write(root, { "docs/plans/first-step.md": answered });
  const passed = strict(root);
  assert.equal(passed.status, 0, passed.stderr);
});

test("ESM-186: the plan scaffold writes the section after the mockup, with every hint the check reports", () => {
  const view = { audience: "internal", releases: [{ id: "r1", title: "First release" }], stories: [{ id: "HOST-1", title: "Find the first step", release: "r1", status: "planned", sources: [] }], activities: [] };
  const { markdown } = storyMapPlan(view, { stories: ["HOST-1"] });
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(headings.slice(headings.indexOf("UI mockup"), headings.indexOf("UI mockup") + 3), ["UI mockup", "Architecture decisions", "Decisions to make"]);
  assert.deepEqual(planArchitectureProblems(markdown).map(problem => problem.kind), ["placeholder"]);
  // Each hint on its own is enough to flag the section.
  const section = /## Architecture decisions\n([\s\S]*?)\n## /.exec(markdown)[1];
  for (const line of section.split("\n").filter(line => line.startsWith("- <!--"))) {
    const one = markdown.replace(section, `\n${line}\n\nSome answers.\n`);
    assert.deepEqual(planArchitectureProblems(one).map(problem => problem.kind), ["placeholder"], line);
  }
});
