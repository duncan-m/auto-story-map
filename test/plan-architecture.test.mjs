import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "yaml";
import { checkStoryMap, diffStoryMaps, formatStoryMapDiff, parseStoryMap } from "auto-story-map";
import { createStoryMapMcpServer } from "auto-story-map/mcp";
import { planArchitectureHints } from "../dist/plan-architecture.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const schemaFile = fileURLToPath(new URL("../story-map.schema.json", import.meta.url));
const rule = "plan-architecture-section";

/** A valid map that keeps plans in `plans`, with `settings` merged in. */
const mapWith = (settings = {}) => stringify({
  version: 1,
  id: "architecture",
  title: "Architecture",
  settings: { plans: "plans", ...settings },
  activities: [{ id: "prepare", title: "Prepare" }],
  releases: [{ id: "r1", title: "First", impact: [{ metric: "Quotes priced", expected: "More quotes priced the same day" }] }],
  stories: [{ id: "S-1", title: "Price a quote", activity: "prepare", release: "r1", status: "planned" }],
});

/** A plan with a status line and `section` as its architecture section, or none when `section` is undefined. */
const plan = (status, section) => [
  "# Quotes",
  "",
  `Status: ${status}. The work is S-1.`,
  "",
  "## 1. Price a quote",
  "",
  "S-1 prices a quote.",
  "",
  ...(section === undefined ? [] : ["## Architecture decisions", "", section, ""]),
  "## Not now",
  "",
  "- Nothing.",
  "",
].join("\n");

const answered = "None: keeps the existing design because it adds a flag to an existing command, with no new consumer.";

/** A repository with `product/story-map.yaml` and a plans folder holding `files`, removed after the test. */
async function repository(t, files, map = mapWith()) {
  const root = await mkdtemp(join(tmpdir(), "esm-architecture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "plans"), { recursive: true });
  await mkdir(join(root, "product"), { recursive: true });
  await writeFile(join(root, "product/story-map.yaml"), map);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, "plans", name), content);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  return { root, run };
}

const architectureIssues = async (root, map = mapWith(), options = {}) =>
  (await checkStoryMap(map, { root, plans: ["plans"], ...options })).issues.filter(issue => issue.rule === rule);

test("ESM-184: an open plan that answers the questions passes", async t => {
  const full = [
    "- **Where it runs.** Inside the existing CLI.",
    "- **Data and contracts.** Adds a flag to `validate`.",
    "- **Boundaries.** None touched.",
    "- **Reversibility.** Remove the flag in a release.",
  ].join("\n");
  const { root } = await repository(t, { "one-line.md": plan("proposed", answered), "full.md": plan("in progress", full) });
  assert.deepEqual(await architectureIssues(root), []);
});

test("ESM-184: reports an open plan with no architecture section, at its status line", async t => {
  const { root } = await repository(t, { "quotes.md": plan("planned") });
  const issues = await architectureIssues(root);
  assert.deepEqual(issues.map(issue => [issue.file, issue.line, issue.severity]), [["plans/quotes.md", 3, "notice"]]);
  assert.match(issues[0].message, /no `## Architecture decisions` section/);
  assert.match(issues[0].help, /#check-the-architecture-section-in-plans$/);
  // A deeper heading with the same words is not the section.
  const { root: deeper } = await repository(t, { "quotes.md": plan("planned").replace("## Not now", "### Architecture decisions\n\nNot here.\n\n## Not now") });
  assert.equal((await architectureIssues(deeper)).length, 1);
});

test("ESM-184: reports an empty section, or one with only comments, at its heading", async t => {
  const { root } = await repository(t, {
    "empty.md": plan("proposed", ""),
    "comments.md": plan("proposed", "<!-- Fill this in later. -->"),
  });
  const issues = await architectureIssues(root);
  assert.deepEqual(issues.map(issue => [issue.file, issue.line]), [["plans/comments.md", 9], ["plans/empty.md", 9]]);
  assert.ok(issues.every(issue => /section is empty/.test(issue.message)));
  // An answer under a sub-heading counts as content.
  const { root: nested } = await repository(t, { "nested.md": plan("proposed", `### Item 1\n\n${answered}`) });
  assert.deepEqual(await architectureIssues(nested), []);
});

test("ESM-184: reports a section that still holds the scaffold's hints", async t => {
  assert.equal(planArchitectureHints.length, 4, "one hint for each question");
  for (const [index, label] of ["Where it runs", "Data and contracts", "Boundaries", "Reversibility"].entries()) {
    assert.ok(planArchitectureHints[index].startsWith(`<!-- ${label}: `) && planArchitectureHints[index].endsWith(" -->"));
  }
  const { root } = await repository(t, {
    "scaffold.md": plan("proposed", planArchitectureHints.map(hint => `- ${hint}`).join("\n")),
    "half.md": plan("proposed", `- **Where it runs.** Inside the CLI.\n- ${planArchitectureHints[3]}`),
  });
  const issues = await architectureIssues(root);
  assert.deepEqual(issues.map(issue => issue.file), ["plans/half.md", "plans/scaffold.md"]);
  assert.ok(issues.every(issue => /still holds the scaffold's hints/.test(issue.message)));
});

test("ESM-184: reports a None: answer with no reason after because, at its line", async t => {
  const { root } = await repository(t, {
    "no-change.md": plan("proposed", "None: no change."),
    "bold.md": plan("proposed", "**None:** keeps the existing design."),
    "trailing.md": plan("proposed", "None: keeps the existing design because."),
    "reason.md": plan("proposed", answered),
    "bold-reason.md": plan("proposed", "**None:** keeps the existing design because it only rewords docs."),
    "words.md": plan("proposed", "- **Boundaries.** None of the security boundaries; it reads only the plan files."),
    "code.md": plan("proposed", "Where it runs: inside `None: x` and the CLI.\n\n```\nNone: no change.\n```"),
  });
  const issues = await architectureIssues(root);
  assert.deepEqual(issues.map(issue => [issue.file, issue.line]), [["plans/bold.md", 11], ["plans/no-change.md", 11], ["plans/trailing.md", 11]]);
  assert.ok(issues.every(issue => /`None:` answer gives no reason/.test(issue.message)));
});

test("ESM-184: skips plans with no status line, and finished, blocked or cut plans", async t => {
  const files = { "notes.md": "# Retro\n\nNo status line here.\n", "words.md": plan("built") };
  for (const status of ["merged", "shipped", "blocked", "cut"]) files[`${status}.md`] = plan(status);
  const { root } = await repository(t, files);
  assert.deepEqual(await architectureIssues(root), []);
  // Each open status is checked, written either way.
  const { root: open } = await repository(t, { "a.md": plan("proposed"), "b.md": plan("planned"), "c.md": plan("in progress"), "d.md": plan("In-progress") });
  assert.equal((await architectureIssues(open)).length, 4);
});

test("ESM-184: a notice by default never fails, and required makes it a warning that fails with --strict", async t => {
  const { root } = await repository(t, { "quotes.md": plan("proposed") });
  const notice = await checkStoryMap(mapWith(), { root, plans: ["plans"], strict: true });
  assert.equal(notice.valid, true, "a notice never fails --strict");
  assert.equal(notice.notices, 1);
  assert.equal(notice.warnings, 0);

  for (const value of ["recommended", undefined]) {
    const map = value ? mapWith({ architectureDecisions: value }) : mapWith();
    assert.equal((await architectureIssues(root, map))[0].severity, "notice");
  }
  const required = await checkStoryMap(mapWith({ architectureDecisions: "required" }), { root, plans: ["plans"] });
  assert.equal(required.valid, true, "a warning passes without --strict");
  assert.equal(required.issues.find(issue => issue.rule === rule).severity, "warning");
  const strict = await checkStoryMap(mapWith({ architectureDecisions: "required" }), { root, plans: ["plans"], strict: true });
  assert.equal(strict.valid, false);
  assert.equal(strict.warnings, 1);
});

test("ESM-184: a host with plans open sees a notice through --check-sources, and one with plans off sees nothing", async t => {
  const open = await repository(t, { "quotes.md": plan("proposed") });
  const text = open.run("validate", "--check-sources", "--strict", "product/story-map.yaml");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stderr, /plans\/quotes\.md:3:1: notice: This open plan has no `## Architecture decisions` section\./);
  assert.match(text.stdout, /, 1 notice; checked sources and plan references\n$/);

  const off = await repository(t, { "quotes.md": plan("proposed") }, mapWith({ plans: false }));
  const result = off.run("validate", "--check-sources", "--strict", "product/story-map.yaml");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr + result.stdout, /Architecture decisions|notice/);
});

test("ESM-184: required fails a host's CI under --strict, in the GitHub format", async t => {
  const { run } = await repository(t, { "quotes.md": plan("proposed") }, mapWith({ architectureDecisions: "required" }));
  const github = run("validate", "--format", "github", "--check-sources", "--strict", "product/story-map.yaml");
  assert.equal(github.status, 1);
  assert.match(github.stdout, /^::warning file=plans\/quotes\.md,line=3,col=1,title=plan-architecture-section::This open plan has no/m);
});

test("ESM-184: the GitHub and JSON formats carry the notice, and JSON stays at version 1", async t => {
  const { run } = await repository(t, { "quotes.md": plan("proposed", "None: no change.") });
  const github = run("validate", "--format", "github", "--plans", "plans", "product/story-map.yaml");
  assert.equal(github.status, 0, github.stderr);
  assert.match(github.stdout, /^::notice file=plans\/quotes\.md,line=11,col=1,title=plan-architecture-section::This `None:` answer gives no reason\./m);

  const json = JSON.parse(run("validate", "--format", "json", "--plans", "plans", "--strict", "product/story-map.yaml").stdout);
  assert.equal(json.format, "auto-story-map.validation");
  assert.equal(json.version, 1);
  assert.equal(json.valid, true);
  const issue = json.maps[0].issues.find(found => found.rule === rule);
  assert.deepEqual({ ...issue, help: undefined, message: undefined }, { severity: "notice", file: "plans/quotes.md", line: 11, column: 1, path: [], rule, help: undefined, message: undefined });
  assert.equal(json.maps[0].notices, 1);
});

test("ESM-184: validate_map in the MCP server returns the notice", async t => {
  const { root } = await repository(t, { "quotes.md": plan("proposed") });
  const server = createStoryMapMcpServer({ root });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(() => client.close());
  const response = await client.callTool({ name: "validate_map", arguments: { plans: ["plans"], strict: true } });
  const body = JSON.parse(response.content[0].text);
  assert.equal(body.valid, true);
  const issue = body.maps[0].issues.find(found => found.rule === rule);
  assert.equal(issue.severity, "notice");
  assert.equal(issue.file, "plans/quotes.md");
});

test("ESM-184: the schema accepts recommended or required, and rejects anything else", async () => {
  const schema = JSON.parse(await readFile(schemaFile, "utf8"));
  const setting = schema.properties.settings.properties.architectureDecisions;
  assert.deepEqual(setting.enum, ["recommended", "required"]);
  assert.match(setting.description, /notice.*warning/s);
  assert.ok(!(schema.properties.settings.required ?? []).includes("architectureDecisions"), "the setting is optional");

  assert.equal(parseStoryMap(mapWith({ architectureDecisions: "required" })).settings.architectureDecisions, "required");
  const result = await checkStoryMap(mapWith({ architectureDecisions: "always" }));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.rule === "invalid-value" && issue.path.join(".") === "settings.architectureDecisions"));
});

test("ESM-184: settings --architecture-decisions records the choice, and diff lists it under Settings", async t => {
  const { root, run } = await repository(t, {});
  const path = join(root, "product/story-map.yaml");
  const before = await readFile(path, "utf8");
  const dry = run("settings", "--architecture-decisions", "required");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /\+ {2}architectureDecisions: required\n/);
  assert.match(dry.stdout, /### Settings\n\n- Architecture decisions in plans: required, so a gap in an open plan is a warning \(was recommended\)\./);
  assert.match(dry.stdout, /setting `architectureDecisions`/, "a person makes the choice");
  assert.equal(await readFile(path, "utf8"), before);

  assert.equal(run("settings", "--architecture-decisions", "required", "--write").status, 0);
  const saved = await readFile(path, "utf8");
  assert.match(saved, /settings:\n {2}plans: plans\n {2}architectureDecisions: required\n/);
  const back = formatStoryMapDiff(diffStoryMaps(parseStoryMap(saved), parseStoryMap(before)));
  assert.match(back, /- Architecture decisions in plans: recommended, so a gap in an open plan is a notice \(was required\)\./);
  // Setting the default explicitly is no change in what validate does, so diff lists no setting line.
  const explicit = formatStoryMapDiff(diffStoryMaps(parseStoryMap(before), parseStoryMap(mapWith({ architectureDecisions: "recommended" }))));
  assert.doesNotMatch(explicit, /Architecture decisions in plans/);

  const wrong = run("settings", "--architecture-decisions", "always");
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /--architecture-decisions must be recommended or required/);
});

test("ESM-184: this repository requires the section, and every open plan has one", async () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const source = await readFile(join(repo, "product/story-map.yaml"), "utf8");
  assert.equal(parseStoryMap(source).settings.architectureDecisions, "required");
  // The example plan that ships in the package is open, so it answers the questions too.
  assert.deepEqual(await architectureIssues(repo, source, { plans: ["docs"] }), []);
});

test("ESM-184: stays fast on a crafted section", async () => {
  const { planArchitectureProblems } = await import("../dist/plan-architecture.js");
  const crafted = `## Architecture decisions\n\n${"None*_".repeat(50_000)}\n${"because ".repeat(50_000)}\n${"_*".repeat(100_000)}None:\n`;
  const started = performance.now();
  const problems = planArchitectureProblems(crafted);
  assert.ok(performance.now() - started < 1000, "linear in the section's length");
  assert.ok(problems.some(problem => problem.kind === "none-without-reason"));
});
