import { csvContentType, storyMapToCsv } from "./export-csv.js";
import type { StoryMapExportOptions } from "./export.js";
import { storyMapToVsdx, vsdxContentType } from "./export-vsdx.js";
import { storyMapResponseHeaders, type StoryMapView } from "./view.js";

export const storyMapExportFormats = ["vsdx", "csv"] as const;
export type StoryMapExportFormat = (typeof storyMapExportFormats)[number];

export interface StoryMapExportResponseOptions extends Omit<StoryMapExportOptions, "collapsedReleases"> {
  /** `vsdx` or `csv`, usually the `format` query parameter. Anything else throws a `RangeError`. */
  format: string | null | undefined;
  /** Collapsed release IDs, as an array or the comma-separated `collapsed` query parameter. */
  collapsed?: string | readonly string[] | null;
  /** File name without its extension. Defaults to the map title as a slug, such as `builder-estimates`. */
  filename?: string;
}

export interface StoryMapExportResponse {
  body: Uint8Array | string;
  headers: Record<string, string>;
}

/** Letters, digits, dots, hyphens and underscores only, so the name is safe in a header. */
function fileSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 80);
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
    throw new RangeError(`format must be ${storyMapExportFormats.join(" or ")}, not ${format}`);
  }
  const collapsedReleases = (typeof collapsed === "string" ? collapsed.split(",") : collapsed ?? []).map(id => id.trim()).filter(Boolean);
  const exportOptions = { ...rest, collapsedReleases };
  const body = format === "csv" ? storyMapToCsv(view, exportOptions) : storyMapToVsdx(view, exportOptions);
  const name = fileSlug(filename ?? view.title) || "story-map";
  return {
    body,
    headers: {
      ...storyMapResponseHeaders,
      "Content-Type": format === "csv" ? csvContentType : vsdxContentType,
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
    },
  };
}
