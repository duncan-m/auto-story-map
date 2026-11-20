import { storyStatuses, type StoryStatus } from "./status.js";
import type { InternalStoryCard, StoryMapView } from "./view.js";

/** Windows offered by the board’s “Changed in” filter, in days. */
export const changedWithinOptions = [1, 7, 14, 30] as const;
export type ChangedWithinDays = (typeof changedWithinOptions)[number];

export interface StoryMapFilters {
  query?: string;
  status?: StoryStatus;
  /** Only stories added or changed in this many days. Needs history and an internal view. */
  changedWithinDays?: ChangedWithinDays;
}

export interface FilterOptions {
  /** Time to measure “changed in” windows from. Defaults to now. */
  now?: Date;
}

const maxQueryLength = 100;
const dayMs = 24 * 60 * 60 * 1000;

/** Reads the board’s `q`, `status` and `changed` (`1d`, `7d`, `14d` or `30d`) parameters. Unknown values are ignored. */
export function readStoryMapFilters(params: URLSearchParams): StoryMapFilters {
  const query = params.get("q")?.trim().slice(0, maxQueryLength) || undefined;
  const requested = params.get("status");
  const status = storyStatuses.find(status => status === requested);
  const changed = /^(\d+)d$/.exec(params.get("changed") ?? "")?.[1];
  const changedWithinDays = changedWithinOptions.find(days => String(days) === changed);
  return { query, status, ...(changedWithinDays ? { changedWithinDays } : {}) };
}

/**
 * Narrows a projected view to the stories that match the filters. Call it after
 * `getStoryMapForViewer`, so searches only see what the viewer is allowed to see.
 * The “changed in” filter applies only to internal views with history.
 */
export function filterStoryMapView<View extends StoryMapView>(
  view: View,
  filters: StoryMapFilters = {},
  options: FilterOptions = {},
): View {
  const query = filters.query?.trim().slice(0, maxQueryLength) || undefined;
  const needle = query?.toLocaleLowerCase();
  const status = filters.status && storyStatuses.includes(filters.status) ? filters.status : undefined;
  const internal = view.audience === "internal";
  const changedWithinDays = internal && view.history && changedWithinOptions.includes(filters.changedWithinDays!)
    ? filters.changedWithinDays
    : undefined;
  const since = changedWithinDays ? (options.now ?? new Date()).getTime() - changedWithinDays * dayMs : undefined;

  const stories = (view.stories as InternalStoryCard[]).filter(story => {
    if (status && story.status !== status) return false;
    if (since !== undefined && !(story.lastChangedAt && Date.parse(story.lastChangedAt) >= since)) return false;
    if (!needle) return true;
    const fields = internal
      ? [story.id, story.title, story.summary, story.notes]
      : [story.title, story.summary];
    return fields.some(field => field?.toLocaleLowerCase().includes(needle));
  });

  return {
    ...view,
    stories,
    filter: { query, status, ...(changedWithinDays ? { changedWithinDays } : {}), total: view.stories.length },
  };
}
