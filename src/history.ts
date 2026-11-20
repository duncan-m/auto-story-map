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

export interface StoryMapHistory {
  version: 1;
  generatedAt: string;
  /** False when the Git history was shallow, so earlier changes are missing. */
  complete: boolean;
  events: StoryHistoryEvent[];
}

const name = z.string().trim().min(1).max(120);

export const storyMapHistorySchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  complete: z.boolean(),
  events: z.array(z.object({
    storyId: z.string().min(1).max(64),
    type: z.enum(["added", "status"]),
    from: z.enum(storyStatuses).optional(),
    to: z.enum(storyStatuses),
    reason: z.string().max(500).optional(),
    at: z.iso.datetime({ offset: true }),
    by: name.optional(),
    mergedBy: name.optional(),
    commit: z.string().regex(/^[0-9a-f]{7,64}$/),
  })).max(100_000),
});

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
