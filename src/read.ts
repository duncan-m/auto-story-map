import { toJsonStory, type StoryMapJsonStory } from "./export-json.js";
import { filterStoryMapView, type StoryMapFilters } from "./filter.js";
import type { StoryMapFilterState, StoryMapView } from "./view.js";

type InternalView = Extract<StoryMapView, { audience: "internal" }>;

/** What `findStories` looks for: the board's filters, plus releases and activities. */
export interface StoryQuery extends StoryMapFilters {
  /** Only stories in these releases. Empty or absent means every release. */
  releases?: readonly string[];
  /** Only stories under these activities. Empty or absent means every activity. */
  activities?: readonly string[];
}

/** The stories `findStories` matched, in map order, and the filter it applied. */
export interface FoundStories {
  stories: StoryMapJsonStory[];
  /** As on a filtered view. `total` counts the stories in the chosen releases and activities. */
  filter: StoryMapFilterState & { releases?: string[]; activities?: string[] };
}

/** A story ID that `getStories` could not find, with the closest IDs in the map. */
export interface MissingStory {
  id: string;
  suggestions: string[];
}

function internalView(view: StoryMapView): InternalView {
  if (view.audience !== "internal") throw new TypeError("Only the internal view can be read this way.");
  if (view.filter) throw new TypeError("Pass the view before filterStoryMapView, so every story can be found.");
  return view;
}

/**
 * Lists the stories that match a query, using the board's search and status
 * filters, so `--query` finds what the board's search finds. As on the board,
 * blocked and cut stories are hidden unless a status filter chooses them, and
 * counted in `filter.hidden`. Takes an unfiltered internal view.
 */
export function findStories(view: StoryMapView, query: StoryQuery = {}, options: { now?: Date } = {}): FoundStories {
  const internal = internalView(view);
  const releases = query.releases?.length ? new Set(query.releases) : undefined;
  const activities = query.activities?.length ? new Set(query.activities) : undefined;
  const narrowed: InternalView = {
    ...internal,
    stories: internal.stories.filter(story => (!releases || releases.has(story.release)) && (!activities || activities.has(story.activity))),
  };
  const filtered = filterStoryMapView(narrowed, query, options);
  const testsIndexed = internal.testsIndexed === true;
  return {
    stories: filtered.stories.map(story => toJsonStory(story, testsIndexed)),
    filter: {
      ...filtered.filter!,
      ...(releases ? { releases: [...releases] } : {}),
      ...(activities ? { activities: [...activities] } : {}),
    },
  };
}

/** Looks up stories by ID, in the order asked, without duplicates. IDs that are not in the map come back in `missing`. */
export function getStories(view: StoryMapView, ids: readonly string[]): { stories: StoryMapJsonStory[]; missing: MissingStory[] } {
  const internal = internalView(view);
  const byId = new Map(internal.stories.map(story => [story.id, story]));
  const testsIndexed = internal.testsIndexed === true;
  const stories: StoryMapJsonStory[] = [];
  const missing: MissingStory[] = [];
  for (const id of new Set(ids)) {
    const story = byId.get(id);
    if (story) stories.push(toJsonStory(story, testsIndexed));
    else missing.push({ id, suggestions: closestIds(id, [...byId.keys()]) });
  }
  return { stories, missing };
}

/** Number of single-character edits between two short strings. */
function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** Up to three IDs that differ from `id` by case or by at most two characters, closest first. */
export function closestIds(id: string, ids: readonly string[]): string[] {
  const wanted = id.toUpperCase().slice(0, 64);
  return ids
    .map(candidate => ({ candidate, distance: editDistance(wanted, candidate.toUpperCase().slice(0, 64)) }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}
