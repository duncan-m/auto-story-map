import type { StoryStatus } from "./status.js";
import type { InternalStoryCard, StoryHistoryEntry } from "./view.js";

/** The periods the Analytics tab groups completed stories by, in UTC. */
export const analyticsPeriods = ["day", "week", "month"] as const;
export type AnalyticsPeriod = (typeof analyticsPeriods)[number];

/**
 * When a story counts as completed: `merged` counts stories that reached `merged` or
 * `shipped`, since shipping comes after merging, and `shipped` counts `shipped` only.
 */
export const analyticsMilestones = ["merged", "shipped"] as const;
export type AnalyticsMilestone = (typeof analyticsMilestones)[number];

/** The measures the Analytics tab can chart. */
export const analyticsMeasures = ["stories", "points", "tokens", "spend"] as const;
export type AnalyticsMeasure = (typeof analyticsMeasures)[number];

/** How many periods the Analytics tab shows, ending with the one that holds `now`. */
export const analyticsWindow: Readonly<Record<AnalyticsPeriod, number>> = Object.freeze({ day: 8, week: 8, month: 6 });

/** Stories completed in a period or window, and what they add up to. */
export interface AnalyticsTotals {
  /** Stories completed. */
  stories: number;
  /** IDs of those stories, in map order. */
  storyIds: string[];
  /** The sum of their `estimate`, today's values. Stories without one add nothing. */
  points: number;
  /** How many of them have an `estimate`. */
  estimated: number;
  /** The sum of their `tokens`, today's values. Stories without them add nothing. */
  tokens: number;
  /** How many of them have `tokens` recorded. */
  tokensRecorded: number;
  /** The sum of their `estimatedCostUsd`, today's values. */
  spendUsd: number;
  /** How many of them have `estimatedCostUsd` recorded. */
  spendRecorded: number;
}

/** One period of the Analytics tab. */
export interface AnalyticsBucket extends AnalyticsTotals {
  /** Start of the period, inclusive, in UTC, such as `2026-11-23T00:00:00.000Z`. */
  start: string;
  /** Start of the next period, exclusive. */
  end: string;
}

export interface StoryMapAnalytics {
  period: AnalyticsPeriod;
  milestone: AnalyticsMilestone;
  /** The periods in the window, oldest first, including those with nothing completed. */
  buckets: AnalyticsBucket[];
  /** Everything completed in the window. */
  totals: AnalyticsTotals;
  /**
   * When the history starts: the time of its first readable version of the map. Stories that
   * were already complete then were completed at an unknown time, so they are never counted.
   * Absent when the history has no events.
   */
  knownFrom?: string;
  /** False when the history was made from a shallow clone, so its earliest changes are missing. */
  complete: boolean;
  /** When the history file was made. Later completions are not in it. */
  generatedAt: string;
  /**
   * Stories in the milestone now whose completion the history does not date, because they were
   * complete when the history starts or became complete after the file was made.
   */
  undated: number;
}

export interface StoryMapAnalyticsOptions {
  period?: AnalyticsPeriod;
  milestone?: AnalyticsMilestone;
  /** The window ends with the period that holds this time. Defaults to now. */
  now?: Date;
}

const dayMs = 24 * 60 * 60 * 1000;

/** The start of the UTC day, Monday-based week or month that holds `time`. */
function periodStart(time: number, period: AnalyticsPeriod) {
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (period === "month") return Date.UTC(year, month, 1);
  const day = Date.UTC(year, month, date.getUTCDate());
  if (period === "day") return day;
  // getUTCDay is 0 on Sunday, and weeks start on Monday, as ISO weeks do.
  return day - ((date.getUTCDay() + 6) % 7) * dayMs;
}

/** The start of the period `count` periods after the one starting at `start`. */
function shiftPeriod(start: number, period: AnalyticsPeriod, count: number) {
  if (period === "day") return start + count * dayMs;
  if (period === "week") return start + count * 7 * dayMs;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1);
}

function emptyTotals(): AnalyticsTotals {
  return { stories: 0, storyIds: [], points: 0, estimated: 0, tokens: 0, tokensRecorded: 0, spendUsd: 0, spendRecorded: 0 };
}

function addStory(totals: AnalyticsTotals, story: InternalStoryCard) {
  totals.stories++;
  totals.storyIds.push(story.id);
  if (story.estimate !== undefined) {
    totals.points += story.estimate;
    totals.estimated++;
  }
  if (story.tokens !== undefined) {
    totals.tokens += story.tokens;
    totals.tokensRecorded++;
  }
  if (story.estimatedCostUsd !== undefined) {
    totals.spendUsd += story.estimatedCostUsd;
    totals.spendRecorded++;
  }
}

/** The statuses that count as complete for a milestone. */
export function analyticsCompleteStatuses(milestone: AnalyticsMilestone): readonly StoryStatus[] {
  return milestone === "merged" ? ["merged", "shipped"] : ["shipped"];
}

/**
 * When a story last became complete, from its history, newest first: the newest entry that moved
 * it into the milestone from outside it, or added it already complete. A story reopened and
 * completed again counts from its latest completion. Undefined when the story is not complete now,
 * or its history does not record the change.
 */
export function storyCompletedAt(story: Pick<InternalStoryCard, "status" | "history">, milestone: AnalyticsMilestone): StoryHistoryEntry | undefined {
  const complete = analyticsCompleteStatuses(milestone);
  if (!complete.includes(story.status)) return undefined;
  return story.history?.find(entry => complete.includes(entry.to) && !(entry.from && complete.includes(entry.from)));
}

/** The first readable version of the map: every story in it was added then, whatever its status. */
function earliestVersion(stories: readonly InternalStoryCard[]) {
  let earliest: { time: number; commit: string } | undefined;
  for (const story of stories) {
    for (const entry of story.history ?? []) {
      const time = Date.parse(entry.at);
      if (!earliest || time < earliest.time) earliest = { time, commit: entry.commit };
    }
  }
  return earliest;
}

/**
 * Counts the stories, points, tokens and spend completed in each UTC day, week or month, for the
 * Analytics tab: the last 8 days, 8 weeks or 6 months, ending with the period that holds `now`,
 * with empty periods kept. Points, tokens and spend are each story's values in the map today.
 *
 * Pass the internal view's stories before filtering, from `getStoryMapForViewer` with `history`,
 * and its `history`. The calculation is deterministic: the same map, history and `now` give the
 * same result.
 */
export function storyMapAnalytics(
  view: { stories: readonly InternalStoryCard[]; history: { generatedAt: string; complete: boolean } },
  options: StoryMapAnalyticsOptions = {},
): StoryMapAnalytics {
  const period = options.period ?? "day";
  const milestone = options.milestone ?? "merged";
  const now = (options.now ?? new Date()).getTime();
  const count = analyticsWindow[period];
  const last = periodStart(now, period);
  const first = shiftPeriod(last, period, 1 - count);
  const buckets = Array.from({ length: count }, (_, index) => {
    const start = shiftPeriod(first, period, index);
    return { start, end: shiftPeriod(start, period, 1), totals: emptyTotals() };
  });
  const totals = emptyTotals();
  const earliest = earliestVersion(view.stories);

  let undated = 0;
  for (const story of view.stories) {
    if (!analyticsCompleteStatuses(milestone).includes(story.status)) continue;
    const completed = storyCompletedAt(story, milestone);
    // Complete before the history starts, so when is unknown.
    if (!completed || (completed.type === "added" && completed.commit === earliest?.commit)) {
      undated++;
      continue;
    }
    const time = Date.parse(completed.at);
    const bucket = buckets.find(item => time >= item.start && time < item.end);
    if (!bucket) continue;
    addStory(bucket.totals, story);
    addStory(totals, story);
  }

  return {
    period,
    milestone,
    buckets: buckets.map(({ start, end, totals: bucket }) => ({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      ...bucket,
    })),
    totals,
    ...(earliest ? { knownFrom: new Date(earliest.time).toISOString() } : {}),
    complete: view.history.complete,
    generatedAt: view.history.generatedAt,
    undated,
  };
}
