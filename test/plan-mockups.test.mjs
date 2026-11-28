import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stringify } from "yaml";
import { checkStoryMap } from "auto-story-map";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const mockupRules = new Set(["mockup-without-html", "mockup-without-image", "missing-mockup-file", "unlinked-mockup"]);

/** A valid map whose first story lists `sources`. */
const mapWith = (sources = []) => stringify({
  version: 1,
  id: "mockups",
  title: "Mockups",
  settings: { plans: "plans" },
  activities: [{ id: "prepare", title: "Prepare" }],
  releases: [{ id: "r1", title: "First" }],
  stories: [
    { id: "S-1", title: "Price a quote", activity: "prepare", release: "r1", status: "planned", sources },
    { id: "S-2", title: "Save a quote", activity: "prepare", release: "r1", status: "planned" },
  ],
});

const linkedSection = [
  "# Quotes",
  "",
  "## UI mockup",
  "",
  "![The quote screen with prices](quote-mockup.png)",
  "",
  "The mockup is [quote-mockup.html](quote-mockup.html). S-1 links to this section.",
  "",
  "## Not now",
  "",
  "[Not a mockup](elsewhere.html)",
  "",
].join("\n");

/** A repository with a plans folder holding `files`, removed after the test. */
async function repository(t, files) {
  const root = await mkdtemp(join(tmpdir(), "esm-mockups-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "plans"), { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, "plans", name), content);
  return root;
}

const mockupIssues = async (root, sources) =>
  (await checkStoryMap(mapWith(sources), { root, plans: ["plans"] })).issues.filter(issue => mockupRules.has(issue.rule));

test("ESM-161: a UI mockup section with its HTML, PNG and a story linking it passes", async t => {
  const root = await repository(t, { "quotes.md": linkedSection, "quote-mockup.html": "<!doctype html>", "quote-mockup.png": "png" });
  assert.deepEqual(await mockupIssues(root, ["plans/quotes.md#ui-mockup"]), []);
  // The check runs under --check-sources too, once the map keeps plans in a folder.
  const result = await checkStoryMap(mapWith(["plans/quotes.md#ui-mockup"]), { root, checkSources: true });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("ESM-161: reports a mockup section with no HTML link or no PNG", async t => {
  const root = await repository(t, {
    "image-only.md": "## UI mockup\n\n![The screen](screen.png)\n\nA JPEG is not enough: ![photo](screen.jpg)\n",
    "html-only.md": "## UI mockup\n\nOpen [the mockup](screen.html). An image link is not an embed: [screen.png](screen.png)\n",
    "screen.png": "png",
    "screen.html": "<!doctype html>",
  });
  const issues = await mockupIssues(root, ["plans/image-only.md#ui-mockup", "plans/html-only.md#ui-mockup"]);
  assert.deepEqual(issues.map(issue => [issue.file, issue.line, issue.rule]), [
    ["plans/html-only.md", 1, "mockup-without-image"],
    ["plans/image-only.md", 1, "mockup-without-html"],
  ]);
  assert.ok(issues.every(issue => issue.severity === "error" && issue.help.endsWith("#link-mockups-and-designs")));
});

test("ESM-161: reports a linked mockup file that does not exist, at the link", async t => {
  const root = await repository(t, {
    "quotes.md": linkedSection.replace("(quote-mockup.png)", "(missing%20mockup.png)"),
    "quote-mockup.html": "<!doctype html>",
    "missing.md": "## UI mockup\n\n![Screen](gone/screen.png) and [the mockup](./gone/screen.html#top)\n",
  });
  const issues = await mockupIssues(root, ["plans/quotes.md#ui-mockup", "plans/missing.md#ui-mockup"]);
  assert.deepEqual(issues.map(issue => [issue.file, issue.line, issue.column, issue.rule, issue.message]), [
    ["plans/missing.md", 3, 32, "missing-mockup-file", "Mockup file './gone/screen.html' does not exist. Correct the link, or add the file."],
    ["plans/missing.md", 3, 1, "missing-mockup-file", "Mockup file 'gone/screen.png' does not exist. Correct the link, or add the file."],
    ["plans/quotes.md", 5, 1, "missing-mockup-file", "Mockup file 'missing mockup.png' does not exist. Correct the link, or add the file."],
  ]);
});

test("ESM-161: reports a mockup section that no story lists in its sources", async t => {
  const root = await repository(t, { "quotes.md": linkedSection, "quote-mockup.html": "<!doctype html>", "quote-mockup.png": "png" });
  const unlinked = await mockupIssues(root, ["plans/quotes.md#plan-section"]);
  assert.deepEqual(unlinked.map(issue => [issue.file, issue.line, issue.rule]), [["plans/quotes.md", 3, "unlinked-mockup"]]);
  assert.match(unlinked[0].message, /No story lists 'plans\/quotes\.md#ui-mockup' in its sources\./);
  // The link may start with ./ and use any case, as source links do.
  assert.deepEqual(await mockupIssues(root, ["./plans/quotes.md#UI-Mockup"]), []);
});

test("ESM-161: a section saying there is no mockup, and mockups in code blocks, are not checked", async t => {
  const root = await repository(t, {
    "docs-only.md": "## UI mockup\n\nNo mockup: this work changes docs, not the board.\n",
    "example.md": "## UI mockup\n\n```markdown\n![Example](example.png) [example](example.html)\n```\n\nNo mockup here either.\n\n## Later\n\n![Later](later.png)\n",
  });
  assert.deepEqual(await mockupIssues(root, []), []);
});

test("ESM-161: a mockup link that leaves the repository is reported, not read", async t => {
  const root = await repository(t, { "outside.md": "## UI mockup\n\n![Screen](../../screen.png) [mockup](https://example.com/screen.html) [local](screen.html)\n", "screen.html": "" });
  const issues = (await checkStoryMap(mapWith(["plans/outside.md#ui-mockup"]), { root, plans: ["plans"] })).issues.filter(issue => issue.file === "plans/outside.md");
  assert.deepEqual(issues.map(issue => [issue.rule, issue.column]), [["outside-repository", 1]]);
});

test("ESM-161: validate --plans prints each mockup problem with its rule and guide link", async t => {
  const root = await repository(t, { "quotes.md": linkedSection });
  await writeFile(join(root, "map.yaml"), mapWith());
  const run = spawnSync(process.execPath, [cli, "validate", "--plans", "plans", "map.yaml"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  for (const rule of ["missing-mockup-file", "unlinked-mockup"]) assert.match(run.stderr, new RegExp(`^plans/quotes\\.md:\\d+:\\d+: .+ \\[${rule}\\]\\n  help: \\S+#link-mockups-and-designs$`, "m"));
});
