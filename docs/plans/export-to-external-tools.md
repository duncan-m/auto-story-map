# Plan: export the map to external tools

Status: built. Every item is done, and the Visio file imports well into Lucidchart and Miro. The CSV imports are still unchecked. Released in 0.7.0. The stories are in the **0.7.0** release of the map, which was planned as **Export to external tools**.

Internal viewers can download the board as a Visio file (`.vsdx`) or a CSV file and import it into Miro or Lucidchart. The export is a one-way snapshot: the YAML file stays the source of truth, and nothing edited in Miro or Lucidchart comes back.

Items are numbered in the order they should be built, and each section uses the same number:

1. [Check that Miro and Lucidchart import a test file](#1-check-that-miro-and-lucidchart-import-a-test-file) · ESM-701
2. [Write a Visio file from the internal view](#2-write-a-visio-file-from-the-internal-view) · ESM-702
3. [Export from the command line](#3-export-from-the-command-line) · ESM-703
4. [Download the export from the board](#4-download-the-export-from-the-board) · ESM-704
5. [Export the map as CSV](#5-export-the-map-as-csv) · ESM-705
6. [Check exported files in CI](#6-check-exported-files-in-ci) (chore, part of ESM-702)

All stories are internal. None of them changes customer-facing copy.

## Decisions made

| Question | Decision |
| --- | --- |
| A. Which tools come first | Test both Miro and Lucidchart imports with a hand-made file before building anything (item 1). |
| B. Who can export | Any viewer who sees the internal map. Customers cannot export. |
| C. What the export contains | The whole map, ignoring the search and status filters, so blocked and cut stories are included. A release lane the viewer collapsed on the board is exported as a collapsed lane: its header and story count, without its stories. |
| D. Round trip | One way only, for now. |
| E. What each card shows | The story's ID and title. |
| F. Release notes and impact | Included in each release lane, with drafted impact items labelled **Draft**. |
| G. Zip writer | Hand-rolled, with no new dependency. If imports fail because of the zip, revisit and use `fflate`. |
| H. CSV | Included, because it is cheap once the export view exists. |
| I. LibreOffice check in CI | Runs only when export code or its fixtures change, not on every PR. |
| J. Large maps | At most 200 stories, the most recently changed. |
| K. Where the stories go | A new release called **Export to external tools**. |

### Assumptions to confirm

These fill small gaps in the decisions above. Each is easy to change during review.

- **Collapsed lanes come from the browser.** The board remembers collapsed lanes in the viewer's `localStorage` (see `src/board.ts`), so the server cannot know them. The optional `board.js` script adds them to the download link as `?collapsed=<release IDs>`. Without the script, no lane is collapsed in the export.
- **"Most recently changed"** uses each story's `lastEdit` date, then its `lastChangedAt` date, when the host supplies history. Without history, the last 200 stories in file order are kept, because new stories are usually added at the end. Stories in collapsed lanes do not count towards the 200. The kept stories stay in their normal cells, and the export says how many were left out.
- **Status is not shown as text or colour on the card**, following decision E. Status, activity and release go in the card's shape data, so Lucidchart can still filter by them. If cards look too alike in practice, a status colour is a one-line change.
- **A Visio export from a customer view is refused** by the library itself, not only by the host route, so a host cannot leak internal details by mistake.

## Suggested order

| Item | Name | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Check that Miro and Lucidchart import a test file | XS | — |
| 2 | Write a Visio file from the internal view | M | 1 |
| 6 | Check exported files in CI | S | 2 |
| 3 | Export from the command line | S | 2 |
| 5 | Export the map as CSV | S | 2 (the shared export view) |
| 4 | Download the export from the board | S | 2, 5 |

Item 1 needs no PR, only a note of the results in this plan. Items 2 and 6 ship in one PR. Items 3, 4 and 5 can each be a PR, or 3 and 5 can share one.

Every PR follows the repository's rules: update `product/story-map.yaml` in the same PR (`planned` → `in-progress` → `merged`), run `npm run validate` and `npm test`, add a `## Unreleased` entry to `CHANGELOG.md`, and include the `story-map diff origin/main` summary in the PR description.

---

## 1. Check that Miro and Lucidchart import a test file

**Why first.** The code is not the main risk: whether the target tools import the file faithfully is. Miro's Visio import may depend on the plan, and may drop styling or shape data. Finding out now decides whether Miro gets `.vsdx` or only CSV.

**Change.**

1. Hand-write a minimal `.vsdx` with one page holding:
   - two activity headers, two release lanes (one of them collapsed, showing only its header and story count) and four story cards with an ID and a title;
   - a release notes block with one impact item labelled **Draft**;
   - shape data (`ID`, `Status`, `Activity`, `Release`) on each card;
   - a title long enough to overflow its card, and text with `&`, `<` and an emoji, to test escaping and fonts.
2. Zip it with the hand-rolled approach planned for item 2, stored without compression, so the zip writer is tested too.
3. Import it into Lucidchart and Miro, and open it in LibreOffice Draw.
4. Hand-write a matching CSV and import it into both tools.

**Test files.** `scripts/make-export-test-files.mjs` writes them to `test/fixtures/export-spike/`. To regenerate them, run `node scripts/make-export-test-files.mjs`.

- `story-map-test.vsdx`: one page, 9.4 × 5.7 inches, with 11 shapes. It has no stencils or masters, and the zip is stored without compression.
- `story-map-test.csv`: the same stories, plus a `TEST-1` row whose title starts with `=` to check that spreadsheets don't run it as a formula.
- `story-map-test.libreoffice.png`: how LibreOffice draws the `.vsdx`. Use it as the reference when comparing imports.

**What to check in each tool.** Did the file open? Did positions, sizes and colours survive? Did the text and its bold, italic and grey styling survive, and does it wrap? What happens to the ESM-702 title, which is too long for its card? Do `&`, `<`, the curly quotes and the 🚀 show correctly? Did shape data (ID, Status, Activity, Release) survive? Which plan was used?

**Results.**

| Tool | Opened | Layout and colours | Text and styling | Overflow | Shape data | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| LibreOffice Draw 24.2 (`soffice --headless`) | Yes | Correct | Correct, except styling after non-ASCII characters (see below) | Text spills below the card | Not checked | The stored zip and all 10 XML parts read cleanly. |
| Lucidchart | Yes | Correct, and matches the LibreOffice reference | Correct, including grey and italic after "·" | Text spills below the card | Not checked | Curly quotes became straight quotes, and the 🚀 was dropped. `&`, `<` and `·` came through. |
| Lucidchart, built export (ESM-702) | Yes | Correct | Correct | None seen | Not checked | Tested with this repository's map. Card text looked small for the card size. |
| Miro, built export (ESM-702) | Yes | Activity headers and cards in place | Release headers spilled out of their lanes, over the lane above and the next one. Card text was small | Release header text | Not checked | Miro appears to centre the paragraphs of a tall shape and space them further apart. See the follow-up below. |
| Lucidchart, final layout | Yes | Correct | Correct | None seen | Not checked | Works. |
| Miro, final layout | Yes | Correct | Correct, including card text size | None seen | Not checked | Works. |
| Lucidchart, CSV | Skipped | | | | | |
| Miro, CSV | Skipped | | | | | |

LibreOffice applies styling from the wrong position after non-ASCII characters. After the two "·" in the story counts line, the grey style carries into the first letter of the notes, and the italic in the impact line starts 8 characters late. With ASCII hyphens instead, every style lands correctly, so the XML is right and this is how LibreOffice reads it. Lucidchart places the styling correctly, so this only affects LibreOffice. For ESM-702, keep using text runs, and only switch to a shape per styled line if Miro also shows the shift.

Lucidchart replaced curly quotes with straight ones and dropped the emoji. Neither affects reading the map, so the export writes text as it is. The docs for ESM-702 should mention that emoji may not survive the import.

**Follow-up after testing the built export.** Each release header was one tall shape holding the title, counts, notes and impact as paragraphs, which Miro placed badly. As planned above, each header line is now its own shape, sized to its estimated text, so no tool has to place paragraphs within a shape. This also removes the LibreOffice styling shift, because each shape has one style. Card titles went from 10 to 11 points, and cards are now only as tall as the longest title in their lane needs, so they are no longer mostly empty. On the second import, Lucidchart looked good, and Miro kept every header inside its lane, but its card titles were as small as the 8-point IDs above them. Miro seems to use one text size for all the text in a shape, taken from its first paragraph. So every shape now uses a single size: card IDs and titles are both 11 points, with the ID in grey, and the map title and export date are separate shapes. A test checks that no shape mixes sizes. A third import, with one size per shape, worked in both Lucidchart and Miro.

**Outcome.** Lucidchart works, so the Visio export goes ahead as planned with the hand-rolled zip and text runs. Miro and the CSV imports were skipped to keep moving. Until someone tries them, the docs say the `.vsdx` is tested with Lucidchart, and that Miro users should try it and fall back to CSV (ESM-705) if the import is poor.

## 2. Write a Visio file from the internal view

**Goal.** A pure function the CLI and host routes share:

```ts
export interface StoryMapExportOptions {
  /** Release IDs the viewer collapsed on the board. */
  collapsedReleases?: readonly string[];
  /** Defaults to 200. */
  maxStories?: number;
}

export function storyMapToVsdx(view: StoryMapView, options?: StoryMapExportOptions): Uint8Array;
```

It is exported from `auto-story-map`, uses no Node-only APIs, and throws a `TypeError` when `view.audience` is not `"internal"` (decision B).

**Change.**

1. **Export view** (`src/export.ts`). One function, `prepareStoryMapExport(view, options)`, used by both Visio and CSV. It:
   - rejects customer views;
   - marks collapsed releases, ignoring unknown IDs;
   - keeps the 200 most recently changed stories outside collapsed lanes, as described in the assumptions, and records how many were left out;
   - returns activities, releases (with notes, impact, story counts and a `collapsed` flag) and the cells' stories in map order.

   It takes the unfiltered view: callers should not apply `filterStoryMapView` first (decision C). The docs say so, and the host route in item 4 builds the view without filters.
2. **Zip writer** (`src/zip.ts`). It writes stored, uncompressed entries with a CRC-32 table, local file headers, a central directory and the end record. It uses UTF-8 names with general-purpose flag bit 11 set, and a fixed timestamp so output is stable for tests. About 60 lines, with no dependency.
3. **Visio parts** (`src/export-vsdx.ts`). The minimum package:
   - `[Content_Types].xml`, `_rels/.rels`, `docProps/app.xml` and `docProps/core.xml`;
   - `visio/document.xml` and `visio/_rels/document.xml.rels`;
   - `visio/pages/pages.xml`, `visio/pages/_rels/pages.xml.rels` and `visio/pages/page1.xml`.

   It uses no stencils or masters. Each shape is a rectangle with its own `Geometry` section, fill, line and `Text`. Every string goes through one XML escape helper, which also drops characters XML 1.0 does not allow.
4. **Layout** (`src/export-layout.ts`, kept separate from the XML so it can be tested on its own). It works in inches, which is what Visio uses:
   - a title row with the map title and the export date, and the "Showing 200 of N stories" note when stories were left out;
   - activity headers across the top in map order, in fixed-width columns;
   - one lane per release, in map order. A lane's left header shows the release title, the story counts, its notes and its impact items, each marked **Draft** where drafted. A collapsed lane is a single header row labelled "Collapsed · N stories";
   - cards stacked down each cell in map order. A lane is as tall as its tallest cell;
   - a fixed card size showing `ID` on one line and the title below. Titles are cut with "…" to fit, because Visio does not auto-size text, and the full title stays in shape data;
   - the page size set to fit everything;
   - a final step that flips y, because Visio's origin is bottom-left with y going up.
5. **Shape data.** Each card gets a `Property` section with `ID`, `Title`, `Status`, `Activity` and `Release`. Lanes get `Release` and `Collapsed`.
6. **Docs.** A new "Export the map" section in `docs/story-map.md` covers the API, the audience rule, the 200-story limit and the import steps for each tool. Add the new files to the code map in `docs/ENGINEERING-OVERVIEW.md`, and add the export to [Security boundaries to preserve](../ENGINEERING-OVERVIEW.md#security-boundaries-to-preserve).

**Built.** As planned, with these choices made while building it:

- `prepareStoryMapExport` also refuses a filtered view (`view.filter` is set), so a host can't export part of the map by mistake.
- Card shape data uses readable status labels, such as "In progress".
- Lane heights grow to fit the release header's text. Wrapping is estimated from an average character width, because Visio does not size text itself.
- Only `storyMapToVsdx`, `vsdxContentType` and `StoryMapExportOptions` are public. `prepareStoryMapExport` stays internal until the CSV export (ESM-705) needs it.

**Tests** (`test/story-map.test.mjs`):

- The zip round-trips with a small test-only reader, and the CRCs match.
- Every part is well-formed XML and is listed in `[Content_Types].xml`, and every relationship target exists.
- A customer view throws.
- Collapsed lanes have no card shapes, and their header shows the count.
- With 250 stories, 200 cards are written, the newest by history are kept, and the note says 50 were left out.
- Text with `&`, `<`, quotes and emoji is escaped.
- Output is byte-identical across runs given the same input and `now`.

## 3. Export from the command line

**Change.** Add an `export` command to `src/cli.ts`, following the option parsing used by `validate` and `diff`:

```bash
npx --no-install story-map export product/story-map.yaml --format vsdx --output story-map.vsdx
```

- `--format vsdx|csv`. Required, so adding formats later breaks nothing.
- `--output <file>`. Defaults to `story-map.<format>`. `-` writes to stdout, which is useful for CSV.
- `--history <file>`. Optional. A history file from `story-map history`, used to choose the most recent stories.
- `--collapsed <release IDs>`. Optional, comma-separated.
- `--max-stories <n>`. Optional, defaults to 200.

The CLI always builds the internal view, because whoever runs it already has the YAML file. It validates the map first and exits non-zero on errors, as `validate` does.

**Built.** As planned, with these choices made while building it:

- Only `--format vsdx` is accepted until the CSV export (ESM-705) adds `csv`. Any other format exits 2 and names the formats it accepts.
- The map path is optional and defaults to `product/story-map.yaml`, like `--map` in `diff` and `history`.
- `--collapsed` can be repeated, and warns about IDs that are not releases in the map rather than ignoring them silently.
- It reports what it wrote on stderr, such as `story-map.vsdx: exported 180 stories (left out 20 less recently changed)`, so stdout stays clean for `--output -`.
- Exit codes follow the other commands: 2 for a problem with the command line, and 1 for an invalid map or an unreadable history file.

**Tests.** Run the CLI against `test/fixtures/builder-estimates.yaml`, check the exit codes, check that a missing `--format` fails, and check that the output opens with the test zip reader.

## 4. Download the export from the board

**Change.**

1. **A prop on `StoryMapBoard`:** `exportHref?: string`. When it is set and the view is internal, the board's header shows **Export** with two links: *Visio (.vsdx), for Lucidchart or Miro* and *CSV*. Each link appends `format=vsdx` or `format=csv` to the host's URL. The board never shows the links on a customer view, even when `exportHref` is set.
2. **`board.js`:** when the viewer collapses or expands a lane, it also updates `collapsed=<IDs>` on the export links, reusing the IDs it already keeps in `localStorage`. Without the script, the links work and export every lane expanded.
3. **A helper for host routes:** `storyMapExportResponse(view, { format, collapsed })` returns `{ body, headers }`, with the right `Content-Type` (`application/vnd.ms-visio.drawing.main+xml` or `text/csv; charset=utf-8`), `Content-Disposition: attachment; filename="<map id>.vsdx"` and `Cache-Control: no-store`. It throws for customer views, so the host can return 403 or 404.
4. **Example and docs.** Add the route to `example/host.mjs`, and a host-route example to `docs/story-map.md` that builds the view with `getStoryMapForViewer` and history, without filters.

**Built.** As planned, with these choices made while building it:

- The view has no map ID, so the file is named after a slug of the map title, such as `builder-estimates-delivery-map.vsdx`. Hosts can pass `filename`. Adding the ID to the view would have put it in the customer JSON too.
- `storyMapExportResponse` takes `format` and `collapsed` straight from the query parameters, and throws a `RangeError` for an unknown format, so the host can answer 400. Its headers are `storyMapResponseHeaders` (`Cache-Control: private, no-store`) plus the file's.
- The links keep any query string on `exportHref`, so the example host keeps its own parameters, such as the demo's role.
- `board.js` takes the collapsed IDs from the board's own toggles rather than `localStorage`, so two boards on one page each get their own.
- The demo server now sends the response as bytes, so the `.vsdx` download is not corrupted.

**Tests.** Rendering with `exportHref` shows the links for internal views and never for customer views. The helper returns the right headers and throws for customers. The `board.js` change keeps `collapsed` in step with the lanes.

## 5. Export the map as CSV

**Change.** `storyMapToCsv(view, options)` in `src/export-csv.ts` uses the same `prepareStoryMapExport`. It writes one row per story with columns `Activity`, `Release`, `ID` and `Title`, in board order (release, then activity, then map order). A collapsed release gets one row with `Release` set and `Title` set to "Collapsed · N stories". Release notes and impact are left out, because they do not fit one row per story. The Visio file carries them.

Fields follow RFC 4180: they are quoted when needed, with doubled quotes and CRLF line endings. A field that starts with `=`, `+`, `-` or `@` is prefixed with `'`, so spreadsheet tools do not run it as a formula. The file starts with a UTF-8 BOM so Excel reads non-ASCII titles correctly.

**Built.** As planned, with these choices made while building it:

- `storyMapToCsv` returns a string, and `csvContentType` is `text/csv; charset=utf-8`.
- `Activity` and `Release` hold titles rather than IDs, because they are what people read in Miro or a spreadsheet. A collapsed release's row leaves `Activity` and `ID` empty.
- A field starting with a tab or a carriage return is also prefixed with `'`, following OWASP's advice on CSV injection.
- `prepareStoryMapExport` stays internal. Both writers use it, but no host needs it yet.
- `story-map export --format csv` writes the file, reporting left-out stories on stderr as for Visio, because the CSV has no room to say so.

**Tests.** Quoting and commas, formula-looking titles, collapsed rows, the 200-story limit, and the customer view being refused.

## 6. Check exported files in CI

**Change.** Add a `vsdx-opens` job to `.github/workflows/ci.yml`. It runs only on pull requests that change `src/export*.ts`, `src/zip.ts` or `test/fixtures/**`, using a `dorny/paths-filter` step pinned to a commit SHA, or a separate workflow with a `paths` filter (decision I). It:

1. installs LibreOffice with `apt-get install -y --no-install-recommends libreoffice-draw`;
2. builds and runs `story-map export test/fixtures/builder-estimates.yaml --format vsdx --output out.vsdx`;
3. runs `soffice --headless --convert-to pdf out.vsdx` and fails if no PDF is produced.

This only shows the file is well-formed enough for a third-party reader. Fidelity in Miro and Lucidchart is still checked by hand before the release, using item 1's checklist.

## Not now

- **Importing changes back** from Miro or Lucidchart (decision D).
- **Miro or Lucidchart API integrations** that create a board directly. These need OAuth and per-tool code, so the files come first.
- **Customer exports** (decision B).
- **draw.io XML or PDF export.** These are easy to add once the export view exists, if someone asks.
- **More than 200 stories, or several pages.**
