import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse as parseYaml } from "yaml";
import { getStoryMapForViewer, parseStoryMap } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";
import { markdownHeadings } from "../dist/references.js";

const read = path => readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
const rule = /Write each story's title and summary for someone who doesn't know the code, following \[Write a story summary\]\(docs\/story-map\.md#write-a-story-summary\)/;

async function guideSection() {
  const guide = await read("docs/story-map.md");
  const headings = markdownHeadings(guide);
  const index = headings.findIndex(heading => heading.text === "Write a story summary");
  assert.notEqual(index, -1, "the guide has a Write a story summary section");
  const next = headings.slice(index + 1).find(heading => heading.level <= headings[index].level);
  return guide.split("\n").slice(headings[index].line, next ? next.line - 1 : undefined).join("\n");
}

test("ESM-191: the guide asks four questions in order, with a line break at least every 180 characters", async () => {
  const section = await guideSection();
  assert.deepEqual([...section.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map(match => match[1]), [
    "What changes, and for whom.",
    "Why now.",
    "Done when.",
    "Not included.",
  ]);
  assert.match(section, /at least every 180 characters, and for each new long sentence/);
  // The guide's own example keeps to the rule it states, and to the schema's limit.
  const example = parseYaml(/```yaml\n([\s\S]*?)```/.exec(section)[1])[0];
  assert.ok(example.summary.length <= 500);
  for (const line of example.summary.split("\n")) assert.ok(line.length <= 180, line);
});

test("ESM-191: both AGENTS.md files have the rule, and hosts are told what it changes", async () => {
  const template = await read("templates/AGENTS.md");
  assert.match(template, /<!-- rule: write-story-summaries -->\n/);
  assert.match(template, rule);
  assert.match(await read("AGENTS.md"), rule);
  const changes = parseYaml(await read("templates/changes.yaml"));
  assert.ok(changes.releases["0.7.11"].agents.some(line => /summary for people who don't know the code/.test(line)));
  assert.ok(changes.releases["0.7.11"].guide.some(line => /title and summary/.test(line)));
});

test("ESM-191: the story panel keeps a summary's line breaks", async () => {
  const css = await read("styles.css");
  assert.match(css, /\.esm-detail-summary-line \{ display: block; \}/);
  assert.match(css, /\.esm-detail-summary-line \+ \.esm-detail-summary-line \{ margin-top: 6px; \}/);
  // More space between the summary and the For, Jobs and other rows under it.
  assert.match(css, /\.esm-detail-summary \+ \.esm-detail-context \{ margin-top: 24px; \}/);
  // And between the For row and the Jobs row.
  assert.match(css, /\.esm-detail-context \.esm-persona-row \{ margin-bottom: 8px; \}/);
  const map = parseStoryMap([
    "version: 1",
    "id: quotes",
    "title: Quotes",
    "activities: [{ id: prepare, title: Prepare }]",
    "releases: [{ id: r1, title: First }]",
    "stories:",
    "  - id: S-1",
    "    title: Price a quote",
    "    activity: prepare",
    "    release: r1",
    "    status: planned",
    "    summary: |",
    "      Builders price a quote from current prices.",
    "      Done when: a quote shows each price's date.",
  ].join("\n"));
  const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: getStoryMapForViewer(map, { roles: ["engineer"] }) }));
  assert.match(html, /<p class="esm-detail-summary"><span class="esm-detail-summary-line">Builders price a quote from current prices\.<\/span><span class="esm-detail-summary-line">Done when: a quote shows each price&#x27;s date\.<\/span><\/p>/);
});
