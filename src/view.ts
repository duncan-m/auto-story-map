import { filterStoryMapView, readStoryMapFilters } from "./filter.js";
import { personaColourCount, personaInitials, storyPersonaResolver } from "./personas.js";
import type { StoryHistoryEvent, StoryLastEdit, StoryMapHistory } from "./history.js";
import { defaultStalledAfterWeeks, type EstimatePoints, type ReleaseImpact, type StoryMapDocument, type StoryMapJob, type StoryMapPersonaContext } from "./schema.js";
import type { StoryMapTests, StoryTestEntry } from "./tests-index.js";
import { customerStatus, isActiveStatus, storyStatuses, type StoryStatus, type StoryStatusFilter } from "./status.js";

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
   * The tests index from `story-map tests`, parsed with `parseStoryMapTests`.
   * Only internal viewers see it; the customer view never includes test names
   * or file paths.
   */
  tests?: StoryMapTests | null;
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
  /** Effort totals for the release. Absent when no story in the release has an estimate. */
  estimates?: ReleaseEstimates;
}

/**
 * A release’s story points, counted before any filter is applied, like `storyCounts`.
 * Cut stories are left out of all three numbers.
 */
export interface ReleaseEstimates {
  /** Points across every story in the release that is not cut. */
  total: number;
  /** Points on stories that are not shipped yet. Merged stories still count. */
  left: number;
  /** Stories in the total with no estimate. */
  unestimated: number;
}

export interface StoryCard extends StoryMapLabel {
  activity: string;
  release: string;
  status: StoryStatus;
  /**
   * IDs of the personas the story is for, primary first: the owners of its jobs, then the personas it lists.
   * Absent when it names none. Customer views list only the view's own personas, by their public IDs.
   */
  personas?: string[];
}

/** A job to be done as internal viewers see it, with how many stories serve it. */
export interface PersonaJobLabel extends StoryMapJob {
  /** True on the persona's core job, the first in their list. Absent on the others. */
  core?: true;
  /** Stories that serve the job, by status, counted before any filter is applied, like a release's `storyCounts`. */
  storyCounts: Record<StoryStatus, number>;
}

/** A persona as internal viewers see it, with what the board needs to draw its avatar. */
export interface PersonaLabel extends StoryMapLabel {
  /** Up to two letters for the avatar, from the title. */
  initials: string;
  /** 0 to 5, from the persona's place in the map. Pairs with `initials`, so colour is never the only cue. */
  colour: number;
  /** What success means to them, what they use today and their constraints. Absent when the map gives none. Internal only. */
  context?: StoryMapPersonaContext;
  /** The persona's jobs to be done, in map order, core job first, each with its stories by status. */
  jobs: PersonaJobLabel[];
  /** Active stories for the persona, counted before any filter is applied, like a release's `storyCounts`. */
  activeStories: number;
}

/** A story’s change as shown to internal viewers. */
export type StoryHistoryEntry = Omit<StoryHistoryEvent, "storyId">;

export interface InternalStoryCard extends StoryCard {
  /** Why the story is blocked or cut. */
  statusReason?: string;
  /** Effort estimate in story points. */
  estimate?: EstimatePoints;
  /** IDs of the jobs to be done the story serves, most important first. Absent when it names none. */
  jobs?: string[];
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
  /** Tests and groups tagged with the story’s ID, by file, then line. Present when the host supplied a tests index and at least one is tagged. */
  tests?: StoryTestLink[];
  /** Tagged tests the index left out because of its limits, counted per file. */
  moreTests?: { file: string; count: number }[];
}

/** A test or group tagged with a story, as internal viewers see it. */
export type StoryTestLink = Omit<StoryTestEntry, "storyIds">;

/** Present when the host has applied `filterStoryMapView`. The board shows its search toolbar only then. */
export interface StoryMapFilterState {
  query?: string;
  /**
   * The chosen statuses, in board order. Absent means the default: active stories
   * for internal views, and every status for customers. `stalled` keeps stalled stories.
   */
  status?: StoryStatusFilter[];
  /** Only stories added or changed in this many days. */
  changedWithinDays?: number;
  /** IDs of the chosen personas, in map order. A story is kept when it is for any of them. Customers choose from their view's personas. */
  persona?: string[];
  /** IDs of the chosen jobs, in map order. A story is kept when it serves any of them. Internal views only. */
  job?: string[];
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

/** How far back from the latest update `recentUpdates` looks for the releases that changed. */
export const recentUpdateDays = 14;

/** When the map last changed, and which releases most changes were in. Internal views with history only. */
export interface StoryMapRecentUpdates {
  /** The latest edit to any story. */
  at: string;
  /** Who to credit for that edit, when the history records it. */
  by?: string;
  /** The window, ending at `at`, that `releases` covers. */
  days: number;
  /** Releases with stories changed in the window, most changed first. */
  releases: { id: string; title: string; stories: number }[];
}

export type StoryMapView =
  | (StoryMapBaseView & {
    audience: "internal";
    releases: InternalReleaseLabel[];
    stories: InternalStoryCard[];
    /** The map's personas, in map order. Absent when the map has none. */
    personas?: PersonaLabel[];
    /** Present when the view has history and the stalled flag is on: the threshold it used. */
    stalledAfterWeeks?: number;
    /** Present when the history records at least one story change. */
    recentUpdates?: StoryMapRecentUpdates;
    /** True when the host supplied a tests index, so a story without `tests` has none tagged. */
    testsIndexed?: true;
    /** When the tests index was generated. Present with `testsIndexed`. */
    testsGeneratedAt?: string;
  })
  | (StoryMapBaseView & {
    audience: "all-users";
    releases: StoryMapLabel[];
    stories: StoryCard[];
    /**
     * Personas with approved customer copy that a story in the view is for, in map order, with
     * public IDs such as `persona-1`. Absent when there are none. Customers never see jobs.
     */
    personas?: StoryMapLabel[];
  });

const weekMs = 7 * 24 * 60 * 60 * 1000;

function stalledThreshold(map: StoryMapDocument, override: number | undefined) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) return override;
  return map.settings?.stalledAfterWeeks ?? defaultStalledAfterWeeks;
}

function projectLabel(item: StoryMapLabel): StoryMapLabel {
  return { id: item.id, title: item.title, summary: item.summary };
}

/** Leaves the totals out when nothing in the release is estimated, so “no estimates” differs from “0 points”. */
function releaseEstimates(totals: (ReleaseEstimates & { estimated: number }) | undefined): { estimates?: ReleaseEstimates } {
  if (!totals?.estimated) return {};
  return { estimates: { total: totals.total, left: totals.left, unestimated: totals.unestimated } };
}

/** Leaves both out for a story that names no one, so a map without personas projects as before. */
function personaFields(personas: string[], jobs: string[] | undefined): Pick<InternalStoryCard, "personas" | "jobs"> {
  return {
    ...(personas.length ? { personas } : {}),
    ...(jobs?.length ? { jobs: [...jobs] } : {}),
  };
}

function summariseRecentUpdates(
  map: StoryMapDocument,
  byStory: Map<string, StoryHistoryEntry[]>,
  lastEdits: Map<string, Omit<StoryLastEdit, "storyId">>,
): StoryMapRecentUpdates | undefined {
  // A story's last edit covers every field, so prefer it; older history files only have status events.
  const latest = map.stories.flatMap(story => {
    const edit = lastEdits.get(story.id) ?? byStory.get(story.id)?.[0];
    return edit ? [{ release: story.release, at: edit.at, time: Date.parse(edit.at), by: edit.by }] : [];
  });
  if (latest.length === 0) return undefined;
  const newest = latest.reduce((a, b) => (b.time > a.time ? b : a));
  const since = newest.time - recentUpdateDays * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const { release, time } of latest) {
    if (time >= since) counts.set(release, (counts.get(release) ?? 0) + 1);
  }
  const releases = map.releases
    .filter(release => counts.has(release.id))
    .map(release => ({ id: release.id, title: release.title, stories: counts.get(release.id)! }))
    .sort((a, b) => b.stories - a.stories);
  return { at: newest.at, ...(newest.by ? { by: newest.by } : {}), days: recentUpdateDays, releases };
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
      const entries = byStory.get(storyId);
      if (entries) entries.push(entry);
      else byStory.set(storyId, [entry]);
    }
    // Reverse before the stable sort so entries with equal timestamps stay latest-supplied first.
    for (const entries of byStory.values()) {
      entries.reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    }
    const testsByStory = new Map<string, StoryTestLink[]>();
    for (const { storyIds, ...test } of options.tests?.tests ?? []) {
      for (const id of new Set(storyIds)) {
        const entries = testsByStory.get(id);
        if (entries) entries.push({ ...test });
        else testsByStory.set(id, [{ ...test }]);
      }
    }
    const moreTestsByStory = new Map<string, { file: string; count: number }[]>();
    for (const { storyId, file, count } of options.tests?.omitted ?? []) {
      const entries = moreTestsByStory.get(storyId);
      if (entries) entries.push({ file, count });
      else moreTestsByStory.set(storyId, [{ file, count }]);
    }
    const lastEdits = new Map((history?.lastEdits ?? []).map(({ storyId, ...edit }) => [storyId, edit]));
    const storyCounts = new Map(map.releases.map(release => [
      release.id,
      Object.fromEntries(storyStatuses.map(status => [status, 0])) as Record<StoryStatus, number>,
    ]));
    const estimates = new Map<string, ReleaseEstimates & { estimated: number }>();
    for (const story of map.stories) {
      const counts = storyCounts.get(story.release);
      if (!counts) continue;
      counts[story.status]++;
      // Cut stories have left the release, so they add nothing, as in release progress.
      if (story.status === "cut") continue;
      let totals = estimates.get(story.release);
      if (!totals) estimates.set(story.release, totals = { total: 0, left: 0, unestimated: 0, estimated: 0 });
      if (story.estimate === undefined) {
        totals.unestimated++;
        continue;
      }
      totals.estimated++;
      totals.total += story.estimate;
      if (story.status !== "shipped") totals.left += story.estimate;
    }
    // Stalled needs to know when the story became in progress, so it only works with history.
    const stalledAfterWeeks = history ? stalledThreshold(map, options.stalledAfterWeeks) : 0;
    const stalledBefore = (options.now ?? new Date()).getTime() - stalledAfterWeeks * weekMs;
    const recentUpdates = summariseRecentUpdates(map, byStory, lastEdits);
    const resolvePersonas = storyPersonaResolver(map);
    const personaCounts = new Map<string, number>();
    const jobCounts = new Map<string, Record<StoryStatus, number>>();
    for (const story of map.stories) {
      for (const id of new Set(story.jobs ?? [])) {
        let counts = jobCounts.get(id);
        if (!counts) jobCounts.set(id, counts = Object.fromEntries(storyStatuses.map(status => [status, 0])) as Record<StoryStatus, number>);
        counts[story.status]++;
      }
      if (!isActiveStatus(story.status)) continue;
      for (const id of resolvePersonas(story)) personaCounts.set(id, (personaCounts.get(id) ?? 0) + 1);
    }
    const personas: PersonaLabel[] = (map.personas ?? []).map((persona, index) => ({
      ...projectLabel(persona),
      initials: personaInitials(persona.title),
      colour: index % personaColourCount,
      ...(persona.context ? { context: structuredClone(persona.context) } : {}),
      jobs: (persona.jobs ?? []).map((job, jobIndex) => ({
        ...job,
        ...(jobIndex === 0 ? { core: true as const } : {}),
        storyCounts: jobCounts.get(job.id) ?? Object.fromEntries(storyStatuses.map(status => [status, 0])) as Record<StoryStatus, number>,
      })),
      activeStories: personaCounts.get(persona.id) ?? 0,
    }));
    return {
      audience: "internal",
      title: map.title,
      summary: map.summary,
      activities: map.activities.map(projectLabel),
      ...(personas.length ? { personas } : {}),
      releases: map.releases.map(release => ({
        ...projectLabel(release),
        notes: release.notes,
        impact: release.impact?.map(item => ({ ...item })),
        storyCounts: storyCounts.get(release.id)!,
        ...releaseEstimates(estimates.get(release.id)),
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
          ...(story.estimate !== undefined ? { estimate: story.estimate } : {}),
          ...personaFields(resolvePersonas(story), story.jobs),
          updatedBy: story.updatedBy,
          notes: story.notes,
          sources: story.sources,
          ...(entries ? { lastChangedAt: entries[0].at, history: entries } : {}),
          ...(lastEdits.has(story.id) ? { lastEdit: { ...lastEdits.get(story.id)! } } : {}),
          ...(inProgressSince ? { inProgressSince } : {}),
          ...(stalled ? { stalled } : {}),
          ...(testsByStory.has(story.id) ? { tests: testsByStory.get(story.id)! } : {}),
          ...(moreTestsByStory.has(story.id) ? { moreTests: moreTestsByStory.get(story.id)! } : {}),
        };
      }),
      ...(history ? { history: { generatedAt: history.generatedAt, complete: history.complete } } : {}),
      ...(stalledAfterWeeks > 0 ? { stalledAfterWeeks } : {}),
      ...(recentUpdates ? { recentUpdates } : {}),
      ...(options.tests ? { testsIndexed: true as const, testsGeneratedAt: options.tests.generatedAt } : {}),
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
    groups: readonly { id: string; customer?: { title: string; summary?: string } }[],
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
  const resolvePersonas = storyPersonaResolver(map);
  const shown = publishedStories.flatMap(({ story, copy }) => {
    const activity = activities.ids.get(story.activity);
    const release = releases.ids.get(story.release);
    return activity && release ? [{ story, copy, activity, release, personaIds: resolvePersonas(story) }] : [];
  });
  // Only personas with approved copy that a shown story is for, renumbered so internal IDs never leak.
  const personas = projectGroups(map.personas ?? [], new Set(shown.flatMap(({ personaIds }) => personaIds)), "persona");
  const stories: StoryCard[] = shown.map(({ story, copy, activity, release, personaIds }, index) => {
    const storyPersonas = personaIds.flatMap(id => personas.ids.get(id) ?? []);
    return {
      id: `story-${index + 1}`,
      title: copy.title,
      summary: copy.summary,
      activity,
      release,
      // A merged story is not available to customers yet.
      status: customerStatus(story.status),
      ...(storyPersonas.length ? { personas: storyPersonas } : {}),
    };
  });

  return {
    audience: "all-users",
    title: map.customer.title,
    summary: map.customer.summary,
    activities: activities.entries,
    releases: releases.entries,
    ...(personas.entries.length ? { personas: personas.entries } : {}),
    stories,
  };
}

export interface StoryMapPageOptions<Viewer extends StoryMapViewer = StoryMapViewer> extends StoryMapAccessOptions<Viewer> {
  /**
   * The request's query parameters, such as `url.searchParams`. The `q`,
   * `status`, `changed`, `persona` and `job` filters are read from them, and anything else is ignored.
   */
  searchParams?: URLSearchParams;
}

/**
 * Builds what a viewer sees on the story map page or JSON endpoint in one
 * call: projects the map for the viewer, then reads the filters from
 * `searchParams` and applies them. Filtering always runs on the projection, so
 * a search only ever sees what the viewer may see. Returns `null` when the
 * viewer has no access: answer 401 for a guest and 403 otherwise.
 *
 * The same as `filterStoryMapView(getStoryMapForViewer(...), readStoryMapFilters(searchParams), { now })`,
 * which remain available for hosts that need the steps separately.
 */
export function getStoryMapPage<Viewer extends StoryMapViewer>(
  map: StoryMapDocument,
  viewer: Viewer | null,
  options: StoryMapPageOptions<Viewer> = {},
): StoryMapView | null {
  const { searchParams, ...access } = options;
  const view = getStoryMapForViewer(map, viewer, access);
  return view && filterStoryMapView(view, readStoryMapFilters(searchParams ?? new URLSearchParams()), { now: access.now });
}

/**
 * Headers for every story map response, page or JSON. The content differs per
 * viewer, so it must never be cached or shared, and browsers must not guess its type.
 */
export const storyMapResponseHeaders: Readonly<Record<"Cache-Control" | "X-Content-Type-Options", string>> = Object.freeze({
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
});
