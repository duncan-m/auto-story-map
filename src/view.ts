import type { StoryHistoryEvent, StoryLastEdit, StoryMapHistory } from "./history.js";
import { defaultStalledAfterWeeks, type ReleaseImpact, type StoryMapDocument } from "./schema.js";
import { customerStatus, isActiveStatus, storyStatuses, type StoryStatus } from "./status.js";

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
  /**
   * Overrides the map’s `settings.stalledAfterWeeks`, such as from the host’s own
   * admin settings. 0 turns the stalled flag off.
   */
  stalledAfterWeeks?: number;
  /** Time to measure how long stories have been in progress from. Defaults to now. */
  now?: Date;
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

/** A release as internal viewers see it, with its notes, expected impact and progress. */
export interface InternalReleaseLabel extends StoryMapLabel {
  /** Plain text. Blank lines separate paragraphs. */
  notes?: string;
  impact?: ReleaseImpact[];
  /** Stories in the release by status, counted before any filter is applied. */
  storyCounts: Record<StoryStatus, number>;
}

export interface StoryCard extends StoryMapLabel {
  activity: string;
  release: string;
  status: StoryStatus;
}

/** A story’s change as shown to internal viewers. */
export type StoryHistoryEntry = Omit<StoryHistoryEvent, "storyId">;

export interface InternalStoryCard extends StoryCard {
  /** Why the story is blocked or cut. */
  statusReason?: string;
  updatedBy?: string;
  notes?: string;
  sources?: string[];
  /** When the story was added or last changed status. Present when the host supplied history. */
  lastChangedAt?: string;
  /** The story’s additions and status changes, newest first. */
  history?: StoryHistoryEntry[];
  /** The latest commit that changed any of the story’s fields, including moves. Present when the history records it. */
  lastEdit?: Omit<StoryLastEdit, "storyId">;
  /** When an in-progress story last became in progress. Present when the history records it. */
  inProgressSince?: string;
  /** True when the story has been in progress for longer than the view’s `stalledAfterWeeks`. */
  stalled?: boolean;
}

/** Present when the host has applied `filterStoryMapView`. The board shows its search toolbar only then. */
export interface StoryMapFilterState {
  query?: string;
  /** The status filter. Absent means the default: active stories only. `stalled` keeps stalled stories. */
  status?: StoryStatus | "all" | "stalled";
  /** Only stories added or changed in this many days. */
  changedWithinDays?: number;
  /** Number of stories in the view before filtering. */
  total: number;
  /** Blocked and cut stories that match the other filters but are hidden by the default status filter. */
  hidden?: { blocked: number; cut: number };
}

interface StoryMapBaseView {
  title: string;
  summary?: string;
  activities: StoryMapLabel[];
  filter?: StoryMapFilterState;
  /** Present on internal views when the host supplied history. */
  history?: { generatedAt: string; complete: boolean };
}

export type StoryMapView =
  | (StoryMapBaseView & {
    audience: "internal";
    releases: InternalReleaseLabel[];
    stories: InternalStoryCard[];
    /** Present when the view has history and the stalled flag is on: the threshold it used. */
    stalledAfterWeeks?: number;
  })
  | (StoryMapBaseView & { audience: "all-users"; releases: StoryMapLabel[]; stories: StoryCard[] });

const weekMs = 7 * 24 * 60 * 60 * 1000;

function stalledThreshold(map: StoryMapDocument, override: number | undefined) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) return override;
  return map.settings?.stalledAfterWeeks ?? defaultStalledAfterWeeks;
}

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
    const lastEdits = new Map((history?.lastEdits ?? []).map(({ storyId, ...edit }) => [storyId, edit]));
    const storyCounts = new Map(map.releases.map(release => [
      release.id,
      Object.fromEntries(storyStatuses.map(status => [status, 0])) as Record<StoryStatus, number>,
    ]));
    for (const story of map.stories) {
      const counts = storyCounts.get(story.release);
      if (counts) counts[story.status]++;
    }
    // Stalled needs to know when the story became in progress, so it only works with history.
    const stalledAfterWeeks = history ? stalledThreshold(map, options.stalledAfterWeeks) : 0;
    const stalledBefore = (options.now ?? new Date()).getTime() - stalledAfterWeeks * weekMs;
    return {
      audience: "internal",
      title: map.title,
      summary: map.summary,
      activities: map.activities.map(projectLabel),
      releases: map.releases.map(release => ({
        ...projectLabel(release),
        notes: release.notes,
        impact: release.impact?.map(item => ({ ...item })),
        storyCounts: storyCounts.get(release.id)!,
      })),
      stories: map.stories.map(story => {
        const entries = byStory.get(story.id);
        // Only trust the newest entry: if it is not the move to in progress, the history is
        // older than the map, and the start date is unknown.
        const inProgressSince = story.status === "in-progress" && entries?.[0].to === "in-progress" ? entries[0].at : undefined;
        const stalled = !!inProgressSince && stalledAfterWeeks > 0 && Date.parse(inProgressSince) < stalledBefore;
        return {
          ...projectLabel(story),
          activity: story.activity,
          release: story.release,
          status: story.status,
          statusReason: story.statusReason,
          updatedBy: story.updatedBy,
          notes: story.notes,
          sources: story.sources,
          ...(entries ? { lastChangedAt: entries[0].at, history: entries } : {}),
          ...(lastEdits.has(story.id) ? { lastEdit: { ...lastEdits.get(story.id)! } } : {}),
          ...(inProgressSince ? { inProgressSince } : {}),
          ...(stalled ? { stalled } : {}),
        };
      }),
      ...(history ? { history: { generatedAt: history.generatedAt, complete: history.complete } } : {}),
      ...(stalledAfterWeeks > 0 ? { stalledAfterWeeks } : {}),
    };
  }

  if (map.visibility !== "all-users" || !map.customer) return null;

  // Blocked and cut stories are never shown to customers, and do not make their activity or release visible.
  const publishedStories = map.stories.flatMap(story =>
    story.customer && isActiveStatus(story.status) ? [{ story, copy: story.customer }] : []
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
      // A merged story is not available to customers yet.
      status: customerStatus(story.status),
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
