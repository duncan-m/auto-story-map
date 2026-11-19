import type { StoryMapDocument } from "./schema.js";
import type { StoryStatus } from "./status.js";

export interface StoryMapViewer {
  roles?: readonly string[];
}

export interface StoryMapAccessOptions<Viewer extends StoryMapViewer = StoryMapViewer> {
  /**
   * Decides who sees the full internal map: IDs, engineering notes, sources and
   * editors. Everyone else gets the customer view when the map allows it.
   * Defaults to viewers with the `engineer` or `super-admin` role.
   */
  canViewInternal?: (viewer: Viewer) => boolean;
}

export const defaultInternalRoles: readonly string[] = ["engineer", "super-admin"];

function hasDefaultInternalRole(viewer: StoryMapViewer) {
  return defaultInternalRoles.some(role => viewer.roles?.includes(role));
}

export interface StoryMapLabel {
  id: string;
  title: string;
  summary?: string;
}

export interface StoryCard extends StoryMapLabel {
  activity: string;
  release: string;
  status: StoryStatus;
}

export interface InternalStoryCard extends StoryCard {
  updatedBy?: string;
  notes?: string;
  sources?: string[];
}

/** Present when the host has applied `filterStoryMapView`. The board shows its search toolbar only then. */
export interface StoryMapFilterState {
  query?: string;
  status?: StoryStatus;
  /** Number of stories in the view before filtering. */
  total: number;
}

interface StoryMapBaseView {
  title: string;
  summary?: string;
  activities: StoryMapLabel[];
  releases: StoryMapLabel[];
  filter?: StoryMapFilterState;
}

export type StoryMapView =
  | (StoryMapBaseView & { audience: "internal"; stories: InternalStoryCard[] })
  | (StoryMapBaseView & { audience: "all-users"; stories: StoryCard[] });

function projectLabel(item: StoryMapLabel): StoryMapLabel {
  return { id: item.id, title: item.title, summary: item.summary };
}

export function getStoryMapForViewer<Viewer extends StoryMapViewer>(
  map: StoryMapDocument,
  viewer: Viewer | null,
  options: StoryMapAccessOptions<Viewer> = {},
): StoryMapView | null {
  if (!viewer) return null;

  const canViewInternal = options.canViewInternal ?? hasDefaultInternalRole;
  if (canViewInternal(viewer) === true) {
    return {
      audience: "internal",
      title: map.title,
      summary: map.summary,
      activities: map.activities.map(projectLabel),
      releases: map.releases.map(projectLabel),
      stories: map.stories.map(story => ({
        ...projectLabel(story),
        activity: story.activity,
        release: story.release,
        status: story.status,
        updatedBy: story.updatedBy,
        notes: story.notes,
        sources: story.sources,
      })),
    };
  }

  if (map.visibility !== "all-users" || !map.customer) return null;

  const publishedStories = map.stories.flatMap(story =>
    story.customer ? [{ story, copy: story.customer }] : []
  );
  const activityIds = new Set(publishedStories.map(({ story }) => story.activity));
  const releaseIds = new Set(publishedStories.map(({ story }) => story.release));

  function projectGroups(
    groups: StoryMapDocument["activities"],
    visible: Set<string>,
    prefix: string,
  ) {
    const ids = new Map<string, string>();
    const entries: StoryMapLabel[] = [];
    for (const { id, customer } of groups) {
      if (!visible.has(id) || !customer) continue;
      const publicId = `${prefix}-${entries.length + 1}`;
      ids.set(id, publicId);
      entries.push({ id: publicId, title: customer.title, summary: customer.summary });
    }
    return { entries, ids };
  }

  const activities = projectGroups(map.activities, activityIds, "activity");
  const releases = projectGroups(map.releases, releaseIds, "release");
  const stories: StoryCard[] = [];
  for (const { story, copy } of publishedStories) {
    const activity = activities.ids.get(story.activity);
    const release = releases.ids.get(story.release);
    if (!activity || !release) continue;
    stories.push({
      id: `story-${stories.length + 1}`,
      title: copy.title,
      summary: copy.summary,
      activity,
      release,
      status: story.status,
    });
  }

  return {
    audience: "all-users",
    title: map.customer.title,
    summary: map.customer.summary,
    activities: activities.entries,
    releases: releases.entries,
    stories,
  };
}
