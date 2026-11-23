import type { ReleaseImpact } from "./schema.js";
import { storyStatuses, storyStatusLabels, type StoryStatus } from "./status.js";
import type { InternalStoryCard, ReleaseEstimates, StoryMapLabel, StoryMapView } from "./view.js";

export interface StoryMapExportOptions {
  /** Release IDs the viewer collapsed on the board. Their lanes are exported as a header and a story count. Unknown IDs are ignored. */
  collapsedReleases?: readonly string[];
  /** Most stories to export, from lanes that are not collapsed. The most recently changed are kept. Defaults to 200. */
  maxStories?: number;
  /** Date shown as the export date. Defaults to now. */
  now?: Date;
}

export const defaultExportMaxStories = 200;

export interface ExportStory {
  id: string;
  title: string;
  status: StoryStatus;
  activity: string;
  release: string;
  /** Story points. */
  estimate?: number;
  /** Titles of the personas the story is for, primary first. Absent when it names none. */
  personas?: string[];
  /** IDs of the jobs to be done the story serves, most important first. Absent when it names none. */
  jobs?: string[];
}

export interface ExportRelease {
  id: string;
  title: string;
  collapsed: boolean;
  /** Stories in the release, counted before the export limit, such as “4 stories · 1 shipped, 3 planned”. */
  countsText: string;
  storyCount: number;
  /** The release’s points, such as “21 pts · 5 merged · 8 left · 2 unestimated”. Absent when no story in it has an estimate. */
  estimatesText?: string;
  /** Paragraphs of the release notes. */
  notes: string[];
  impact: ReleaseImpact[];
  /** Exported stories by activity ID, in map order. Empty for collapsed releases. */
  cells: Map<string, ExportStory[]>;
}

export interface StoryMapExport {
  title: string;
  /** True when the map has personas, so the CSV export adds its Personas and Jobs columns. */
  hasPersonas: boolean;
  exportedOn: string;
  activities: StoryMapLabel[];
  releases: ExportRelease[];
  /** Stories outside collapsed lanes. */
  available: number;
  /** Stories left out by `maxStories`. */
  omitted: number;
}

const storyWord = (n: number) => `${n} ${n === 1 ? "story" : "stories"}`;

/** “4 stories · 1 shipped, 3 planned”, in status order, without zero counts. */
export function storyCountsText(counts: Record<StoryStatus, number>): string {
  const total = storyStatuses.reduce((sum, status) => sum + counts[status], 0);
  const parts = storyStatuses.filter(status => counts[status] > 0).map(status => `${counts[status]} ${storyStatusLabels[status].toLowerCase()}`);
  return parts.length ? `${storyWord(total)} · ${parts.join(", ")}` : storyWord(total);
}

/** “21 pts · 5 merged · 8 left · 2 unestimated”, as on the board’s release lane. Merged is left out when it is 0. */
export function releaseEstimatesText({ total, merged, left, unestimated }: ReleaseEstimates): string {
  return `${total} ${total === 1 ? "pt" : "pts"}${merged ? ` · ${merged} merged` : ""} · ${left} left${unestimated ? ` · ${unestimated} unestimated` : ""}`;
}

/** Last change time in ms, or -Infinity when the history does not say. */
function changedAt(story: InternalStoryCard) {
  const at = Date.parse(story.lastEdit?.at ?? story.lastChangedAt ?? "");
  return Number.isNaN(at) ? -Infinity : at;
}

/**
 * Prepares the internal view for export: marks collapsed lanes and keeps at most
 * `maxStories` of the most recently changed stories. Shared by every export format.
 *
 * Takes the view from `getStoryMapForViewer`, without filters: an export is the
 * whole map. Throws a `TypeError` for a customer view or a filtered view.
 */
export function prepareStoryMapExport(view: StoryMapView, options: StoryMapExportOptions = {}): StoryMapExport {
  if (view.audience !== "internal") {
    throw new TypeError("Only the internal view can be exported. Customers cannot export the story map.");
  }
  if (view.filter) {
    throw new TypeError("Export the unfiltered view from getStoryMapForViewer: an export includes the whole map.");
  }
  const maxStories = options.maxStories ?? defaultExportMaxStories;
  if (!Number.isInteger(maxStories) || maxStories < 1) {
    throw new RangeError(`maxStories must be a whole number of at least 1, not ${maxStories}.`);
  }

  const collapsed = new Set(options.collapsedReleases ?? []);
  const available = view.stories
    .map((story, index) => ({ story, index }))
    .filter(({ story }) => !collapsed.has(story.release));

  // Newest first. Without dates, later stories in the file count as newer.
  const kept = new Set(
    [...available]
      .sort((a, b) => changedAt(b.story) - changedAt(a.story) || b.index - a.index)
      .slice(0, maxStories)
      .map(({ story }) => story),
  );

  const personaTitles = new Map((view.personas ?? []).map(persona => [persona.id, persona.title]));
  const releases: ExportRelease[] = view.releases.map(release => {
    const isCollapsed = collapsed.has(release.id);
    const cells = new Map<string, ExportStory[]>(view.activities.map(activity => [activity.id, []]));
    if (!isCollapsed) {
      for (const story of view.stories) {
        if (story.release !== release.id || !kept.has(story)) continue;
        cells.get(story.activity)?.push({
          id: story.id,
          title: story.title,
          status: story.status,
          activity: story.activity,
          release: story.release,
          ...(story.estimate !== undefined ? { estimate: story.estimate } : {}),
          ...(story.personas?.length ? { personas: story.personas.map(id => personaTitles.get(id) ?? id) } : {}),
          ...(story.jobs?.length ? { jobs: [...story.jobs] } : {}),
        });
      }
    }
    return {
      id: release.id,
      title: release.title,
      collapsed: isCollapsed,
      countsText: storyCountsText(release.storyCounts),
      storyCount: storyStatuses.reduce((sum, status) => sum + release.storyCounts[status], 0),
      ...(release.estimates ? { estimatesText: releaseEstimatesText(release.estimates) } : {}),
      notes: (release.notes ?? "").split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean),
      impact: release.impact ?? [],
      cells,
    };
  });

  return {
    title: view.title,
    hasPersonas: personaTitles.size > 0,
    exportedOn: (options.now ?? new Date()).toISOString().slice(0, 10),
    activities: view.activities,
    releases,
    available: available.length,
    omitted: Math.max(0, available.length - kept.size),
  };
}
