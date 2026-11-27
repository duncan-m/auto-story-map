import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse as parseYaml, stringify } from "yaml";
import {
  checkPullRequest,
  commitAgent,
  diffStoryMaps,
  isStoryMapRuleId,
  parseStoryMap,
  prCheckRules,
  storyMapRuleHelp,
  tokensUsedSection,
  workflowCommands,
} from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const template = path => fileURLToPath(new URL(`../templates/${path}`, import.meta.url));

/** A small valid map with a draft and an estimate, so each change below needs a person or not. */
const base = () => ({
  version: 1,
  id: "quotes",
  title: "Quotes",
  settings: { plans: false },
  personas: [{
    id: "builder",
    title: "Builder",
    jobs: [{ id: "price", situation: "I am pricing a job", motivation: "to use current prices", outcome: "my quote holds", draft: true }],
  }],
  activities: [{ id: "prepare", title: "Prepare" }],
  releases: [{ id: "r1", title: "First" }],
  stories: [
    { id: "S-1", title: "Price a quote", activity: "prepare", release: "r1", status: "in-progress", jobs: ["price"] },
    { id: "S-2", title: "Save a quote", activity: "prepare", release: "r1", status: "in-progress", jobs: ["price"] },
    { id: "S-10", title: "Send a quote", activity: "prepare", release: "r1", status: "planned", jobs: ["price"] },
  ],
});

const map = (change = () => {}) => {
  const document = base();
  change(document);
  return parseStoryMap(stringify(document));
};

const agent = { sha: "a".repeat(40), author: "Sam Builder", message: "Estimate S-1\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n" };
const person = { sha: "b".repeat(40), author: "Sam Builder", message: "Estimate S-1\n" };

const check = (change, options = {}) => {
  const before = map();
  const after = map(change);
  return checkPullRequest({ diff: diffStoryMaps(before, after), after, commits: [], ...options });
};
const rules = result => result.issues.map(issue => [issue.rule, issue.itemId]);

test("ESM-163: tells agent commits from a person's by bot authors and Co-Authored-By trailers", () => {
  assert.equal(commitAgent(agent), "Claude");
  assert.equal(commitAgent({ ...person, message: "Fix\n\nco-authored-by: OpenAI Codex <codex@openai.com>" }), "Codex");
  assert.equal(commitAgent({ ...person, author: "renovate[bot]" }), "renovate[bot]");
  assert.equal(commitAgent({ ...person, author: "Release Robot" }, ["release robot"]), "Release Robot");
  assert.equal(commitAgent(person), undefined);
  // A person named like an agent, or co-authoring with a person, is still a person.
  assert.equal(commitAgent({ ...person, author: "Jules Verne" }), undefined);
  assert.equal(commitAgent({ ...person, message: "Pair\n\nCo-Authored-By: Alex Kim <alex@example.test>" }), undefined);
  // A trailer only counts at the start of a line.
  assert.equal(commitAgent({ ...person, message: "Mention that Co-Authored-By: Claude is how agents sign commits" }), undefined);
  // A trailer with a long run of spaces and tabs is read quickly.
  const started = performance.now();
  assert.equal(commitAgent({ ...person, message: `Co-Authored-By:${" \t".repeat(100_000)}x` }), undefined);
  assert.ok(performance.now() - started < 1000, "a long trailer is read in linear time");
});

test("ESM-163: a change that needs a person fails only when an agent commit changed the map and nobody approved it", () => {
  const estimate = document => { document.stories[0].estimate = 3; };
  assert.deepEqual(rules(check(estimate, { commits: [person] })), []);
  const failed = check(estimate, { commits: [person, agent] });
  assert.equal(failed.passed, false);
  assert.deepEqual(rules(failed), [["estimate-changed", "S-1"]]);
  assert.deepEqual(failed.issues[0].path, ["stories", 0]);
  assert.match(failed.issues[0].message, /^Estimate: none → 3\. Only a person should make this change.*aaaaaaa \(Claude\).*map-approved label\.$/);
  assert.deepEqual(failed.agentCommits, [{ sha: agent.sha, agent: "Claude" }]);

  const approved = check(estimate, { commits: [agent], approved: true });
  assert.equal(approved.passed, true);
  assert.equal(approved.approved, true);
  assert.equal(approved.needsPerson.length, 1);

  // An agent's ordinary map changes pass.
  assert.equal(check(document => { document.stories[1].summary = "Saves a draft."; }, { commits: [agent] }).passed, true);
});

test("ESM-163: reports every rule the diff lists under Needs a person, located in the map", () => {
  const result = check(document => {
    document.personas[0].jobs[0].draft = undefined;
    document.stories.splice(2, 1);
    document.settings.storyIds = "lowest-free";
  }, { commits: [agent] });
  assert.deepEqual(result.issues.map(issue => [issue.rule, issue.path]), [
    ["draft-confirmed", ["personas", 0, "jobs", 0]],
    ["story-removed", []],
    ["settings-changed", ["settings", "storyIds"]],
  ]);
});

test("ESM-163: finds the Tokens used section and leaves out comments", () => {
  const body = "## Summary\n\nDone.\n\n## Tokens used\n\n<!-- Paste the output here -->\nS-1: **1,000 tokens**\n\n### Detail\n\nmore\n\n## Tests\n\nnpm test\n";
  assert.equal(tokensUsedSection(body), "S-1: **1,000 tokens**\n\n### Detail\n\nmore");
  assert.equal(tokensUsedSection("## Tokens used\n\n<!-- In the PR that finishes a story, paste… -->\n\n## Tests\n"), "");
  assert.equal(tokensUsedSection("## Summary\n\nTokens used: lots\n"), undefined);
});

test("ESM-163: a story marked merged needs a Tokens used section that names it or explains the missing count", () => {
  const merge = document => { document.stories[0].status = "merged"; document.stories[1].status = "merged"; };
  const section = text => `## Summary\n\nDone.\n\n## Tokens used\n\n${text}\n\n## Tests\n\nnpm test\n`;
  // Without a body, tokens are not checked.
  assert.equal(check(merge).passed, true);
  assert.deepEqual(rules(check(merge, { body: "## Summary\n\nDone.\n" })), [["missing-tokens-used", "S-1"], ["missing-tokens-used", "S-2"]]);
  assert.match(check(merge, { body: section("<!-- paste here -->") }).issues[0].message, /section in its description is empty/);
  assert.equal(check(merge, { body: section("S-1: **1,000 tokens**\n\nS-2: **2,000 tokens**") }).passed, true);
  assert.deepEqual(rules(check(merge, { body: section("S-1: **1,000 tokens**") })), [["missing-tokens-used", "S-2"]]);
  // An explanation that names no story covers them all.
  assert.equal(check(merge, { body: section("Delivered in a tool that does not report tokens.") }).passed, true);
  // S-1 is not named by S-10.
  assert.deepEqual(rules(check(document => { document.stories[0].status = "merged"; }, { body: section("S-10: **1,000 tokens**") })), [["missing-tokens-used", "S-1"]]);
  // A story that was already merged is not checked again.
  const before = map(merge);
  const after = map(document => { merge(document); document.stories[0].summary = "Changed."; });
  assert.equal(checkPullRequest({ diff: diffStoryMaps(before, after), after, commits: [], body: "" }).passed, true);
});

test("ESM-163: the pr-check rules are rules with a guide section", () => {
  for (const rule of prCheckRules) assert.ok(isStoryMapRuleId(rule), `${rule} is in storyMapRules`);
  assert.match(storyMapRuleHelp("missing-tokens-used"), /#record-the-tokens-used-on-a-story$/);
});

test("ESM-163: story-map pr-check reads the commits and body, and reports in text, github and json", async t => {
  const root = await mkdtemp(join(tmpdir(), "esm-pr-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=Sam Builder", "-c", "user.email=sam@example.test", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input });
  git("init", "-q", "-b", "main");
  await mkdir(join(root, "product"));
  const write = document => writeFile(join(root, "product/story-map.yaml"), stringify(document));
  await write(base());
  git("add", "-A");
  git("commit", "-q", "-m", "add map");
  git("checkout", "-q", "-b", "feature");

  const document = base();
  document.stories[0].estimate = 5;
  document.stories[1].status = "merged";
  await write(document);
  git("commit", "-q", "-am", "S-1: estimate it");
  const byPerson = run(["pr-check", "main"]);
  assert.equal(byPerson.status, 0, byPerson.stderr);
  assert.match(byPerson.stdout, /^pr-check: passed \(no agent commits changed the map; 1 change needs a person; Tokens used not checked without --body-file\)$/m);

  document.stories[1].summary = "Saves a draft.";
  await write(document);
  git("commit", "-q", "-am", "S-2: finish it\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
  const failed = run(["pr-check", "main"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^product\/story-map\.yaml:\d+:\d+: stories\.0 \(S-1\): Estimate: none → 5\. .* \[estimate-changed\]\n {2}help: /m);
  assert.match(failed.stdout, /^pr-check: failed \(1 agent commit changed the map; 1 change needs a person;/m);

  const github = run(["pr-check", "--format", "github", "--approved", "--body-file", "-", "main"], "## Tokens used\n\nNot counted.\n");
  assert.equal(github.status, 0, github.stdout);
  assert.match(github.stdout, /approved; checked Tokens used for S-2\)$/m);

  const noTokens = run(["pr-check", "--format", "github", "--approved", "--body-file", "-", "main"], "## Summary\n");
  assert.equal(noTokens.status, 1);
  assert.match(noTokens.stdout, /^::error file=product\/story-map\.yaml,line=\d+,col=\d+,title=missing-tokens-used::stories\.1 \(S-2\): .*#record-the-tokens-used-on-a-story$/m);

  await writeFile(join(root, "body.md"), "## Tokens used\n\nS-2: **10 tokens**\n");
  const json = JSON.parse(run(["pr-check", "--format", "json", "--body-file", "body.md", "main"]).stdout);
  assert.equal(json.format, "auto-story-map.pr-check");
  assert.equal(json.passed, false);
  assert.deepEqual(json.merged, ["S-2"]);
  assert.deepEqual(json.issues.map(issue => [issue.rule, issue.itemId, issue.file, typeof issue.line]), [["estimate-changed", "S-1", "product/story-map.yaml", "number"]]);

  assert.equal(run(["pr-check", "--bad", "main"]).status, 2);
  assert.equal(run(["pr-check", "no-such-ref"]).status, 2);
});

test("ESM-163: the init workflow runs pr-check with the PR body and the map-approved label", async () => {
  const workflow = await readFile(template("story-map-ci.yml"), "utf8");
  const command = workflowCommands(workflow).get("story-map pr-check");
  assert.ok(command, "the workflow runs story-map pr-check");
  assert.match(command, /--body-file - .*"origin\/\$BASE_REF"$/);
  const step = parseYaml(workflow).jobs.validate.steps.find(item => item.run?.includes("story-map pr-check"));
  assert.match(step.env.PR_BODY, /github\.event\.pull_request\.body/);
  assert.match(step.env.APPROVED, /map-approved/);
  assert.deepEqual(parseYaml(workflow).on.pull_request.types, ["opened", "synchronize", "reopened", "edited", "labeled", "unlabeled"]);
});
