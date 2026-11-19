import type { StoryMapDocument, StoryStatus } from "./schema.js";

export interface StoryMapViewer {
  roles: readonly string[];
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

interface StoryMapBaseView {
  title: string;
  summary?: string;
  activities: StoryMapLabel[];
  releases: StoryMapLabel[];
}

export type StoryMapView =
  | (StoryMapBaseView & { audience: "internal"; stories: InternalStoryCard[] })
  | (StoryMapBaseView & { audience: "all-users"; stories: StoryCard[] });

function projectLabel(item: StoryMapLabel): StoryMapLabel {
  return { id: item.id, title: item.title, summary: item.summary };
}

export function getStoryMapForViewer(
  map: StoryMapDocument,
  viewer: StoryMapViewer | null,
): StoryMapView | null {
  if (!viewer) return null;

  if (viewer.roles.includes("engineer") || viewer.roles.includes("super-admin")) {
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
