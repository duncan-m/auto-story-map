# Plan: export the map to external tools

Status: proposed. Nothing here is built yet. The stories are in the **Export to external tools** release of the map. The version number is decided when the release is cut. It adds features without breaking anything, so it would be a minor version after 0.6.0.

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

**Record here** for each tool: whether it opened, whether positions, sizes, text and wrapping survived, whether shape data survived, and which Miro plan was used.

**Outcome.** If Miro's Visio import is poor or unavailable, the board's download menu recommends CSV for Miro, and item 4's docs say so. If no tool opens the stored zip, use `fflate` in item 2 (decision G).

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

**Tests.** Run the CLI against `test/fixtures/builder-estimates.yaml`, check the exit codes, check that a missing `--format` fails, and check that the output opens with the test zip reader.

## 4. Download the export from the board

**Change.**

1. **A prop on `StoryMapBoard`:** `exportHref?: string`. When it is set and the view is internal, the board's header shows **Export** with two links: *Visio (.vsdx), for Lucidchart or Miro* and *CSV*. Each link appends `format=vsdx` or `format=csv` to the host's URL. The board never shows the links on a customer view, even when `exportHref` is set.
2. **`board.js`:** when the viewer collapses or expands a lane, it also updates `collapsed=<IDs>` on the export links, reusing the IDs it already keeps in `localStorage`. Without the script, the links work and export every lane expanded.
3. **A helper for host routes:** `storyMapExportResponse(view, { format, collapsed })` returns `{ body, headers }`, with the right `Content-Type` (`application/vnd.ms-visio.drawing.main+xml` or `text/csv; charset=utf-8`), `Content-Disposition: attachment; filename="<map id>.vsdx"` and `Cache-Control: no-store`. It throws for customer views, so the host can return 403 or 404.
4. **Example and docs.** Add the route to `example/host.mjs`, and a host-route example to `docs/story-map.md` that builds the view with `getStoryMapForViewer` and history, without filters.

**Tests.** Rendering with `exportHref` shows the links for internal views and never for customer views. The helper returns the right headers and throws for customers. The `board.js` change keeps `collapsed` in step with the lanes.

## 5. Export the map as CSV

**Change.** `storyMapToCsv(view, options)` in `src/export-csv.ts` uses the same `prepareStoryMapExport`. It writes one row per story with columns `Activity`, `Release`, `ID` and `Title`, in board order (release, then activity, then map order). A collapsed release gets one row with `Release` set and `Title` set to "Collapsed · N stories". Release notes and impact are left out, because they do not fit one row per story. The Visio file carries them.

Fields follow RFC 4180: they are quoted when needed, with doubled quotes and CRLF line endings. A field that starts with `=`, `+`, `-` or `@` is prefixed with `'`, so spreadsheet tools do not run it as a formula. The file starts with a UTF-8 BOM so Excel reads non-ASCII titles correctly.

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
