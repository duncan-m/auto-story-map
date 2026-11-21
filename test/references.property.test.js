// Property tests for the heading anchor scanners in src/references.ts.
//
// ESM-610 replaced the heading regexes with linear-time scanners. The regexes
// below are the ones they replaced (commit e4267c8), kept as the reference
// for what the anchors should be. fast-check generates Markdown that is dense
// in the characters the scanners treat specially and checks both agree.
//
// Inputs stay short because the reference regexes are the slow ones. For a
// longer run, as before a release that touches src/references.ts:
//   FC_NUM_RUNS=300000 node --test test/references.property.test.js
// A failure prints a seed and path; pass them to fc.assert to replay it.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { markdownAnchors, slugify } from "../dist/references.js";

const numRuns = Number(process.env.FC_NUM_RUNS) || 1000;

// The reference implementation.

const referenceHeadingText = raw =>
  raw
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .trim();

const referenceSlugify = heading =>
  referenceHeadingText(heading).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");

// Every id and name attribute in each <a …> tag, where a tag runs to the next
// `>` (ESM-610 kept that rule and reads every attribute, not only the last).
const referenceHtmlAnchors = line =>
  [...line.matchAll(/<a\s[^>]*/gi)].flatMap(tag =>
    [...tag[0].matchAll(/\b(?:id|name)=["']([^"']+)["']/gi)].map(match => match[1].toLowerCase()),
  );

// Same walk as markdownAnchors (fences, setext headings, -1/-2 suffixes), with
// the reference ATX regex, slugify and HTML anchors in place of the scanners.
function referenceMarkdownAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  const addHeading = raw => {
    const base = referenceSlugify(raw);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  };
  let fence;
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, index) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = undefined;
      return;
    }
    if (fence) return;
    const atx = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx) addHeading(atx[1]);
    else if (index > 0 && /^\s{0,3}(=+|-+)\s*$/.test(line) && lines[index - 1].trim() && !/^\s*([-*+]|\d+\.)\s/.test(lines[index - 1])) {
      addHeading(lines[index - 1]);
    }
    for (const id of referenceHtmlAnchors(line)) anchors.add(id);
  });
  return anchors;
}

// Generators.

// Markup the scanners handle specially, whitespace they trim, and text that
// slugify keeps or drops. No carriage returns or Unicode line or paragraph
// separators: the reference ATX regex's `.` stops at them, while lines are
// only split on \n and \r\n.
const headingUnit = fc.constantFrom(
  "<", ">", "[", "]", "(", ")", "![", "](", "`", "#", " ", " ", "\t", "\u00a0",
  "a", "Z", "é", "Ü", "1", "-", "_", ".", "&", "'", '"', "=", "🎉", "<b>", "</b>",
);
const headingText = fc.string({ unit: headingUnit, maxLength: 40 });

const tagUnit = fc.constantFrom(
  "<a ", "<A\t", "<a", "<", ">", " ", "id=", "name=", "data-id=", "title=", "'", '"', "x", "Y", "1", "-",
);
const htmlLine = fc.string({ unit: tagUnit, maxLength: 30 });

const atxLine = fc
  .tuple(
    fc.constantFrom("", " ", "   ", "    "),
    fc.integer({ min: 1, max: 7 }),
    fc.constantFrom(" ", "\t", "", "  "),
    headingText,
    fc.constantFrom("", " #", " ##  ", "#", " # "),
  )
  .map(([indent, level, gap, text, closing]) => `${indent}${"#".repeat(level)}${gap}${text}${closing}`);

const line = fc.oneof(
  { weight: 4, arbitrary: atxLine },
  { weight: 2, arbitrary: headingText },
  { weight: 2, arbitrary: htmlLine },
  { weight: 1, arbitrary: fc.constantFrom("===", "---", " -- ", "- item", "1. item", "```", "~~~", "  ```md", "") },
);
const markdown = fc
  .tuple(fc.array(line, { maxLength: 12 }), fc.constantFrom("\n", "\r\n"))
  .map(([lines, eol]) => lines.join(eol));

const sorted = set => [...set].sort();

// Properties.

test("slugify matches the regexes it replaced", () => {
  fc.assert(
    fc.property(headingText, heading => {
      assert.equal(slugify(heading), referenceSlugify(heading));
    }),
    { numRuns },
  );
});

test("markdownAnchors matches the regexes it replaced", () => {
  fc.assert(
    fc.property(markdown, doc => {
      assert.deepEqual(sorted(markdownAnchors(doc)), sorted(referenceMarkdownAnchors(doc)));
    }),
    { numRuns },
  );
});

test("repeated headings get GitHub's numbered suffixes", () => {
  // No `<`, so no line adds an HTML anchor of its own.
  const plainHeading = fc.string({ unit: fc.constantFrom("a", "Z", "1", " ", "-", "_", ".", "é", "`", "[", "]", "(", ")"), maxLength: 20 });
  fc.assert(
    fc.property(plainHeading, fc.integer({ min: 1, max: 6 }), (heading, copies) => {
      const base = slugify(heading);
      const expected = Array.from({ length: copies }, (_, i) => (i ? `${base}-${i}` : base));
      const anchors = markdownAnchors(Array(copies).fill(`## ${heading}`).join("\n"));
      for (const anchor of expected) assert.ok(anchors.has(anchor), `missing ${JSON.stringify(anchor)}`);
    }),
    { numRuns },
  );
});
