import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  fitHistoryText,
  historyChangesMaxItems,
  historyChangesPerStory,
  historyChangeTextMaxLength,
  historyNameMaxLength,
  historyReasonMaxLength,
  historySkippedMaxItems,
  type SkippedStoryMapVersion,
  type StoryChange,
  type StoryHistoryEvent,
  type StoryLastEdit,
  type StoryMapHistory,
} from "./history.js";
import { storyIdPattern } from "./references.js";
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
  subject: string;
  body: string;
  pullRequest?: number;
}

async function git(cwd: string, args: string[], maxBuffer = 64 * 1024 * 1024) {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer });
    return stdout;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new StoryMapHistoryError(stderr || `git ${args[0]} failed.`);
  }
}

const separator = "\u001f";

/** Git names have no length limit, so fit each one to the history format. */
const historyName = (name: string | undefined) => fitHistoryText(name, historyNameMaxLength);

const asPullRequest = (digits: string | undefined) => {
  const number = Number(digits);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

/**
 * The pull request or merge request a commit on the main branch came from,
 * read from its message: a GitHub merge commit (`Merge pull request #70 from
 * owner/branch`), a squash or rebase commit whose subject ends in `(#67)`, or a
 * GitLab merge commit whose body has `See merge request group/project!12`.
 * Returns undefined for any other commit.
 */
export function pullRequestNumber(subject: string, body = ""): number | undefined {
  const line = subject.trim();
  const merge = /^Merge pull request #(\d+) from \S/.exec(line);
  if (merge) return asPullRequest(merge[1]);
  const squash = /\(#(\d+)\)$/.exec(line);
  if (squash) return asPullRequest(squash[1]);
  const gitlab = /^See merge request [^\s!]+!(\d+)\s*$/m.exec(body);
  return gitlab ? asPullRequest(gitlab[1]) : undefined;
}

function parseCommits(output: string): Commit[] {
  return output.split("\0").map(record => record.replace(/^\n/, "")).filter(Boolean).map(record => {
    const [sha, parents, committedAt, authorName, committerName, subject = "", ...body] = record.split(separator);
    const message = body.join(separator);
    const pullRequest = pullRequestNumber(subject, message);
    return { sha, parents: parents ? parents.split(" ") : [], committedAt, authorName, committerName, subject, body: message, ...(pullRequest ? { pullRequest } : {}) };
  });
}

/** GitHub records its own name as the committer of squash and rebase merges made on the website. */
function mergedBy(commit: Commit) {
  if (commit.parents.length > 1) return commit.authorName;
  return commit.committerName === "GitHub" ? undefined : commit.committerName;
}

const githubMerge = /^Merge pull request #\d+ from (\S+)/;
const branchMerge = /^Merge branch '([^']+)'/;

/** The merged branch, from a GitHub (`from owner/branch`) or Git (`Merge branch 'name'`) merge subject. */
function mergedBranch(subject: string) {
  const github = githubMerge.exec(subject);
  if (github) return github[1].replace(/^[^/]+\//, "");
  return branchMerge.exec(subject)?.[1];
}

/**
 * A change's title: for a merge, the first line of its body, which GitHub and
 * GitLab set to the pull request title. For a squash or rebase commit, its
 * subject without the `(#n)` suffix. Otherwise its subject.
 */
function changeTitle(commit: Commit) {
  if (commit.parents.length > 1 || githubMerge.test(commit.subject)) {
    const first = commit.body.split("\n").map(line => line.trim()).find(Boolean);
    if (first && !/^See merge request /.test(first)) return first;
  }
  return commit.subject.replace(/\s*\(#\d+\)\s*$/, "");
}

/**
 * Reads every commit on `ref` once and records each first-parent commit whose
 * subject, body, merged branch name, or merged branch commits name a story in
 * `map`. A merge's branch commits are those reachable from its second parent
 * and not from its first, found in memory by walking the first-parent chain
 * oldest first, so the whole history stays one Git call.
 */
async function findStoryChanges(cwd: string, ref: string, map: StoryMapDocument, credit: (author: string, merger: string | undefined) => string) {
  const pattern = storyIdPattern({ map });
  if (!pattern) return { changes: [], moreChanges: [] };
  // Branch names separate words with hyphens, as in feat/esm-801-story-tests-panel, so only letters and digits end an ID there.
  const branchPattern = new RegExp(pattern.source.replace("(?<![A-Za-z0-9_-])", "(?<![A-Za-z0-9])").replace("(?![A-Za-z0-9_-])", "(?![A-Za-z0-9])"), "gi");
  const ids = new Map(map.stories.map((story, index) => [story.id, index]));
  const byLowerCase = new Map(map.stories.map(story => [story.id.toLowerCase(), story.id]));
  const named = (text: string, into: Set<string>) => {
    for (const match of text.matchAll(pattern)) if (ids.has(match[0])) into.add(match[0]);
  };

  const head = (await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  const format = ["%H", "%P", "%cI", "%an", "%cn", "%s", "%b"].join("%x1f");
  const commits = new Map(parseCommits(await git(cwd, ["log", "-z", `--format=${format}`, head], 1024 * 1024 * 1024)).map(commit => [commit.sha, commit]));

  const chain: Commit[] = [];
  for (let commit = commits.get(head); commit; commit = commits.get(commit.parents[0])) chain.push(commit);
  chain.reverse();

  const seen = new Set<string>();
  const found: StoryChange[] = [];
  for (const commit of chain) {
    const branchCommits: Commit[] = [];
    const stack = commit.parents.slice(1);
    while (stack.length) {
      const sha = stack.pop()!;
      const branchCommit = commits.get(sha);
      if (!branchCommit || seen.has(sha)) continue;
      seen.add(sha);
      branchCommits.push(branchCommit);
      stack.push(...branchCommit.parents);
    }
    seen.add(commit.sha);

    const stories = new Set<string>();
    named(`${commit.subject}\n${commit.body}`, stories);
    for (const branchCommit of branchCommits) named(`${branchCommit.subject}\n${branchCommit.body}`, stories);
    const branch = mergedBranch(commit.subject);
    for (const match of branch?.matchAll(branchPattern) ?? []) {
      const id = byLowerCase.get(match[0].toLowerCase());
      if (id) stories.add(id);
    }
    if (!stories.size) continue;

    const work = branchCommits.filter(branchCommit => branchCommit.parents.length < 2);
    const latest = work.reduce<Commit | undefined>((newest, next) => !newest || next.committedAt > newest.committedAt ? next : newest, undefined);
    const rawMerger = mergedBy(commit);
    const by = historyName(credit(latest?.authorName ?? commit.authorName, rawMerger));
    const merger = historyName(rawMerger);
    const title = fitHistoryText(changeTitle(commit), historyChangeTextMaxLength);
    const branchName = fitHistoryText(branch, historyChangeTextMaxLength);
    found.push({
      storyIds: [...stories].sort((a, b) => ids.get(a)! - ids.get(b)!),
      ...(commit.pullRequest ? { pullRequest: commit.pullRequest } : {}),
      ...(title ? { title } : {}),
      ...(branchName ? { branch: branchName } : {}),
      commit: commit.sha,
      at: new Date(commit.committedAt).toISOString(),
      ...(by ? { by } : {}),
      ...(merger ? { mergedBy: merger } : {}),
      ...(work.length ? { commitCount: work.length } : {}),
    });
  }

  // Newest first, keeping at most historyChangesPerStory for each story and counting the rest.
  const listed = new Map<string, number>();
  const more = new Map<string, number>();
  const changes: StoryChange[] = [];
  for (const change of found.reverse()) {
    const kept = change.storyIds.filter(id => {
      const count = listed.get(id) ?? 0;
      if (count < historyChangesPerStory && changes.length < historyChangesMaxItems) {
        listed.set(id, count + 1);
        return true;
      }
      more.set(id, (more.get(id) ?? 0) + 1);
      return false;
    });
    if (kept.length) changes.push({ ...change, storyIds: kept });
  }
  const moreChanges = map.stories.flatMap(story => more.has(story.id) ? [{ storyId: story.id, count: more.get(story.id)! }] : []);
  return { changes, moreChanges };
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

  const format = ["%H", "%P", "%cI", "%an", "%cn", "%s", "%b"].join("%x1f");
  const commits = parseCommits(await git(cwd, ["log", "-z", "--first-parent", "--reverse", `--format=${format}`, ref, "--", mapPath]));

  const bots = new Set((options.botNames ?? []).map(name => name.trim().toLowerCase()).filter(Boolean));
  const isBot = (name: string) => name.toLowerCase().endsWith("[bot]") || bots.has(name.toLowerCase());
  // A bot did the work, so credit the person who accepted it, when Git knows who that is.
  const credit = (author: string, merger: string | undefined) => isBot(author) && merger && !isBot(merger) ? merger : author;

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
    const pullRequest = commit.pullRequest ? { pullRequest: commit.pullRequest } : {};
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
      return credit(await author(), rawMerger);
    };

    for (const story of current.stories) {
      const earlier = before.get(story.id);
      if (earlier && canonical(earlier) === canonical(story)) continue;
      const by = historyName(await editor(story));
      const reason = story.status === "blocked" || story.status === "cut"
        ? fitHistoryText(story.statusReason, historyReasonMaxLength)
        : undefined;
      lastEdits.set(story.id, { storyId: story.id, at, ...(by ? { by } : {}), commit: commit.sha, ...pullRequest });
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
        ...pullRequest,
      });
    }
    previous = current;
  }

  const { changes, moreChanges } = previous ? await findStoryChanges(cwd, ref, previous, credit) : { changes: [], moreChanges: [] };

  return {
    version: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    complete: !shallow,
    events,
    // Only stories still in the map. A story first seen in a shallow clone's baseline has no known edit.
    lastEdits: (previous?.stories ?? []).flatMap(story => lastEdits.get(story.id) ?? []),
    ...(skippedCount ? { skipped, skippedCount } : {}),
    changes,
    ...(moreChanges.length ? { moreChanges } : {}),
  };
}
