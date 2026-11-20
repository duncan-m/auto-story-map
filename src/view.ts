import type { StoryHistoryEvent, StoryMapHistory } from "./history.js";
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
  /**
   * Status history from `story-map history`. Only internal viewers see it; the
   * customer view never includes dates or names from it.
   */
  history?: StoryMapHistory | null;
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

/** A story’s change as shown to internal viewers. */
export type StoryHistoryEntry = Omit<StoryHistoryEvent, "storyId">;

export interface InternalStoryCard extends StoryCard {
  updatedBy?: string;
  notes?: string;
  sources?: string[];
  /** When the story was added or last changed status. Present when the host supplied history. */
  lastChangedAt?: string;
  /** The story’s additions and status changes, newest first. */
  history?: StoryHistoryEntry[];
}

/** Present when the host has applied `filterStoryMapView`. The board shows its search toolbar only then. */
export interface StoryMapFilterState {
  query?: string;
  status?: StoryStatus;
  /** Only stories added or changed in this many days. */
  changedWithinDays?: number;
  /** Number of stories in the view before filtering. */
  total: number;
}

interface StoryMapBaseView {
  title: string;
  summary?: string;
  activities: StoryMapLabel[];
  releases: StoryMapLabel[];
  filter?: StoryMapFilterState;
  /** Present on internal views when the host supplied history. */
  history?: { generatedAt: string; complete: boolean };
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
    const history = options.history;
    const byStory = new Map<string, StoryHistoryEntry[]>();
    for (const { storyId, ...entry } of history?.events ?? []) {
      byStory.set(storyId, [entry, ...(byStory.get(storyId) ?? [])]);
    }
    for (const entries of byStory.values()) entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return {
      audience: "internal",
      title: map.title,
      summary: map.summary,
      activities: map.activities.map(projectLabel),
      releases: map.releases.map(projectLabel),
      stories: map.stories.map(story => {
        const entries = byStory.get(story.id);
        return {
          ...projectLabel(story),
          activity: story.activity,
          release: story.release,
          status: story.status,
          updatedBy: story.updatedBy,
          notes: story.notes,
          sources: story.sources,
          ...(entries ? { lastChangedAt: entries[0].at, history: entries } : {}),
        };
      }),
      ...(history ? { history: { generatedAt: history.generatedAt, complete: history.complete } } : {}),
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
