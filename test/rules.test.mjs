import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stringify } from "yaml";
import {
  checkStoryMap,
  getStoryMapActions,
  isStoryMapRuleId,
  needsPersonRules,
  parseStoryMap,
  prCheckRules,
  storyMapPackagedGuideUrl,
  storyMapRuleHelp,
  storyMapRuleIds,
  storyMapRuleLinker,
  storyMapRules,
  storyMapWarningKinds,
} from "auto-story-map";
import { markdownAnchors } from "../dist/references.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const guidePath = fileURLToPath(new URL("../docs/story-map.md", import.meta.url));
const guide = await readFile(guidePath, "utf8");
const anchors = markdownAnchors(guide);

/** The rows of the rules table in the guide's “Validation rules” section, as rule ID and linked heading. */
function guideRuleRows() {
  const section = guide.split(/^### Validation rules$/m)[1]?.split(/^#{2,3} /m)[0];
  assert.ok(section, "the guide has a Validation rules section");
  return [...section.matchAll(/^\| `([a-z-]+)` \|.*\| \[[^\]]+\]\(#([a-z0-9-]+)\) \|$/gm)].map(match => ({ rule: match[1], section: match[2] }));
}

/** A small valid map with a persona, so each case below breaks one thing. */
const base = () => ({
  version: 1,
  id: "rules",
  title: "Rules",
  settings: { plans: false },
  personas: [{
    id: "builder",
    title: "Builder",
    jobs: [{ id: "price", situation: "I am pricing a job", motivation: "to use current prices", outcome: "my quote holds" }],
  }],
  activities: [{ id: "prepare", title: "Prepare" }],
  releases: [{ id: "r1", title: "First" }],
  stories: [
    { id: "S-1", title: "Price a quote", activity: "prepare", release: "r1", status: "planned", jobs: ["price"] },
    { id: "S-2", title: "Save a quote", activity: "prepare", release: "r1", status: "planned", jobs: ["price"] },
  ],
});

const edited = change => {
  const map = base();
  change(map);
  return stringify(map);
};

/** Maps and files that, between them, break every rule that is not a warning kind. */
const cases = [
  ["yaml-syntax", () => "version: 1\nstories: [\n"],
  ["duplicate-key", () => "version: 1\nid: a\nid: b\n"],
  ["unknown-field", () => edited(map => { map.stories[0].owner = "Sam"; })],
  ["missing-field", () => edited(map => { delete map.activities[0].title; })],
  ["invalid-value", () => edited(map => { map.stories[0].status = "started"; })],
  ["duplicate-id", () => edited(map => { map.stories[1].id = "S-1"; })],
  ["unknown-reference", () => edited(map => { map.stories[0].release = "later"; })],
  ["duplicate-reference", () => edited(map => { map.stories[0].jobs = ["price", "price"]; })],
  ["dependency-cycle", () => edited(map => { map.stories[0].dependsOn = ["S-2"]; map.stories[1].dependsOn = ["S-1"]; })],
  ["empty-persona-context", () => edited(map => { map.personas[0].context = {}; })],
  ["customer-copy-required", () => edited(map => { map.visibility = "all-users"; })],
  ["choose-delivery-plans", () => edited(map => { delete map.settings; })],
  // The root below has an AGENTS.md section from an older version.
  ["setup-behind", () => edited(() => {})],
];

/** Each source, plan and test file problem, checked in one repository. */
const fileCases = {
  "invalid-source-path": "docs/%zz.md",
  "missing-source": "docs/nothing.md",
  "missing-heading": "docs/plan.md#no-such-heading",
  "source-too-large": "docs/big.md#big",
  "outside-repository": "../outside.md",
};

test("ESM-159: every rule links to a heading in the guide, and the guide lists every rule", () => {
  for (const [rule, info] of Object.entries(storyMapRules)) {
    assert.match(rule, /^[a-z]+(-[a-z]+)*$/, `${rule} is lowercase words joined by hyphens`);
    assert.ok(anchors.has(info.section), `${rule} links to #${info.section}, which is a heading in docs/story-map.md`);
    assert.ok(info.summary.endsWith("."), `${rule} has a summary`);
  }
  const rows = guideRuleRows();
  assert.deepEqual(rows.map(row => row.rule), storyMapRuleIds, "the guide's table lists every rule, in storyMapRules order");
  for (const row of rows) assert.equal(row.section, storyMapRules[row.rule].section, `the guide links ${row.rule} to the section its help link goes to`);
  // A warning's kind is its rule, so the Actions tab and validate name it the same way.
  for (const kind of storyMapWarningKinds) assert.ok(isStoryMapRuleId(kind), `warning kind ${kind} is a rule`);
});

test("ESM-159: every validate issue has a rule and a help link to a heading that exists", async t => {
  const root = await mkdtemp(join(tmpdir(), "esm-rules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "plans"), { recursive: true });
  await mkdir(join(root, "test"), { recursive: true });
  await writeFile(join(root, "docs", "plan.md"), "# Plan\n");
  await writeFile(join(root, "AGENTS.md"), `<!-- auto-story-map:start 0.7.0 sha256:${"0".repeat(64)} -->\nOld rules.\n<!-- auto-story-map:end -->\n`);
  await writeFile(join(root, "docs", "big.md"), `# Big\n${"x".repeat(5 * 1024 * 1024)}\n`);
  await writeFile(join(root, "plans", "plan.md"), "Builds on S-999.\n");
  await writeFile(join(root, "plans", "words.md"), "Status: built. The work is S-1.\n");
  await writeFile(join(root, "plans", "behind.md"), "Status: proposed. The work is S-1 in the **Old** release.\n");
  await writeFile(join(root, "plans", "screen.md"), "## UI mockup\n\nThe mockup is [screen.html](screen.html).\n");
  await writeFile(join(root, "plans", "image.md"), "## UI mockup\n\n![The screen](image.png)\n");
  await writeFile(join(root, "test", "quote.test.js"), 'test("S-998: prices", () => {});\n');
  await writeFile(join(root, "test", "huge.test.js"), `// ${"x".repeat(5 * 1024 * 1024)}\n`);

  const seen = new Set();
  const check = async (source, options = {}) => {
    const result = await checkStoryMap(source, { root, ...options });
    for (const issue of result.issues) {
      assert.ok(isStoryMapRuleId(issue.rule), `${issue.message} has a known rule, not ${issue.rule}`);
      const [, fragment] = issue.help.split("#");
      assert.equal(fragment, storyMapRules[issue.rule].section, `${issue.rule}'s help links to its section`);
      assert.ok(anchors.has(fragment), `${issue.help} links to a heading in the guide`);
      // This root has no copy of the guide, so links go to the guide at the installed version's tag.
      assert.equal(issue.help, storyMapRuleHelp(issue.rule));
      assert.ok(issue.help.startsWith(`${storyMapPackagedGuideUrl}#`));
      seen.add(issue.rule);
    }
    return result;
  };

  for (const [rule, source] of cases) {
    const result = await check(source());
    assert.ok(result.issues.some(issue => issue.rule === rule), `the ${rule} case reports ${rule}: ${result.issues.map(issue => issue.rule).join(", ")}`);
  }
  const sources = edited(map => { map.stories[0].sources = Object.values(fileCases); map.stories[0].status = "shipped"; });
  await check(sources, { checkSources: true, plans: ["plans", "nothing"], tests: ["test", "missing"] });
  for (const rule of [...Object.keys(fileCases), "plans-not-found", "unknown-plan-story", "plan-status-words", "plan-status-behind", "plan-status-release", "plan-architecture-section", "mockup-without-html", "mockup-without-image", "missing-mockup-file", "unlinked-mockup", "tests-not-found", "unknown-test-story", "test-file-too-large"]) {
    assert.ok(seen.has(rule), `the file checks report ${rule}`);
  }
  // A missing map is reported by the command, not by checkStoryMap.
  const unreadable = spawnSync(process.execPath, [cli, "validate", "--format", "json", "missing.yaml"], { cwd: root, encoding: "utf8" });
  const [issue] = JSON.parse(unreadable.stdout).maps[0].issues;
  assert.equal(issue.rule, "unreadable-map");
  assert.equal(issue.help, storyMapRuleHelp("unreadable-map"));
  seen.add(issue.rule);

  // Every rule that is not a warning kind has a case above. Warning kinds are covered by the Actions tests,
  // the rules diff lists under Needs a person by the ESM-162 tests, and the pr-check rules by the ESM-163 tests.
  const untested = storyMapRuleIds.filter(rule => !seen.has(rule) && !storyMapWarningKinds.includes(rule) && !needsPersonRules.includes(rule) && !prCheckRules.includes(rule));
  assert.deepEqual(untested, [], "add a case that breaks each new rule");
});

test("ESM-159: rule IDs do not depend on message text", async () => {
  const issues = (await checkStoryMap(edited(map => { map.stories[0].release = "later"; map.stories[0].activity = "nowhere"; }))).issues;
  assert.deepEqual(issues.filter(issue => issue.severity === "error").map(issue => issue.rule), ["unknown-reference", "unknown-reference"]);
  // The error thrown by parseStoryMap carries the same rules.
  assert.throws(() => parseStoryMap(edited(map => { map.stories[1].id = "S-1"; })), error => error.issues.every(issue => issue.rule === "duplicate-id"));
});

test("ESM-159: links go to the repository's copy of the guide when it has the heading", async t => {
  const root = await mkdtemp(join(tmpdir(), "esm-rules-guide-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "story-map.md"), "# Guide\n\n## Record dependencies\n");
  const link = await storyMapRuleLinker(root);
  assert.equal(link("dependency-cycle"), "docs/story-map.md#record-dependencies");
  // An older copy without the heading links to the packaged guide instead.
  assert.equal(link("missing-estimate"), `${storyMapPackagedGuideUrl}#estimate-effort`);
});

test("ESM-159: text, GitHub and JSON output give each issue's rule and link", async t => {
  const root = await mkdtemp(join(tmpdir(), "esm-rules-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "map.yaml"), edited(map => { map.stories[0].release = "later"; }));
  const run = (...args) => spawnSync(process.execPath, [cli, "validate", ...args, "map.yaml"], { cwd: root, encoding: "utf8" });
  const help = storyMapRuleHelp("unknown-reference");

  const text = run();
  assert.equal(text.status, 1);
  assert.match(text.stderr, /^map\.yaml:\d+:\d+: stories\.0\.release \(S-1\): Unknown release 'later'\. Use a release ID from the map\. \[unknown-reference\]\n/);
  assert.ok(text.stderr.includes(`\n  help: ${help}\n`), text.stderr);

  const github = run("--format", "github");
  assert.match(github.stdout, /^::error file=map\.yaml,line=\d+,col=\d+,title=unknown-reference::stories\.0\.release \(S-1\): Unknown release 'later'\./m);
  assert.ok(github.stdout.includes(` ${help}\n`), github.stdout);

  const json = JSON.parse(run("--format", "json").stdout);
  assert.equal(json.version, 1);
  const [issue] = json.maps[0].issues;
  assert.equal(issue.rule, "unknown-reference");
  assert.equal(issue.help, help);
});

test("ESM-159: story-map actions and the Actions groups name each rule and its link", async t => {
  const map = parseStoryMap(edited(map => { map.stories[0].status = "blocked"; }));
  const groups = getStoryMapActions(map);
  const blocked = groups.find(group => group.kind === "missing-status-reason");
  assert.equal(blocked.rule, "missing-status-reason");
  assert.equal(blocked.help, `${storyMapPackagedGuideUrl}#blocked-and-cut-stories`);
  assert.equal(getStoryMapActions(map, { help: rule => `guide#${rule}` }).find(group => group.kind === "missing-status-reason").help, "guide#missing-status-reason");

  const root = await mkdtemp(join(tmpdir(), "esm-rules-actions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "map.yaml"), edited(map => { map.stories[0].status = "blocked"; }));
  const text = spawnSync(process.execPath, [cli, "actions", "--map", "map.yaml"], { cwd: root, encoding: "utf8" });
  assert.match(text.stdout, /^Say why a story stopped \(1\): a person or an agent \[missing-status-reason\]\n  [^\n]+\n  help: \S+#blocked-and-cut-stories\n/m);
  const json = JSON.parse(spawnSync(process.execPath, [cli, "actions", "--map", "map.yaml", "--format", "json"], { cwd: root, encoding: "utf8" }).stdout);
  assert.equal(json.groups.find(group => group.kind === "missing-status-reason").rule, "missing-status-reason");
});
