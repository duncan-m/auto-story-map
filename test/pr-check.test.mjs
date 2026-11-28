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
// Not a package export: the Review section reader stays internal until ESM-186 offers the check to hosts.
import { architectureLineProblem, reviewSection } from "../dist/pr-check.js";
import { assertFasterThan } from "./fixtures/timing.mjs";

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
  assertFasterThan(started, 1000, "a long trailer is read in linear time");
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

/** The Review section of this repository's own pull request template, as a ready pull request would leave it unfilled. */
const templateBody = () => readFile(fileURLToPath(new URL("../.github/pull_request_template.md", import.meta.url)), "utf8");
const reviewBody = text => `## What changes\n\nDone.\n\n## Review\n\n${text}\n`;
const filledReview = "- Target: `/code-review 194`\n- Commit reviewed: `4490930`\n- Level: medium\n- Findings fixed: None\n- Findings declined: None";

test("ESM-182: a draft pull request with an empty Review section is not warned", () => {
  const result = check(() => {}, { body: reviewBody(""), draft: true });
  assert.equal(result.checkedReview, false);
  assert.deepEqual(result.issues, []);
});

test("ESM-182: a ready pull request with an empty or missing Review section gets a warning, not an error", () => {
  const empty = check(() => {}, { body: reviewBody(""), draft: false });
  assert.equal(empty.checkedReview, true);
  assert.deepEqual(empty.issues.map(issue => [issue.severity, issue.rule, issue.path]), [["warning", "missing-review", []]]);
  assert.match(empty.issues[0].message, /ready for review, but the Review section in its description is empty/);
  assert.equal(empty.passed, true);
  assert.equal(check(() => {}, { body: reviewBody(""), draft: false, strict: true }).passed, false);
  const missing = check(() => {}, { body: "## What changes\n\nDone.\n", draft: false });
  assert.match(missing.issues[0].message, /its description has no Review section/);
});

test("ESM-182: a ready pull request with a filled Review section passes", () => {
  const result = check(() => {}, { body: reviewBody(filledReview), draft: false, strict: true });
  assert.deepEqual(result.issues, []);
  assert.equal(result.passed, true);
  // A sentence saying why no review ran also records something.
  assert.deepEqual(check(() => {}, { body: reviewBody("A person reviewed this diff at `4490930`."), draft: false }).issues, []);
  // Bold labels with a value count, as in #190's description.
  assert.equal(reviewSection(reviewBody("- **Level:** medium\n- **Fixed:**")), "- **Level:** medium");
});

test("ESM-182: a label with only a placeholder, such as pending, counts as empty", () => {
  assert.equal(reviewSection(reviewBody("- Target: pending\n- Commit reviewed: TBD\n- **Level:** TODO.\n- Findings fixed:")), "");
  assert.deepEqual(rules(check(() => {}, { body: reviewBody("- Target: pending"), draft: false })), [["missing-review", undefined]]);
  // A value that merely starts with a placeholder word is a real value.
  assert.equal(reviewSection(reviewBody("- Target: pending review by Sam")), "- Target: pending review by Sam");
});

test("ESM-182: this repository's Map rules workflow passes --draft and runs when a pull request is marked ready", async () => {
  const workflow = await readFile(fileURLToPath(new URL("../.github/workflows/pr-check.yml", import.meta.url)), "utf8");
  const parsed = parseYaml(workflow);
  for (const type of ["edited", "ready_for_review", "converted_to_draft"]) assert.ok(parsed.on.pull_request.types.includes(type), `runs on ${type}`);
  const step = parsed.jobs["pr-check"].steps.find(item => item.run?.includes("pr-check"));
  assert.match(step.env.DRAFT, /github\.event\.pull_request\.draft/);
  assert.match(step.run, /--draft "\$DRAFT" --body-file - /);
});

test("ESM-182: the template's placeholder comments and empty labels count as an empty Review section", async () => {
  const template = await templateBody();
  assert.match(template, /^## Review$/m, "the pull request template has a Review section");
  assert.equal(reviewSection(template), "");
  assert.deepEqual(rules(check(() => {}, { body: template, draft: false })), [["missing-review", undefined]]);
  // A heading named in the middle of a later heading does not count as the section.
  assert.equal(reviewSection("## Code review notes\n\nfine\n"), undefined);
});

test("ESM-182: without --body-file or --draft, the Review section is not checked", () => {
  const noBody = check(() => {}, { draft: false });
  assert.equal(noBody.checkedReview, false);
  assert.deepEqual(noBody.issues, []);
  const unknown = check(() => {}, { body: reviewBody("") });
  assert.equal(unknown.checkedReview, false);
  assert.deepEqual(unknown.issues, []);
});

test("ESM-182: the missing-review rule links to the pr-check section of the guide", () => {
  assert.ok(prCheckRules.includes("missing-review"));
  assert.match(storyMapRuleHelp("missing-review"), /#check-a-pull-request-in-ci$/);
});

const required = document => { document.settings.architectureDecisions = "required"; };
const architectureBody = line => `## What changes\n\nDone.\n\n${line}\n\n## Review\n\n${filledReview}\n`;

test("ESM-188: a ready pull request in a map that requires architecture decisions gets a warning without an Architecture line", () => {
  const missing = check(required, { body: architectureBody(""), draft: false });
  assert.equal(missing.checkedArchitecture, true);
  assert.deepEqual(missing.issues.map(issue => [issue.severity, issue.rule, issue.path]), [["warning", "missing-architecture", ["settings", "architectureDecisions"]]]);
  assert.match(missing.issues[0].message, /its description has no Architecture line/);
  assert.equal(missing.passed, true);
  assert.equal(check(required, { body: architectureBody(""), draft: false, strict: true }).passed, false);
  assert.match(check(required, { body: architectureBody("Architecture: <!-- hint -->"), draft: false }).issues[0].message, /Architecture line in its description is empty/);
  assert.match(check(required, { body: architectureBody("**Architecture:** None:"), draft: false }).issues[0].message, /None: without a reason/);
});

test("ESM-188: an answered Architecture line passes, including a reason that wraps or a pointer to the plan", () => {
  for (const line of [
    "Architecture: None: keeps the existing design because it adds a flag to an existing command.",
    "- **Architecture:** None: keeps the existing design\nbecause it adds a warning to `pr-check`.",
    "Architecture: See the plan's [Architecture decisions](docs/plans/x.md#architecture-decisions) section.",
  ]) {
    assert.equal(architectureLineProblem(architectureBody(line)), undefined, line);
    assert.deepEqual(check(required, { body: architectureBody(line), draft: false, strict: true }).issues, [], line);
  }
  // A reason only inside an HTML comment, or a line only inside a code fence, does not count.
  assert.equal(architectureLineProblem("Architecture: None: <!-- because it is small -->"), "none-without-reason");
  assert.equal(architectureLineProblem("```\nArchitecture: None: keeps it because it is small.\n```\n"), "missing");
  // A fence closes only on its own character, and quoted or italic labels count.
  assert.equal(architectureLineProblem("```\n~~~\nArchitecture: None: keeps it because it is small.\n```\n"), "missing");
  assert.equal(architectureLineProblem("~~~\nx\n~~~\nArchitecture: None: keeps it because it is small.\n"), undefined);
  assert.equal(architectureLineProblem("> *Architecture:* None: keeps it because it is small."), undefined);
  // A reason that wraps ends at the paragraph: the next section's text is not part of it.
  assert.equal(architectureLineProblem("Architecture: None:\n\nbecause it is small."), "none-without-reason");
});

test("ESM-188: this repository's pull request template leaves the Architecture line empty", async () => {
  assert.equal(architectureLineProblem(await templateBody()), "empty");
});

test("ESM-188: drafts, unknown drafts and maps that only recommend architecture decisions are not checked", () => {
  const recommended = check(() => {}, { body: architectureBody(""), draft: false });
  assert.equal(recommended.checkedArchitecture, false);
  assert.deepEqual(recommended.issues, []);
  for (const options of [{ body: architectureBody(""), draft: true }, { body: architectureBody("") }, { draft: false }]) {
    const result = check(required, options);
    assert.equal(result.checkedArchitecture, false);
    assert.deepEqual(result.issues.filter(issue => issue.rule === "missing-architecture"), []);
  }
  assert.ok(prCheckRules.includes("missing-architecture"));
  assert.match(storyMapRuleHelp("missing-architecture"), /#check-a-pull-request-in-ci$/);
});

test("ESM-188: the Architecture line reader is linear on long lines and many labels", () => {
  const long = `Architecture: None:${" x".repeat(50_000)}`;
  const many = "- Architecture:\n".repeat(20_000);
  const started = performance.now();
  assert.equal(architectureLineProblem(long), "none-without-reason");
  assert.equal(architectureLineProblem(many), "empty");
  assert.equal(architectureLineProblem("<!--".repeat(20_000)), "missing");
  assertFasterThan(started, 250, "Architecture line reader");
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
  assert.equal(run(["pr-check", "--draft", "maybe", "main"]).status, 2);
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

test("ESM-182: story-map pr-check warns a ready pull request with no review, and fails it only with --strict", async t => {
  const root = await mkdtemp(join(tmpdir(), "esm-pr-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=Sam Builder", "-c", "user.email=sam@example.test", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input });
  git("init", "-q", "-b", "main");
  await mkdir(join(root, "product"));
  await writeFile(join(root, "product/story-map.yaml"), stringify(base()));
  git("add", "-A");
  git("commit", "-q", "-m", "add map");
  const empty = "## Review\n\n- Target: <!-- such as /code-review 190 -->\n- Level:\n";

  const draft = run(["pr-check", "--format", "github", "--draft", "true", "--body-file", "-", "main"], empty);
  assert.equal(draft.status, 0, draft.stdout);
  assert.doesNotMatch(draft.stdout, /missing-review/);

  const ready = run(["pr-check", "--format", "github", "--draft", "false", "--body-file", "-", "main"], empty);
  assert.equal(ready.status, 0, ready.stdout);
  assert.match(ready.stdout, /^::warning file=product\/story-map\.yaml,title=missing-review::This pull request is ready for review, but the Review section in its description is empty\. .*#check-a-pull-request-in-ci$/m);
  assert.match(ready.stdout, /; checked the Review section\)$/m);

  const strict = run(["pr-check", "--strict", "--draft=false", "--body-file", "-", "main"], empty);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /^product\/story-map\.yaml: warning: This pull request is ready for review, .* \[missing-review\]$/m);

  const filled = run(["pr-check", "--strict", "--draft", "false", "--body-file", "-", "main"], "## Review\n\n- Target: `/code-review 7`\n- Level: medium\n");
  assert.equal(filled.status, 0, filled.stderr);

  const json = JSON.parse(run(["pr-check", "--format", "json", "--draft", "false", "main"]).stdout);
  assert.equal(json.checkedReview, false, "without --body-file the Review section is not checked");
  assert.deepEqual(json.issues, []);
});
