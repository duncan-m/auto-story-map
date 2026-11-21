import { prepareStoryMapExport, type StoryMapExportOptions } from "./export.js";
import type { StoryMapView } from "./view.js";

/** The `Content-Type` for a `.csv` file. */
export const csvContentType = "text/csv; charset=utf-8";

const columns = ["Activity", "Release", "ID", "Title"] as const;

/**
 * Formats one CSV field. A field that a spreadsheet could read as a formula
 * (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) is prefixed
 * with `'`. Fields with a comma, quote or line break are quoted, with quotes
 * doubled, following RFC 4180.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Writes the internal map as CSV for importing into Lucidchart, Miro or a
 * spreadsheet: one row per story with its activity, release, ID and title, in
 * board order (release, then activity, then map order). A release in
 * `collapsedReleases` is one row with its title and story count instead of its
 * stories, and at most `maxStories` (200) of the most recently changed stories
 * are included. Release notes and impact are left out; the Visio file has them.
 *
 * Pass the unfiltered view from `getStoryMapForViewer`, with history if you have
 * it. Throws a `TypeError` for a customer view or a filtered view. The text
 * starts with a UTF-8 byte order mark so Excel reads non-ASCII titles, and uses
 * CRLF line endings.
 */
export function storyMapToCsv(view: StoryMapView, options: StoryMapExportOptions = {}): string {
  const model = prepareStoryMapExport(view, options);
  const rows: string[][] = [[...columns]];
  for (const release of model.releases) {
    if (release.collapsed) {
      rows.push(["", release.title, "", `Collapsed · ${release.storyCount} ${release.storyCount === 1 ? "story" : "stories"}`]);
      continue;
    }
    for (const activity of model.activities) {
      for (const story of release.cells.get(activity.id) ?? []) {
        rows.push([activity.title, release.title, story.id, story.title]);
      }
    }
  }
  return `﻿${rows.map(row => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
