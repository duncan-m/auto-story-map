import { z } from "zod";
import { storyStatuses, type StoryStatus } from "./status.js";

/** One change to a story, as recorded by `story-map history`. */
export interface StoryHistoryEvent {
  storyId: string;
  /** `added`: the story first appeared in the map. `status`: its status changed. */
  type: "added" | "status";
  from?: StoryStatus;
  to: StoryStatus;
  /** The story’s `statusReason` when it became blocked or cut. */
  reason?: string;
  /** UTC time the change reached the history’s branch, usually `main`, such as `2026-11-12T15:30:00.000Z`. */
  at: string;
  /** Who made the edit: the story’s `updatedBy` when that edit set it, otherwise the Git commit author. */
  by?: string;
  /** Who merged the change, when Git records it. GitHub squash and rebase merges do not. */
  mergedBy?: string;
  /** Commit that brought the change onto the branch. */
  commit: string;
}

/** The latest commit that changed any of a story’s fields, including moving it. */
export interface StoryLastEdit {
  storyId: string;
  /** UTC time the edit reached the history’s branch. */
  at: string;
  /** Who to credit: the story’s `updatedBy` when that edit set it, otherwise the commit author, or the merger when the author is a bot. */
  by?: string;
  commit: string;
}

/** A version of the map that history could not read, so its changes are missing. */
export interface SkippedStoryMapVersion {
  commit: string;
  /** Why it could not be read, such as the map being missing or not valid YAML. */
  reason: string;
}

/** Most skipped versions a history file lists. `skippedCount` counts them all. */
export const historySkippedMaxItems = 100;

export interface StoryMapHistory {
  version: 1;
  generatedAt: string;
  /** False when the Git history was shallow, so earlier changes are missing. */
  complete: boolean;
  events: StoryHistoryEvent[];
  /** Each current story’s last edit. Absent in files written before 0.4.0. */
  lastEdits?: StoryLastEdit[];
  /** The first versions of the map that could not be read, oldest first. Absent when none were skipped, and in files written before 0.6.0. */
  skipped?: SkippedStoryMapVersion[];
  /** How many versions were skipped in all, which can be more than `skipped` lists. */
  skippedCount?: number;
}

/** The longest `by` or `mergedBy` name a history file can hold, in Unicode code points. */
export const historyNameMaxLength = 120;
/** The longest blocked or cut `reason` a history file can hold, in Unicode code points. */
export const historyReasonMaxLength = 500;

const codePoints = (text: string) => Array.from(text).length;

/**
 * Fits text to the history format: trimmed, and cut to `max` code points
 * ending in “…” when it is longer, so emoji and other surrogate pairs are
 * never split. Returns `undefined` for empty text. The writer passes every
 * name and reason through this, so `parseStoryMapHistory` accepts its output.
 */
export function fitHistoryText(text: string | undefined, max: number): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const characters = Array.from(trimmed);
  if (characters.length <= max) return trimmed;
  return `${characters.slice(0, max - 1).join("").trimEnd()}…`;
}

const withinCodePoints = (max: number) => (text: string) => codePoints(text) <= max;
const name = z.string().trim().min(1)
  .refine(withinCodePoints(historyNameMaxLength), `Use at most ${historyNameMaxLength} characters.`);
const reason = z.string()
  .refine(withinCodePoints(historyReasonMaxLength), `Use at most ${historyReasonMaxLength} characters.`);
const at = z.iso.datetime({ offset: true });
const commit = z.string().regex(/^[0-9a-f]{7,64}$/);

export const storyMapHistorySchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  complete: z.boolean(),
  events: z.array(z.object({
    storyId: z.string().min(1).max(64),
    type: z.enum(["added", "status"]),
    from: z.enum(storyStatuses).optional(),
    to: z.enum(storyStatuses),
    reason: reason.optional(),
    at,
    by: name.optional(),
    mergedBy: name.optional(),
    commit,
  })).max(100_000),
  lastEdits: z.array(z.object({
    storyId: z.string().min(1).max(64),
    at,
    by: name.optional(),
    commit,
  })).max(100_000).optional(),
  skipped: z.array(z.object({
    commit,
    reason: reason.min(1),
  })).max(historySkippedMaxItems).optional(),
  skippedCount: z.number().int().min(0).optional(),
});

// The interfaces above document the format and the schema checks it. Fail the
// build if they ever describe different shapes.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
true satisfies Same<z.infer<typeof storyMapHistorySchema>, StoryMapHistory>;

/** Parses the JSON written by `story-map history`. Throws if it is not a valid history file. */
export function parseStoryMapHistory(json: string | unknown): StoryMapHistory {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const result = storyMapHistorySchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid story map history: ${result.error.issues.map(issue =>
      `${issue.path.join(".") || "file"}: ${issue.message}`).slice(0, 5).join("; ")}`);
  }
  return result.data;
}
