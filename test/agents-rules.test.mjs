import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  agentsRuleIds,
  agentsRules,
  agentsSectionBlocks,
  knownSetupVersionsFrom,
  loadKnownSetupVersions,
  setupBody,
  stampSetupFile,
  storyMapRuleIds,
  storyMapVersion,
  summariseAgentsRules,
  templateRules,
  upgradeReport,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packaged = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

async function host(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "story-map-rules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const agentsPart = async (root, known) => (await upgradeReport({ root, known })).parts.find(part => part.part === "agents");
const byRule = rules => Object.fromEntries(rules.map(rule => [rule.id ?? rule.title, rule]));
const marker = id => `<!-- rule: ${id} -->\n`;
/** Replaces one rule's paragraph, marker included, in a template. */
const replaceRule = (text, id, replacement) => text.replace(new RegExp(`${marker(id)}[^\\n]+\\n`), replacement);
const ruleText = (text, id) => new RegExp(`${marker(id)}([^\\n]+)\\n`).exec(text)[1];

test("ESM-173: every rule in both AGENTS.md templates has a marker with a known rule ID", async () => {
  for (const [name, form] of [["templates/AGENTS.md", "full"], ["templates/AGENTS-skill.md", "skill"]]) {
    const body = setupBody("agents", await packaged(name));
    const blocks = agentsSectionBlocks(body).filter(block => block.kind === "rule");
    assert.ok(blocks.length >= 2, name);
    for (const block of blocks) {
      assert.ok(block.id, `${name} has a rule with no marker: ${block.text.slice(0, 60)}`);
      assert.equal(agentsRules[block.id]?.form, form, `${name}: ${block.id}`);
      // The opening words name the rule in templates from before markers, so they must still fit.
      assert.ok(agentsRules[block.id].openings.some(opening => block.text.startsWith(opening)), `${name}: ${block.id}'s openings`);
    }
    const { rules, unnamed } = templateRules(body, form);
    assert.deepEqual(unnamed, [], name);
    assert.equal(rules.size, blocks.length, `${name} has each rule once`);
  }
  for (const id of agentsRuleIds) {
    // The same scheme as ESM-159's validation rule IDs, and a shared ID means the same rule.
    assert.match(id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    if (storyMapRuleIds.includes(id)) assert.equal(agentsRules[id].check, id, `${id} is a validation rule ID too`);
    if (agentsRules[id].check) assert.ok(storyMapRuleIds.includes(agentsRules[id].check), id);
  }
});

test("ESM-173: the package ships each earlier rule's hash, named by its opening words before 0.7.11", async () => {
  const known = await loadKnownSetupVersions();
  assert.ok(Object.keys(known.rules).length > 10);
  for (const [id, hashes] of Object.entries(known.rules)) {
    assert.ok(agentsRuleIds.includes(id), `${id} is in agentsRules`);
    for (const [hash, versions] of Object.entries(hashes)) {
      assert.match(hash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(versions.length > 0, id);
    }
  }
  // Templates without markers are named by opening words; a paragraph that matches none is left out.
  const built = knownSetupVersionsFrom([
    { part: "agents", version: "0.7.0", text: "<!-- auto-story-map:start -->\n## Story map\n\nTreat [product/story-map.yaml](x) as the map.\n\nSomething else entirely.\n<!-- auto-story-map:end -->\n" },
  ]);
  assert.deepEqual(Object.keys(built.rules), ["source-of-truth"]);
  assert.deepEqual(Object.values(built.rules["source-of-truth"]), [["0.7.0"]]);
});

test("ESM-173: rule markers name the paragraph after them, and headings are kept apart", () => {
  const blocks = agentsSectionBlocks("## Story map\n\n<!-- rule: one -->\nFirst rule,\nwrapped.\n\n### Next\n<!-- rule: two -->\n\nSecond rule.\n\nOur own rule.\n");
  assert.deepEqual(blocks, [
    { kind: "heading", text: "## Story map" },
    { kind: "rule", id: "one", text: "First rule,\nwrapped." },
    { kind: "heading", text: "### Next" },
    { kind: "rule", id: "two", text: "Second rule." },
    { kind: "rule", text: "Our own rule." },
  ]);
});

test("ESM-173: a fresh init needs no rule review, and the skill leaves the markers out", async t => {
  const root = await host(t, { "package-lock.json": "{}" });
  assert.equal(run(root, "init", "--dir", root).status, 0);
  const part = await agentsPart(root);
  assert.equal(part.state, "current");
  assert.equal(part.rules, undefined);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /<!-- rule: record-tokens -->/);
});

test("ESM-173: an edited section from this version keeps reworded, removed and added rules", async t => {
  const template = await packaged("templates/AGENTS.md");
  let edited = replaceRule(template, "agreed-estimates", `${marker("agreed-estimates")}Estimates are set by the team only.\n`);
  edited = replaceRule(edited, "outstanding-actions", "");
  edited = edited.replace("<!-- auto-story-map:end -->", "\nDeploy from main only.\n<!-- auto-story-map:end -->");
  const root = await host(t, { "AGENTS.md": stampSetupFile("agents", template, storyMapVersion).replace(setupBody("agents", template), setupBody("agents", edited)) });

  const part = await agentsPart(root, { agents: {}, guide: {}, workflow: {} });
  assert.equal(part.state, "edited");
  const rules = byRule(part.rules);
  assert.deepEqual([rules["agreed-estimates"].state, rules["agreed-estimates"].recommendation, rules["agreed-estimates"].matchedBy], ["edited", "keep", "marker"]);
  assert.deepEqual([rules["outstanding-actions"].state, rules["outstanding-actions"].recommendation], ["removed", "keep"]);
  assert.deepEqual([rules["Deploy from main only."].state, rules["Deploy from main only."].recommendation, rules["Deploy from main only."].id], ["added", "keep", undefined]);
  assert.equal(rules["record-tokens"].state, "current");
  assert.equal(summariseAgentsRules(part.rules), "2 rules of yours kept");
});

test("ESM-173: a section from an earlier version updates unchanged rules and offers each reworded one", async t => {
  const template = await packaged("templates/AGENTS.md");
  // The earlier template: two rules worded differently, one rule this version adds, one this version drops.
  let older = replaceRule(template, "record-tokens", `${marker("record-tokens")}Record the tokens used, the old way.\n`);
  older = replaceRule(older, "test-names", `${marker("test-names")}Name tests after stories, the old way.\n`);
  older = replaceRule(older, "outstanding-actions", "");
  older = older.replace("<!-- auto-story-map:end -->", `\n${marker("old-dropped-rule")}A rule this version drops.\n<!-- auto-story-map:end -->`);
  const known = knownSetupVersionsFrom([{ part: "agents", version: "0.7.5", text: older }]);

  // The host keeps record-tokens as 0.7.5 wrote it, rewords test-names and agreed-estimates, and removes pr-diff-summary.
  let hostText = replaceRule(older, "test-names", `${marker("test-names")}Our own wording of the test names rule.\n`);
  hostText = replaceRule(hostText, "agreed-estimates", `${marker("agreed-estimates")}Our own wording of the estimates rule.\n`);
  hostText = replaceRule(hostText, "pr-diff-summary", "");
  const root = await host(t, { "AGENTS.md": `# House rules\n\n${stampSetupFile("agents", older, "0.7.5").replace(setupBody("agents", older), setupBody("agents", hostText))}` });

  const part = await agentsPart(root, known);
  assert.deepEqual([part.state, part.from, part.recommendation], ["edited-outdated", "0.7.5", "review"]);
  const rules = byRule(part.rules);
  assert.deepEqual([rules["record-tokens"].state, rules["record-tokens"].recommendation], ["outdated", "replace"]);
  assert.equal(rules["record-tokens"].template, ruleText(template, "record-tokens"));
  assert.match(rules["record-tokens"].diff, /^-Record the tokens used, the old way\.$/m);
  // This version changed test-names since 0.7.5, so the reworded one is offered with this version's beside it.
  assert.deepEqual([rules["test-names"].state, rules["test-names"].recommendation], ["edited-outdated", "review"]);
  assert.equal(rules["test-names"].text, "Our own wording of the test names rule.");
  assert.match(rules["test-names"].diff, /^\+When you add or change a test/m);
  // This version did not change agreed-estimates since 0.7.5, so the host's wording is simply kept.
  assert.deepEqual([rules["agreed-estimates"].state, rules["agreed-estimates"].recommendation], ["edited", "keep"]);
  assert.deepEqual([rules["outstanding-actions"].state, rules["outstanding-actions"].recommendation], ["new", "add"]);
  assert.deepEqual([rules["pr-diff-summary"].state, rules["pr-diff-summary"].recommendation], ["removed", "keep"]);
  assert.deepEqual([rules["old-dropped-rule"].state, rules["old-dropped-rule"].recommendation], ["dropped", "remove"]);
  // This version's rules come first, in its order, then the host's own.
  assert.deepEqual(part.rules.at(-1).id, "old-dropped-rule");
  assert.equal(part.change, "the story map section changed since 0.7.5: 1 rule to update, 1 new rule to add, 1 dropped rule to remove, 1 reworded rule to review, 1 rule of yours kept");
});

test("ESM-173: sections from before 0.7.11 are compared rule by rule through the known templates", async t => {
  const template = await packaged("templates/AGENTS.md");
  const unmarked = text => text.replace(/^<!-- rule: [a-z0-9-]+ -->\n/gm, "");
  let older = replaceRule(template, "record-tokens", `${marker("record-tokens")}When you open the pull request that finishes a story, record the tokens, the old way.\n`);
  older = unmarked(replaceRule(older, "outstanding-actions", ""));
  const known = knownSetupVersionsFrom([{ part: "agents", version: "0.7.5", text: older }]);

  // Unedited: the whole section matches the 0.7.5 template, so every rule is recognised by its text.
  const root = await host(t, { "AGENTS.md": older });
  let part = await agentsPart(root, known);
  assert.deepEqual([part.state, part.from], ["outdated", "0.7.5"]);
  let rules = byRule(part.rules);
  assert.deepEqual([rules["record-tokens"].state, rules["record-tokens"].matchedBy, rules["record-tokens"].recommendation], ["outdated", "text", "replace"]);
  assert.deepEqual([rules["outstanding-actions"].state, rules["outstanding-actions"].recommendation], ["new", "add"]);
  assert.equal(part.rules.filter(rule => rule.state === "current").length, part.rules.length - 2);

  // Edited, with no marker: the section's version is unknown, so its unedited rules say it came from 0.7.5.
  const reworded = older.replace("record the tokens, the old way.", "record the tokens in our own words.");
  await writeFile(join(root, "AGENTS.md"), reworded.replace("<!-- auto-story-map:end -->", "\nOur own rule.\n<!-- auto-story-map:end -->"));
  part = await agentsPart(root, known);
  assert.deepEqual([part.state, part.from], ["edited-outdated", undefined]);
  rules = byRule(part.rules);
  assert.deepEqual([rules["record-tokens"].state, rules["record-tokens"].matchedBy, rules["record-tokens"].recommendation], ["edited-outdated", "opening", "review"]);
  assert.deepEqual([rules["outstanding-actions"].state, rules["outstanding-actions"].recommendation], ["new", "add"], "new since 0.7.5, not removed");
  assert.deepEqual([rules["Our own rule."].state, rules["Our own rule."].recommendation], ["added", "keep"]);
});

test("ESM-173: story-map upgrade shows the rules that need a look in text, Markdown and JSON", async t => {
  const template = await packaged("templates/AGENTS.md");
  const edited = replaceRule(template, "agreed-estimates", `${marker("agreed-estimates")}Estimates are set by the team only.\n`);
  const older = replaceRule(template, "agreed-estimates", `${marker("agreed-estimates")}An older estimates rule.\n`);
  // Recorded as from a version the package knows nothing of, so the rule the host reworded may have changed since.
  const root = await host(t, { "AGENTS.md": stampSetupFile("agents", older, "0.0.1").replace(setupBody("agents", older), setupBody("agents", edited)) });

  const text = run(root, "upgrade");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^AGENTS\.md section, rule by rule \(\d+ more are current\):$/m);
  assert.match(text.stdout, /^agreed-estimates +reworded, changed here too +yours is kept; compare it with this version's$/m);
  assert.doesNotMatch(text.stdout, /^record-tokens /m, "current rules are counted, not listed");

  const diff = run(root, "upgrade", "--diff").stdout;
  assert.match(diff, /^Rule agreed-estimates, from yours to this version's:\n--- before\n\+\+\+ after\n@@[^\n]+\n-Estimates are set by the team only\.$/m);
  assert.doesNotMatch(diff, /AGENTS\.md section \(AGENTS\.md\), from yours/, "the rules replace the whole section's diff");

  const markdown = run(root, "upgrade", "--format", "markdown").stdout;
  assert.match(markdown, /<details><summary>AGENTS\.md section, rule by rule: 1 of \d+ rules need a look<\/summary>/);
  assert.match(markdown, /^\| agreed-estimates \| reworded, changed here too \| yours is kept; compare it with this version's \|$/m);

  const report = JSON.parse(run(root, "upgrade", "--format", "json").stdout);
  const rule = report.parts[0].rules.find(rule => rule.id === "agreed-estimates");
  assert.deepEqual([rule.state, rule.recommendation, rule.text], ["edited-outdated", "review", "Estimates are set by the team only."]);
  assert.equal(rule.template, ruleText(template, "agreed-estimates"));
  assert.ok(report.parts[0].diff, "the whole section's diff stays in the JSON");
});
