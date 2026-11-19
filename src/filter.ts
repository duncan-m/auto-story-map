import { storyStatuses, type StoryStatus } from "./status.js";
import type { InternalStoryCard, StoryMapView } from "./view.js";

export interface StoryMapFilters {
  query?: string;
  status?: StoryStatus;
}

const maxQueryLength = 100;

/** Reads the board's `q` and `status` search parameters. Unknown statuses are ignored. */
export function readStoryMapFilters(params: URLSearchParams): StoryMapFilters {
  const query = params.get("q")?.trim().slice(0, maxQueryLength) || undefined;
  const requested = params.get("status");
  const status = storyStatuses.find(status => status === requested);
  return { query, status };
}

/**
 * Narrows a projected view to the stories that match the filters. Call it after
 * `getStoryMapForViewer`, so searches only see what the viewer is allowed to see.
 */
export function filterStoryMapView<View extends StoryMapView>(view: View, filters: StoryMapFilters = {}): View {
  const query = filters.query?.trim().slice(0, maxQueryLength) || undefined;
  const needle = query?.toLocaleLowerCase();
  const status = filters.status && storyStatuses.includes(filters.status) ? filters.status : undefined;
  const internal = view.audience === "internal";

  const stories = (view.stories as InternalStoryCard[]).filter(story => {
    if (status && story.status !== status) return false;
    if (!needle) return true;
    const fields = internal
      ? [story.id, story.title, story.summary, story.notes]
      : [story.title, story.summary];
    return fields.some(field => field?.toLocaleLowerCase().includes(needle));
  });

  return { ...view, stories, filter: { query, status, total: view.stories.length } };
}
