# Plan: show a story's tests in its panel

Status: done, released in 0.7.0. The work is ESM-801, with the card count added as ESM-802, both in the **0.7.0** release of the map.

Internal viewers open a story and see the tests that cover it, each linking to its line in the repository. Tests point to stories, not the other way round: a test names its story ID, and a build step collects them. The links then keep up as tests are added, renamed or moved, without anyone editing the map.

Items are numbered in the order they should be built, and each section uses the same number. All of them are part of ESM-801:

1. [Find tagged tests](#1-find-tagged-tests)
2. [Write the tests index](#2-write-the-tests-index)
3. [Show tests in the story panel](#3-show-tests-in-the-story-panel)
4. [Check test tags in validate](#4-check-test-tags-in-validate)
5. [Tag this repository's tests](#5-tag-this-repositorys-tests)
6. [Document it](#6-document-it)

Tests are internal only. The customer view and customer-facing copy do not change.

## Why tests, and why this way

The panel's **Engineering** section links to docs that explain how a story is built. It does not show whether the story is checked. Tests are the most direct evidence of that, and the schema already says `sources` can hold tests, but nothing tells a test apart from a doc and nobody keeps the lists up to date.

Three approaches were considered:

| Approach | What it does | Why not now |
| --- | --- | --- |
| Group declared tests | Show `sources` entries that look like test files under their own heading | The map still has to list tests by hand, and the lists go stale |
| **Find tests by story ID** (this plan) | Tests carry the story ID in their name, and a build step indexes them | — |
| Show test results | Add pass or fail from a CI report | Depends on each host's CI. Kept as a follow-up, and the index is designed so results can join it later (see [Later: results](#later-results)) |

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. How a test names its story | The story ID anywhere in the test's name, as a whole word, such as `test("ESM-702: exports a valid Visio package", …)`. The convention is to put it first, followed by a colon. A test can name several stories. |
| B. Which calls count | `test`, `it` and their modifiers (`test.only`, `it.skip`, `test.each` and so on), plus `describe` and `suite`. A tagged `describe` is listed as one entry, marked as a group. Tests inside an untagged `describe` do not inherit anything. |
| C. How tests are found | A static scan of the source text. No test code is loaded or run. |
| D. Which files are scanned | Each `--tests <path>` names a file or folder, and can be repeated. In a folder, the scan reads `*.test.*` and `*.spec.*` files and everything under `test/`, `tests/` and `__tests__/`, with the extensions `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` and `.tsx`. `node_modules`, `dist`, `build` and dot folders are skipped. `--tests .` scans the whole repository. |
| E. Where the panel shows tests | A **Tests** section between **History** and **Engineering**, grouped by file. The card face does not change. |
| F. What the panel shows without a link | Without `sourceBaseUrl`, file names and lines are plain text, like sources. |
| G. Empty state | When the host supplied an index and a story has no tests, the panel says “No tests are tagged ESM-502 yet” and shows how to tag one. Without an index, the section is left out. |
| H. What validate checks | With `--tests`: an error for a tag naming a story that is not in the map, and a warning for an `in-progress` or `merged` story with no tagged tests. Planned, shipped, blocked and cut stories are not warned about, so existing maps don't fill up with warnings. |
| I. Search | Test names are not searched. The board's search stays on IDs, titles and summaries. |

### Assumptions to confirm

- **Names are read from string literals only.** The first argument must be a quoted string or a template literal without `${…}`, on the same line as the call or the next one. Names built at run time, such as `test(\`${name} works\`, …)` or `test.each` names with `%s`, are matched on their literal text only. Most tags are written at the start of the name, so this covers the common case.
- **Comments are not tags.** This repository marks test sections with comments such as `// --- Visio export (ESM-702) ---`. Comments are not indexed, because a comment can sit far from the tests it means. Item 5 moves those IDs into test names.
- **The displayed name drops a leading tag.** `ESM-702: exports a valid Visio package` shows as “exports a valid Visio package”, because the panel already shows the ID. A tag elsewhere in the name is left as written.
- **Line links use GitHub's form.** A test links to `<file>#L<line>`, resolved against `sourceBaseUrl`. GitLab and Bitbucket accept the same `#L` form for single lines.

## Suggested order

| Item | Name | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Find tagged tests | S | — |
| 2 | Write the tests index | S | 1 |
| 3 | Show tests in the story panel | M | 2 |
| 4 | Check test tags in validate | S | 1 |
| 5 | Tag this repository's tests | S | 1 |
| 6 | Document it | S | 2, 3, 4 |

Items 1, 2 and 4 can ship in one PR, with ESM-801 set to `in-progress`. Items 3, 5 and 6 can follow in a second PR, which sets ESM-801 to `merged`.

Every PR follows the repository's rules: update `product/story-map.yaml` in the same PR, run `npm run validate` and `npm test`, add a `## Unreleased` entry to `CHANGELOG.md`, and include the `story-map diff origin/main` summary in the PR description.

---

## 1. Find tagged tests

**Change.** Add `findStoryTests(loaded, root, { paths })` in a new `src/tests.ts`. It returns each tagged test with its story IDs, file, line, name and kind (`test` or `group`).

- Build the ID pattern from the map's story ID prefixes, the same way `checkPlanReferences` in `src/references.ts` does, so an ID only matches as a whole word, not as part of a longer ID or word. Share the helper rather than copying it.
- Walk the files with the same rules as `--plans`: paths that resolve outside the root, directly or through a symbolic link, are reported, not read.
- Skip files larger than 5 MB, as `maxMarkdownBytes` does for Markdown, and report them.
- Match calls with a small scanner, not a JavaScript parser, so there is no new dependency. It finds `test`, `it`, `describe` or `suite`, optionally followed by `.only`, `.skip`, `.todo`, `.each(…)` or `.concurrent`, then `(` and a string literal. It skips matches inside comments and other strings.
- Return results sorted by file, then line, so the output is the same every time.

**Tests.** Fixtures in `test/fixtures/story-tests/` covering: each call form; single, double and backtick quotes; escaped quotes in names; a name on the line after the call; two IDs in one name; IDs inside comments and other strings (not matched); IDs that are part of a longer word (not matched); a symbolic link out of the root; an oversized file.

## 2. Write the tests index

**Change.** Add `story-map tests [--tests <path>]… [--root <path>] [--out <file>] [<map.yaml>]`. It validates the map, runs `findStoryTests` and writes JSON for the board:

```json
{
  "version": 1,
  "generatedAt": "2026-11-21T12:00:00.000Z",
  "tests": [
    {
      "storyIds": ["ESM-702"],
      "file": "test/story-map.test.mjs",
      "line": 2189,
      "name": "ESM-702: exports the internal map as a valid Visio package",
      "kind": "test"
    }
  ]
}
```

- Add `parseStoryMapTests`, which validates the file with Zod, and a `StoryMapTests` type, with a compile-time check that they agree, as the history format has.
- Limits: at most 5,000 tests, names up to 250 code points, cut with “…” as `fitHistoryText` does, and at most 50 tests listed per story. Extra tests are counted, not listed.
- Tags naming stories that are not in the map are left out of the file, and the command prints a warning naming the first three. `validate --tests` is the place where they fail CI.
- Exit codes follow `history`: 0 when written, 1 for an invalid map, 2 for a usage error or a path outside the root.

The file holds no names of people, but it does describe internal code. Like the history file, it is passed to the view on the server, not served as a static asset.

**Tests.** The command's output on the fixtures, the warning for unknown IDs, `--out` and stdout, and that `parseStoryMapTests` rejects files over the limits.

## 3. Show tests in the story panel

**Change.**

- `getStoryMapForViewer` takes `tests` and attaches each story's entries to internal stories as `tests`. The customer projection is an allow-list, so it never includes them. Add a test that customer HTML and JSON contain no test names or file paths.
- The internal view also records `testsIndexed: true` when an index was supplied, so the panel can tell “no tests” from “no index”.
- `StoryDetail` in `src/react.tsx` adds a **Tests** section between **History** and **Engineering**:
  - a line per file, with its path, followed by that file's tests, each linking to `<file>#L<line>` through the same `resolveSources` rules, so only `http:` and `https:` links are made;
  - each test shows its name, without a leading tag, and its line number;
  - a tagged `describe` shows a group icon and “All tests in this group”;
  - the empty state from decision G;
  - “+N more in this file” when the per-story limit cut the list.
- New classes `esm-tests`, `esm-tests-file`, `esm-test`, `esm-test-line` and `esm-tests-empty`, with colours from the existing `--esm-*` properties, in both copies of the dark palette.
- The example host in `example/host.mjs` builds the index at start-up and passes it in.

**Tests.** The panel lists tests in order and grouped by file. Links resolve with `sourceBaseUrl`, and are plain text without it. The empty state appears only with an index. The section is absent on customer boards. The smoke test still passes with React 18 and 19.

## 4. Check test tags in validate

**Change.** Add `--tests <path>` to `validate`, repeatable, like `--plans`. With it, validate runs `findStoryTests` and reports:

- **error**: a tag naming a story that is not in the map, at the test's file and line, so `--format github` puts it on the PR diff;
- **warning**: an `in-progress` or `merged` story with no tagged tests, at the story in the map.

Without `--tests`, validate does not change.

**Tests.** Both issues on the fixtures, in text and GitHub formats, and that `--strict` makes the warning fail.

## 5. Tag this repository's tests

**Change.** Put story IDs in the names of the tests in `test/` that cover a story, starting with the export stories, ESM-701 to ESM-705, whose sections are already marked with comments. Remove the comments that the names replace. Add `--tests test` to `npm run validate` and to the validate steps in `ci.yml` and `release.yml`. Add `story-map tests` to the demo build so the example board shows them.

The warning in item 4 then lists the remaining `in-progress` and `merged` stories without tests. Tag what is clearly covered, and leave the rest as warnings to work through.

## 6. Document it

- `docs/story-map.md`: a new section, **Link tests to stories**, covering the naming convention, the build command, passing the index to the view, the panel and the validate checks. The guide is copied into host repositories by `init`, so keep it about using the feature.
- `docs/ENGINEERING-OVERVIEW.md`: a **Story tests** section on the scanner, the index format and its limits, and a line under **Security boundaries to preserve**: test names and paths are internal only, and the scanner never runs test code.
- `AGENTS.md` and `templates/AGENTS.md`: when adding or changing tests for a story, put its ID at the start of the test name.
- `story-map init`: add `--tests` to the CI workflow template only when the host has a test folder, so new hosts without tests get no errors.
- `CHANGELOG.md`: the new command, options, prop and view field.

## Security

- **Tests stay internal.** They are attached to internal views only, and the customer projection drops them by its allow-list.
- **No test code runs.** The scanner reads text. It never imports, requires or evaluates a test file.
- **Reads stay inside the repository**, with the same root and symbolic link checks as `--check-sources` and `--plans`.
- **Names render as text.** React escapes them, and only `http:` and `https:` links are made.
- **Bounded input.** The index has count and length limits, checked when it is parsed, so a large or hostile file cannot stall the page.

## Later: results

Pass and fail results are out of scope here, but the index is designed so they can join it. A follow-up could add `story-map tests --results <report>`, reading a JUnit XML report or `node --test` output from CI, and matching each result to a test by file and name. Each entry would gain `result` (`passed`, `failed` or `skipped`) and the index would gain the run's time and branch. The panel would then show an icon per test, a summary such as “1 failed, 4 passed”, and the failure message.

## Open questions

1. Should a tag on a `describe` apply to every test inside it, instead of being listed once? It would match how people group tests, but needs the scanner to track nesting.
2. Should shipped stories without tests be warned about too, perhaps only with `--strict`?
3. Should the card face show a test count? This plan keeps the card to the ID, title and status.
