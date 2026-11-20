import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  fitHistoryText,
  historyNameMaxLength,
  historyReasonMaxLength,
  historySkippedMaxItems,
  type SkippedStoryMapVersion,
  type StoryHistoryEvent,
  type StoryLastEdit,
  type StoryMapHistory,
} from "./history.js";
import { formatStoryMapIssue, loadHistoricalStoryMap, StoryMapValidationError, type StoryMapDocument } from "./schema.js";

const run = promisify(execFile);

export interface BuildHistoryOptions {
  /** Directory inside the Git repository. Defaults to the current directory. */
  cwd?: string;
  /** Path of the map, relative to `cwd`. Defaults to `product/story-map.yaml`. */
  map?: string;
  /** Branch or commit whose history to read. Defaults to `HEAD`. */
  ref?: string;
  /** Build a partial history from a shallow clone instead of failing. */
  allowShallow?: boolean;
  /** Time to record as `generatedAt`. Defaults to now. */
  now?: Date;
  /**
   * Commit authors that are bots, such as a coding agent’s account. Names ending in
   * `[bot]` are always bots. Changes they author are credited to whoever merged them.
   */
  botNames?: readonly string[];
}

export class StoryMapHistoryError extends Error {}

interface Commit {
  sha: string;
  parents: string[];
  committedAt: string;
  authorName: string;
  committerName: string;
}

async function git(cwd: string, args: string[]) {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new StoryMapHistoryError(stderr || `git ${args[0]} failed.`);
  }
}

const separator = "\u001f";

/** Git names have no length limit, so fit each one to the history format. */
const historyName = (name: string | undefined) => fitHistoryText(name, historyNameMaxLength);

function parseCommits(output: string): Commit[] {
  return output.split("\n").filter(Boolean).map(line => {
    const [sha, parents, committedAt, authorName, committerName] = line.split(separator);
    return { sha, parents: parents ? parents.split(" ") : [], committedAt, authorName, committerName };
  });
}

/** GitHub records its own name as the committer of squash and rebase merges made on the website. */
function mergedBy(commit: Commit) {
  if (commit.parents.length > 1) return commit.authorName;
  return commit.committerName === "GitHub" ? undefined : commit.committerName;
}

/** Compares two values regardless of key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Reads the map’s Git history and records when each story was added, each
 * status change and each story’s last edit, using the first-parent history of
 * `ref` so each change is dated when it reached that branch.
 */
export async function buildStoryMapHistory(options: BuildHistoryOptions = {}): Promise<StoryMapHistory> {
  const cwd = resolve(options.cwd ?? ".");
  const ref = options.ref ?? "HEAD";
  if (ref.startsWith("-")) throw new StoryMapHistoryError(`'${ref}' is not a Git reference.`);
  const mapPath = `./${relative(cwd, resolve(cwd, options.map ?? "product/story-map.yaml")).split(sep).join("/")}`;

  const shallow = (await git(cwd, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
  if (shallow && !options.allowShallow) {
    throw new StoryMapHistoryError(
      "This is a shallow clone, so the map's earlier changes are missing. Fetch the full history " +
      "(for example `git fetch --unshallow`, or `fetch-depth: 0` in actions/checkout), or pass --allow-shallow " +
      "to build a partial history.",
    );
  }

  const format = ["%H", "%P", "%cI", "%an", "%cn"].join("%x1f");
  const commits = parseCommits(await git(cwd, ["log", "--first-parent", "--reverse", `--format=${format}`, ref, "--", mapPath]));

  const bots = new Set((options.botNames ?? []).map(name => name.trim().toLowerCase()).filter(Boolean));
  const isBot = (name: string) => name.toLowerCase().endsWith("[bot]") || bots.has(name.toLowerCase());

  const events: StoryHistoryEvent[] = [];
  const lastEdits = new Map<string, StoryLastEdit>();
  const skipped: SkippedStoryMapVersion[] = [];
  let skippedCount = 0;
  const skip = (commit: string, reason: string) => {
    skippedCount++;
    if (skipped.length < historySkippedMaxItems) {
      skipped.push({ commit, reason: fitHistoryText(reason, historyReasonMaxLength) ?? "Could not read the map." });
    }
  };
  let previous: StoryMapDocument | null = null;
  // In a shallow clone, the oldest version is only a starting point: its stories were added before the history begins.
  let baselineOnly = shallow;

  for (const commit of commits) {
    let source: string;
    try {
      source = await git(cwd, ["show", `${commit.sha}:${mapPath}`]);
    } catch {
      skip(commit.sha, "The map does not exist at this commit.");
      continue;
    }
    let current: StoryMapDocument;
    try {
      // Read leniently: older versions may use an earlier format. A field the
      // format no longer has is dropped, and so is a story that still does not validate.
      const loaded = loadHistoricalStoryMap(source);
      current = loaded.map;
      // A dropped story is unknown in this version, not removed. Keep its last
      // known version so it is not recorded as added again later.
      const kept = new Set(current.stories.map(story => story.id));
      for (const id of loaded.dropped.storyIds) {
        const earlier = previous?.stories.find(story => story.id === id);
        if (earlier && !kept.has(id)) current.stories.push(earlier);
      }
    } catch (error) {
      // The YAML could not be read, or the map's structure does not validate even
      // leniently. Compare the next readable version with the last readable one.
      const issues = error instanceof StoryMapValidationError ? error.issues : [];
      const first = issues[0] ? formatStoryMapIssue(issues[0]) : error instanceof Error ? error.message : String(error);
      const more = issues.length > 1 ? ` (and ${issues.length - 1} more ${issues.length === 2 ? "problem" : "problems"})` : "";
      skip(commit.sha, `The map could not be read: ${first}${more}`);
      continue;
    }
    if (baselineOnly) {
      previous = current;
      baselineOnly = false;
      continue;
    }

    const before = new Map((previous?.stories ?? []).map(story => [story.id, story]));
    const rawMerger = mergedBy(commit);
    const merger = historyName(rawMerger);
    // Git versions differ in how they print UTC (+00:00 or Z), so store one canonical form.
    const at = new Date(commit.committedAt).toISOString();
    let branchAuthor: string | undefined | null = null;
    const author = async () => {
      if (commit.parents.length < 2) return commit.authorName;
      // For a merge, credit the author of the latest commit on the merged branch that edited the map.
      if (branchAuthor === null) {
        const log = await git(cwd, ["log", "-1", "--format=%an", `${commit.parents[0]}..${commit.sha}`, "--no-merges", "--", mapPath]);
        branchAuthor = log.trim() || undefined;
      }
      return branchAuthor ?? commit.authorName;
    };
    const editor = async (story: StoryMapDocument["stories"][number]) => {
      const earlier = before.get(story.id);
      if (story.updatedBy && (!earlier || earlier.updatedBy !== story.updatedBy)) return story.updatedBy;
      const name = await author();
      // A bot did the edit, so credit the person who accepted it, when Git knows who that is.
      return isBot(name) && rawMerger && !isBot(rawMerger) ? rawMerger : name;
    };

    for (const story of current.stories) {
      const earlier = before.get(story.id);
      if (earlier && canonical(earlier) === canonical(story)) continue;
      const by = historyName(await editor(story));
      const reason = story.status === "blocked" || story.status === "cut"
        ? fitHistoryText(story.statusReason, historyReasonMaxLength)
        : undefined;
      lastEdits.set(story.id, { storyId: story.id, at, ...(by ? { by } : {}), commit: commit.sha });
      if (earlier && earlier.status === story.status) continue;
      events.push({
        storyId: story.id,
        type: earlier ? "status" : "added",
        ...(earlier ? { from: earlier.status } : {}),
        to: story.status,
        ...(reason ? { reason } : {}),
        at,
        ...(by ? { by } : {}),
        ...(merger ? { mergedBy: merger } : {}),
        commit: commit.sha,
      });
    }
    previous = current;
  }

  return {
    version: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    complete: !shallow,
    events,
    // Only stories still in the map. A story first seen in a shallow clone's baseline has no known edit.
    lastEdits: (previous?.stories ?? []).flatMap(story => lastEdits.get(story.id) ?? []),
    ...(skippedCount ? { skipped, skippedCount } : {}),
  };
}
