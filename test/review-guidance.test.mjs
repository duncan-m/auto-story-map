import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { markdownHeadings } from "../dist/references.js";

const read = path => readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

/** The text of a Markdown section, from its heading to the next heading of the same or a higher level. */
async function section(path, title) {
  const markdown = await read(path);
  const headings = markdownHeadings(markdown);
  const index = headings.findIndex(heading => heading.text === title);
  assert.notEqual(index, -1, `${path} has a "${title}" section`);
  const next = headings.slice(index + 1).find(heading => heading.level <= headings[index].level);
  return markdown.split("\n").slice(headings[index].line, next ? next.line - 1 : undefined).join("\n");
}

/** The bold lead of each numbered item, in order. */
const numbered = text => [...text.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map(match => match[1]);

test("ESM-179: the review checklist asks about the story first and the repository's checks last", async () => {
  const review = await section("docs/ENGINEERING-OVERVIEW.md", "Review a code change");
  assert.deepEqual(numbered(review), [
    "What behaviour did the story promise?",
    "What evidence shows it works?",
    "Which existing caller or saved input could break?",
    "Did it make an architecture decision that wasn't recorded?",
    "Then the repository's own checks.",
  ]);
  assert.match(await read("AGENTS.md"), /\(docs\/ENGINEERING-OVERVIEW\.md#review-a-code-change\)/);
});

test("ESM-183: plans and pull requests answer the four architecture questions", async () => {
  const record = await section("docs/ENGINEERING-OVERVIEW.md", "Record architecture decisions");
  assert.deepEqual(numbered(record), ["Where it runs.", "Data and contracts.", "Boundaries.", "Reversibility."]);
  assert.match(record, /"None: keeps the existing design because/);
  assert.match(await read("AGENTS.md"), /\(docs\/ENGINEERING-OVERVIEW\.md#record-architecture-decisions\)/);
  assert.match(await read(".github/pull_request_template.md"), /^Architecture: <!--/m, "the pull request template has an Architecture line");
});

test("ESM-185: the guide names four points to review the architecture", async () => {
  const points = await section("docs/story-map.md", "When to review the architecture");
  assert.deepEqual(numbered(points), ["Planning.", "Review.", "Release planning.", "On a schedule."]);
  assert.match(points, /\*\*A refactor story needs evidence of its cost\*\*/);
});
