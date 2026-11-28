import { csvContentType, storyMapToCsv } from "./export-csv.js";
import type { StoryMapExportOptions } from "./export.js";
import { jsonContentType, storyMapToJson } from "./export-json.js";
import { storyMapToVsdx, vsdxContentType } from "./export-vsdx.js";
import { storyMapResponseHeaders, type StoryMapView } from "./view.js";

export const storyMapExportFormats = ["vsdx", "csv", "json"] as const;
export type StoryMapExportFormat = (typeof storyMapExportFormats)[number];

export interface StoryMapExportResponseOptions extends Omit<StoryMapExportOptions, "collapsedReleases"> {
  /** `vsdx`, `csv` or `json`, usually the `format` query parameter. Anything else throws a `RangeError`. */
  format: string | null | undefined;
  /** Collapsed release IDs, as an array or the comma-separated `collapsed` query parameter. Ignored for `json`, which includes every release. */
  collapsed?: string | readonly string[] | null;
  /** File name without its extension. Defaults to the map title as a slug, such as `builder-estimates`. */
  filename?: string;
}

export interface StoryMapExportResponse {
  body: Uint8Array | string;
  headers: Record<string, string>;
}

/** Letters, digits, dots, hyphens and underscores only, so the name is safe in a header. */
export function fileSlug(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  // Trim leading hyphens and dots and trailing hyphens with a scan from each
  // end, which stays linear on long runs of hyphens (ESM-175).
  let start = 0;
  while (start < slug.length && (slug[start] === "-" || slug[start] === ".")) start++;
  let end = slug.length;
  while (end > start && slug[end - 1] === "-") end--;
  return slug.slice(start, end).slice(0, 80);
}

/**
 * Builds a download of the internal map for a host route, such as
 * `/story-map/export?format=vsdx&collapsed=v0-1`. Returns the body and headers,
 * including `Content-Disposition: attachment` and `Cache-Control: private, no-store`.
 *
 * Pass the unfiltered view from `getStoryMapForViewer`. Throws a `TypeError` for a
 * customer view or a filtered view, so the host can answer 403, and a
 * `RangeError` for an unknown format, so the host can answer 400.
 */
export function storyMapExportResponse(view: StoryMapView, options: StoryMapExportResponseOptions): StoryMapExportResponse {
  const { format, collapsed, filename, ...rest } = options;
  if (!storyMapExportFormats.includes(format as never)) {
    throw new RangeError(`format must be ${storyMapExportFormats.join(", ")}, not ${format}`);
  }
  const collapsedReleases = (typeof collapsed === "string" ? collapsed.split(",") : collapsed ?? []).map(id => id.trim()).filter(Boolean);
  const exportOptions = { ...rest, collapsedReleases };
  const body = format === "csv" ? storyMapToCsv(view, exportOptions)
    : format === "json" ? storyMapToJson(view, rest)
    : storyMapToVsdx(view, exportOptions);
  const name = fileSlug(filename ?? view.title) || "story-map";
  return {
    body,
    headers: {
      ...storyMapResponseHeaders,
      "Content-Type": format === "csv" ? csvContentType : format === "json" ? jsonContentType : vsdxContentType,
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
    },
  };
}
