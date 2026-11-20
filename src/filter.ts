import { isActiveStatus, storyStatuses, type StoryStatus } from "./status.js";
import type { InternalStoryCard, StoryMapView } from "./view.js";

/** Windows offered by the board’s “Changed in” filter, in days. */
export const changedWithinOptions = [1, 7, 14, 30] as const;
export type ChangedWithinDays = (typeof changedWithinOptions)[number];

export interface StoryMapFilters {
  query?: string;
  /**
   * One status, or `all` for every story. When absent, only active stories
   * (planned, in progress and shipped) are kept, and blocked and cut stories are hidden.
   */
  status?: StoryStatus | "all";
  /** Only stories added or changed in this many days. Needs history and an internal view. */
  changedWithinDays?: ChangedWithinDays;
}

export interface FilterOptions {
  /** Time to measure “changed in” windows from. Defaults to now. */
  now?: Date;
}

const maxQueryLength = 100;
const dayMs = 24 * 60 * 60 * 1000;

function readStatus(value: unknown): StoryStatus | "all" | undefined {
  return value === "all" ? "all" : storyStatuses.find(status => status === value);
}

/**
 * Reads the board’s `q`, `status` (a status or `all`) and `changed` (`1d`, `7d`,
 * `14d` or `30d`) parameters. Unknown values are ignored.
 */
export function readStoryMapFilters(params: URLSearchParams): StoryMapFilters {
  const query = params.get("q")?.trim().slice(0, maxQueryLength) || undefined;
  const status = readStatus(params.get("status"));
  const changed = /^(\d+)d$/.exec(params.get("changed") ?? "")?.[1];
  const changedWithinDays = changedWithinOptions.find(days => String(days) === changed);
  return { query, status, ...(changedWithinDays ? { changedWithinDays } : {}) };
}

/**
 * Narrows a projected view to the stories that match the filters. Call it after
 * `getStoryMapForViewer`, so searches only see what the viewer is allowed to see.
 * Without a status filter, blocked and cut stories are hidden and counted in
 * `filter.hidden`. The “changed in” filter applies only to internal views with history.
 */
export function filterStoryMapView<View extends StoryMapView>(
  view: View,
  filters: StoryMapFilters = {},
  options: FilterOptions = {},
): View {
  const query = filters.query?.trim().slice(0, maxQueryLength) || undefined;
  const needle = query?.toLocaleLowerCase();
  const status = readStatus(filters.status);
  const internal = view.audience === "internal";
  const changedWithinDays = internal && view.history && changedWithinOptions.includes(filters.changedWithinDays!)
    ? filters.changedWithinDays
    : undefined;
  const since = changedWithinDays ? (options.now ?? new Date()).getTime() - changedWithinDays * dayMs : undefined;

  const hidden = { blocked: 0, cut: 0 };
  const stories = (view.stories as InternalStoryCard[]).filter(story => {
    if (status && status !== "all" && story.status !== status) return false;
    if (since !== undefined && !(story.lastChangedAt && Date.parse(story.lastChangedAt) >= since)) return false;
    if (needle) {
      const fields = internal
        ? [story.id, story.title, story.summary, story.notes, story.statusReason]
        : [story.title, story.summary];
      if (!fields.some(field => field?.toLocaleLowerCase().includes(needle))) return false;
    }
    if (!status && !isActiveStatus(story.status)) {
      hidden[story.status as keyof typeof hidden]++;
      return false;
    }
    return true;
  });

  return {
    ...view,
    stories,
    filter: {
      query,
      status,
      ...(changedWithinDays ? { changedWithinDays } : {}),
      total: view.stories.length,
      ...(hidden.blocked || hidden.cut ? { hidden } : {}),
    },
  };
}
