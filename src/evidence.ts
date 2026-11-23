import { execFile } from "node:child_process";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { StoryMapHistory } from "./history.js";
import { mergedBranch, pullRequestNumber } from "./history-git.js";
import { closestIds, type MissingStory } from "./read.js";
import { branchIdPattern, checkSources, findStoryMentions, statOrNull, storyIdPattern, type ReferenceIssue } from "./references.js";
import { loadStoryMap, type LoadedStoryMap } from "./schema.js";
import { isActiveStatus, type StoryStatus } from "./status.js";
import { findStoryTests } from "./tests.js";
import { getStoryMapForViewer, type StoryMapView } from "./view.js";

const run = promisify(execFile);

/** Most commits, plan mentions and tests listed for one story. The rest are counted. */
export const evidenceItemsMaxItems = 20;
/** Longest commit subject or plan line kept, in characters. */
export const evidenceTextMaxLength = 200;

/** Options for `gatherStoryEvidence`. */
export interface StoryEvidenceOptions {
  /** Repository root: where Git runs and what plans, tests and sources are relative to. Defaults to the current directory. */
  root?: string;
  /** Stories to look up. Defaults to every active story: planned, in progress, merged and shipped. */
  ids?: readonly string[];
  /** Path of the map, relative to the root, so a commit that only changes the map counts as planning. Defaults to `product/story-map.yaml`. */
  map?: string;
  /** Branch to read merged commits from. Defaults to `origin/HEAD`, then `main` and `master`, each from `origin` first. */
  defaultBranch?: string;
  /** Folders or files whose Markdown mentions are reported. Defaults to `docs` when it exists, otherwise the whole root. */
  plans?: readonly string[];
  /** Folders or files whose tagged tests are reported. Defaults to the whole root. */
  tests?: readonly string[];
  /** History from `story-map history`, to find stalled stories. */
  history?: StoryMapHistory;
  /** Overrides the map's `settings.stalledAfterWeeks`. */
  stalledAfterWeeks?: number;
  /** Time to judge stalled stories against. Defaults to now. */
  now?: Date;
  /**
   * A `git tag --list` pattern, such as `v*`, for the tags that mark a release
   * going out. When given, a merged story whose merging commit is in a
   * matching tag is suggested as shipped. Off by default, so evidence never
   * suggests shipped without it.
   */
  shippedTags?: string;
}

/** A local or remote branch whose name contains the story ID. */
export interface EvidenceBranch {
  /** Short name, such as `feat/esm-105-look-up-evidence` or `origin/feat/esm-105-look-up-evidence`. */
  name: string;
  commit: string;
  committedAt: string;
  /** True when the branch's last commit is already on the default branch. */
  merged: boolean;
}

/**
 * A commit on the default branch that mentions the story ID, in its message or
 * in the name of the branch it merged. `changes` is `code` when it changes
 * any file other than Markdown, the map or files under the plan folders,
 * `plans` when it changes only those, and `unknown` when Git listed no files.
 */
export interface EvidenceCommit {
  commit: string;
  committedAt: string;
  subject: string;
  pullRequest?: number;
  /**
   * `title` when the subject, the pull request title of a merge or the merged
   * branch's name has the ID, and `message` when only the rest of the message
   * mentions it, such as in a list of renumbered stories.
   */
  named: "title" | "message";
  changes: "code" | "plans" | "unknown";
}

export interface EvidenceMention {
  file: string;
  line: number;
  text: string;
}

export interface EvidenceTest {
  file: string;
  line: number;
  name: string;
}

/** What `gatherStoryEvidence` found for one story, and the status it suggests. */
export interface StoryEvidence {
  id: string;
  title: string;
  status: StoryStatus;
  /** The status the evidence suggests. The same as `status` when nothing points to a change. */
  suggestedStatus: StoryStatus;
  /** Why the suggestion is what it is, one sentence each. */
  reasons: string[];
  /** Present when history was given and the story has been in progress past the stalled threshold. */
  stalled?: { since: string; afterWeeks: number };
  branches: EvidenceBranch[];
  /** Newest first. */
  commits: EvidenceCommit[];
  moreCommits?: number;
  plans: EvidenceMention[];
  morePlans?: number;
  tests: EvidenceTest[];
  moreTests?: number;
  /** Sources that point to a file or heading that does not exist. */
  brokenSources: { source: string; message: string }[];
  /** With `shippedTags`, the earliest matching tag that holds the merged story's merging commit. */
  shippedIn?: EvidenceTag;
}

/** A release tag that holds a story's merging commit. */
export interface EvidenceTag {
  tag: string;
  /** The merging commit the tag holds. */
  commit: string;
}

/** The outcome of `gatherStoryEvidence`. */
export interface StoryEvidenceResult {
  /** The branch merged commits were read from, or absent when none was found. */
  defaultBranch?: string;
  /** Which signals were read. `git` is missing when the root is not a Git checkout. */
  checked: ("git" | "tags" | "plans" | "tests" | "sources" | "history")[];
  /** Problems reading a signal, such as a shallow clone or a plan folder with no Markdown. None of them stop the lookup. */
  notes: string[];
  stories: StoryEvidence[];
  /** IDs that are not in the map, with close matches. */
  missing: MissingStory[];
}

/** A problem with the options, such as a default branch that does not exist. */
export class StoryEvidenceError extends Error {}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const fit = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > evidenceTextMaxLength ? `${line.slice(0, evidenceTextMaxLength - 1)}…` : line;
};

/** Whether a ref exists and names a commit. Refs that start with `-` are refused so Git cannot read them as options. */
async function commitExists(root: string, ref: string) {
  if (ref.startsWith("-")) return false;
  try {
    await git(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function findDefaultBranch(root: string, asked: string | undefined): Promise<string | undefined> {
  if (asked !== undefined) {
    if (await commitExists(root, asked)) return asked;
    throw new StoryEvidenceError(`--default-branch ${asked} is not a branch or commit in this repository.`);
  }
  try {
    const head = (await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (head && await commitExists(root, head)) return head;
  } catch {
    // origin/HEAD is often unset, such as in a clone made by CI.
  }
  for (const ref of ["origin/main", "main", "origin/master", "master"]) {
    if (await commitExists(root, ref)) return ref;
  }
  return undefined;
}

/** Maps an ID as written, in any case, to the map's ID. */
const idLookup = (ids: Iterable<string>) => {
  const byKey = new Map([...ids].map(id => [id.toUpperCase(), id]));
  return (found: string) => byKey.get(found.toUpperCase());
};

function idsIn(text: string, pattern: RegExp | undefined, lookup: (found: string) => string | undefined) {
  if (!pattern) return [];
  return [...new Set(Array.from(text.matchAll(pattern), match => lookup(match[0])).filter((id): id is string => !!id))];
}

async function readBranches(root: string, defaultBranch: string | undefined, pattern: RegExp | undefined, lookup: (found: string) => string | undefined) {
  const byStory = new Map<string, EvidenceBranch[]>();
  if (!pattern) return byStory;
  const format = "--format=%(refname)%1f%(objectname)%1f%(committerdate:iso-strict)%1f%(symref)";
  const refs = await git(root, ["for-each-ref", format, "refs/heads", "refs/remotes"]);
  const merged = new Set(defaultBranch
    ? (await git(root, ["for-each-ref", "--format=%(refname)", `--merged=${defaultBranch}`, "refs/heads", "refs/remotes"])).split("\n")
    : []);
  for (const line of refs.split("\n")) {
    const [ref, commit, committedAt, symref] = line.split("\u001f");
    if (!ref || symref) continue;
    const name = ref.replace(/^refs\/(heads|remotes)\//, "");
    if (name === defaultBranch) continue;
    for (const id of idsIn(name, pattern, lookup)) {
      const list = byStory.get(id) ?? [];
      list.push({ name, commit, committedAt, merged: merged.has(ref) });
      byStory.set(id, list);
    }
  }
  return byStory;
}

/** Folders whose files count as planning, relative to the root with `/` separators. The root itself is never one. */
function planningFolders(root: string, plans: readonly string[]) {
  return plans
    .map(path => relative(root, resolve(root, path)).split(sep).join("/"))
    .filter(path => path && path !== "." && !path.startsWith("../") && !isAbsolute(path));
}

const markdownExtensions = new Set([".md", ".markdown", ".mdx"]);

async function readCommits(
  root: string,
  defaultBranch: string,
  loaded: LoadedStoryMap,
  lookup: (found: string) => string | undefined,
  isPlanning: (file: string) => boolean,
) {
  const byStory = new Map<string, EvidenceCommit[]>();
  const messagePattern = storyIdPattern(loaded);
  const namePattern = branchIdPattern(loaded);
  const prefixes = [...new Set(loaded.map.stories.flatMap(story => /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(story.id)?.[1] ?? []))];
  if (!messagePattern || !prefixes.length) return byStory;
  // Git narrows the walk to messages that look like they name an ID; the
  // patterns below decide which ones do. Merges list the files they bring in.
  const output = await git(root, [
    "log", "-E", "-i", `--grep=(${prefixes.join("|")})-[0-9]+`, "--diff-merges=first-parent", "--name-only",
    "--format=%x1e%H%x1f%cI%x1f%s%x1f%b%x1d", defaultBranch, "--",
  ]);
  for (const record of output.split("\u001e").filter(Boolean)) {
    const [header, files = ""] = record.split("\u001d");
    const [commit, committedAt, subject = "", body = ""] = header.split("\u001f");
    const branch = mergedBranch(subject);
    // A merge's title is the pull request title, which GitHub and GitLab put on the body's first line.
    const title = branch ? `${subject}\n${body.split("\n").map(line => line.trim()).find(Boolean) ?? ""}` : subject;
    const inTitle = new Set([...idsIn(title, messagePattern, lookup), ...idsIn(branch ?? "", namePattern, lookup)]);
    const ids = new Set([...inTitle, ...idsIn(body, messagePattern, lookup)]);
    if (!ids.size) continue;
    const changed = files.split("\n").map(file => file.trim()).filter(Boolean);
    const pullRequest = pullRequestNumber(subject, body);
    const changes = !changed.length ? "unknown" : changed.every(isPlanning) ? "plans" : "code";
    for (const id of ids) {
      const list = byStory.get(id) ?? [];
      list.push({ commit, committedAt, subject: fit(subject), ...(pullRequest ? { pullRequest } : {}), named: inTitle.has(id) ? "title" : "message", changes });
      byStory.set(id, list);
    }
  }
  return byStory;
}

/** Tags that match the pattern, oldest first. The pattern is passed after `--`, so Git never reads it as an option. */
async function matchingTags(root: string, pattern: string, commit?: string) {
  const output = await git(root, ["tag", "--list", "--sort=creatordate", ...(commit ? ["--contains", commit] : []), "--", pattern]);
  return output.split("\n").map(line => line.trim()).filter(Boolean);
}

/** The newest commit that counts as merged work for a story: its title names the story and it changes more than plans. */
const mergingCommit = (commits: EvidenceCommit[]) => commits.find(commit => commit.changes === "code" && commit.named === "title");

const commitRef = (commit: EvidenceCommit) => commit.pullRequest ? `Pull request #${commit.pullRequest}` : `Commit ${commit.commit.slice(0, 7)}`;

/** What release tags say about a merged story, when `shippedTags` is given. */
interface TagSignal {
  pattern: string;
  /** False when no tag matches the pattern at all. */
  anyMatch: boolean;
  shippedIn?: EvidenceTag;
}

function capped<T>(items: T[]): [T[], number | undefined] {
  return items.length > evidenceItemsMaxItems ? [items.slice(0, evidenceItemsMaxItems), items.length - evidenceItemsMaxItems] : [items, undefined];
}

/**
 * The status the evidence suggests, following the audit's rules: never back
 * from merged or shipped, never a change to a cut story, and never shipped,
 * because only a person or a release signal says work is available. A commit
 * counts as merged work only when its title names the story and it changes
 * more than plans and the map.
 */
function suggest(status: StoryStatus, branches: EvidenceBranch[], commits: EvidenceCommit[], gitRead: boolean, tags?: TagSignal): { suggestedStatus: StoryStatus; reasons: string[] } {
  if (status === "cut") return { suggestedStatus: status, reasons: ["The story is cut, so evidence never changes its status."] };
  if (status === "shipped") return { suggestedStatus: status, reasons: ["The story is shipped, so evidence never moves it back."] };
  if (status === "merged") {
    if (!tags || !gitRead) {
      return { suggestedStatus: status, reasons: ["The story is merged. Only a person or a release says it is shipped, so evidence does not suggest it."] };
    }
    const code = mergingCommit(commits);
    if (!code) {
      return { suggestedStatus: status, reasons: ["The story is merged, but no commit on the default branch names it in its title and changes code, so release tags cannot say it is shipped."] };
    }
    if (tags.shippedIn) {
      return { suggestedStatus: "shipped", reasons: [`${commitRef(code)} is in tag ${tags.shippedIn.tag}, which matches ${tags.pattern}, so the release has gone out.`] };
    }
    const why = tags.anyMatch ? `is not in any tag that matches ${tags.pattern} yet` : `is not in a release tag, because no tag matches ${tags.pattern}`;
    return { suggestedStatus: status, reasons: [`The story is merged. ${commitRef(code)} ${why}, so evidence does not suggest shipped.`] };
  }
  if (!gitRead) return { suggestedStatus: status, reasons: ["Git was not read, so there is no evidence for another status."] };
  const code = mergingCommit(commits);
  if (code) {
    return { suggestedStatus: "merged", reasons: [`${commitRef(code)} on the default branch names the story in its title and changes more than plans and the map.`] };
  }
  const reasons: string[] = [];
  if (commits.length) {
    reasons.push(`${commits.length === 1 ? "A commit" : `${commits.length} commits`} on the default branch mention the story, but none names it in its title and changes more than plans and the map, so none counts as merged work.`);
  }
  if (status === "blocked") {
    reasons.push("The story is blocked. Only merged work, or a person, moves it on.");
    return { suggestedStatus: status, reasons };
  }
  const open = branches.find(branch => !branch.merged);
  if (status === "planned" && open) {
    reasons.unshift(`Branch ${open.name} names the story and is not merged.`);
    return { suggestedStatus: "in-progress", reasons };
  }
  if (!reasons.length) reasons.push(status === "in-progress" && !open ? "No open branch or merged work names the story." : "Nothing points to another status.");
  return { suggestedStatus: status, reasons };
}

/**
 * Gathers facts about stories without changing anything: branches whose names
 * contain the ID, default-branch commits that mention it, Markdown files that
 * mention it, tagged tests, broken sources, and stalled stories when history
 * is given, with a suggested status for each. Git runs with argument arrays,
 * never a shell, and works offline from the checkout. Takes the map's source
 * text, or a map the CLI already loaded, and throws `StoryMapValidationError`
 * for an invalid map.
 */
export async function gatherStoryEvidence(source: string | LoadedStoryMap, options: StoryEvidenceOptions = {}): Promise<StoryEvidenceResult> {
  const loaded = typeof source === "string" ? loadStoryMap(source) : source;
  const root = resolve(options.root ?? ".");
  const { map } = loaded;
  const shippedTags = options.shippedTags;
  if (shippedTags !== undefined && !shippedTags.trim()) throw new StoryEvidenceError("--shipped-tags needs a tag pattern, such as 'v*'.");
  const known = new Set(map.stories.map(story => story.id));
  const lookup = idLookup(known);
  const missing: MissingStory[] = [];
  const wanted = options.ids?.length ? [...new Set(options.ids)] : map.stories.filter(story => isActiveStatus(story.status)).map(story => story.id);
  const targets = wanted.filter(id => {
    if (known.has(id)) return true;
    missing.push({ id, suggestions: closestIds(id, [...known]) });
    return false;
  });
  const targetSet = new Set(targets);
  const notes: string[] = [];
  const checked: StoryEvidenceResult["checked"] = [];
  const plans = options.plans?.length ? [...options.plans] : [(await statOrNull(resolve(root, "docs")))?.isDirectory() ? "docs" : "."];

  let defaultBranch: string | undefined;
  let branches = new Map<string, EvidenceBranch[]>();
  let commits = new Map<string, EvidenceCommit[]>();
  let gitRead = false;
  let inRepository = false;
  try {
    inRepository = (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    notes.push("Not a Git checkout, so branches and commits were not read.");
  }
  if (inRepository) {
    defaultBranch = await findDefaultBranch(root, options.defaultBranch);
    if ((await git(root, ["rev-parse", "--is-shallow-repository"])).trim() === "true") {
      notes.push("This is a shallow clone, so older commits on the default branch were not read. Fetch the full history for complete evidence.");
    }
    branches = await readBranches(root, defaultBranch, branchIdPattern(loaded), lookup);
    if (defaultBranch) {
      const mapFile = relative(root, resolve(root, options.map ?? "product/story-map.yaml")).split(sep).join("/");
      const folders = planningFolders(root, plans);
      const isPlanning = (file: string) =>
        file === mapFile || markdownExtensions.has(extname(file).toLowerCase()) || folders.some(folder => file.startsWith(`${folder}/`));
      commits = await readCommits(root, defaultBranch, loaded, lookup, isPlanning);
    } else {
      notes.push("No default branch found: origin/HEAD, main and master are all missing, so merged commits were not read. Pass --default-branch.");
    }
    gitRead = true;
    checked.push("git");
  }

  // Release tags, only when asked for and only for merged stories with a merging commit.
  const tagSignals = new Map<string, TagSignal>();
  if (shippedTags !== undefined && gitRead && defaultBranch) {
    const anyMatch = (await matchingTags(root, shippedTags)).length > 0;
    if (!anyMatch) notes.push(`No tag matches --shipped-tags ${shippedTags}, so no story is suggested as shipped. In CI, fetch tags with the history.`);
    for (const id of targets) {
      if (map.stories.find(story => story.id === id)?.status !== "merged") continue;
      const code = mergingCommit(commits.get(id) ?? []);
      const [tag] = anyMatch && code ? await matchingTags(root, shippedTags, code.commit) : [];
      tagSignals.set(id, { pattern: shippedTags, anyMatch, ...(tag && code ? { shippedIn: { tag, commit: code.commit } } : {}) });
    }
    checked.push("tags");
  } else if (shippedTags !== undefined) {
    notes.push("--shipped-tags needs Git and a default branch, so release tags were not read.");
  }

  const issueText = (issue: ReferenceIssue) => `${issue.file ? `${issue.file}: ` : ""}${issue.message}`;
  const mentions = await findStoryMentions(loaded, root, plans);
  notes.push(...mentions.issues.map(issueText));
  checked.push("plans");

  const tests = await findStoryTests(loaded, root, { paths: [...(options.tests ?? ["."])] });
  notes.push(...tests.issues.map(issueText));
  checked.push("tests");

  const sourceIssues = await checkSources(loaded, root);
  checked.push("sources");

  const stalledById = new Map<string, { since: string; afterWeeks: number }>();
  if (options.history) {
    const view = getStoryMapForViewer(map, {}, { canViewInternal: () => true, history: options.history, stalledAfterWeeks: options.stalledAfterWeeks, now: options.now }) as Extract<StoryMapView, { audience: "internal" }> | null;
    if (view?.audience === "internal") {
      const afterWeeks = view.stalledAfterWeeks ?? 0;
      for (const story of view.stories) {
        if (story.stalled && story.inProgressSince && targetSet.has(story.id)) stalledById.set(story.id, { since: story.inProgressSince, afterWeeks });
      }
    }
    checked.push("history");
  }

  const stories = targets.map(id => {
    const story = map.stories.find(item => item.id === id)!;
    const storyBranches = branches.get(id) ?? [];
    const [storyCommits, moreCommits] = capped(commits.get(id) ?? []);
    const lines = new Map(mentions.mentions.filter(mention => mention.id === id).map(({ file, line, text }) => [`${file}:${line}`, { file, line, text: fit(text) }]));
    const [storyPlans, morePlans] = capped([...lines.values()]);
    const [storyTests, moreTests] = capped(tests.tests.filter(test => test.storyIds.includes(id)).map(({ file, line, name }) => ({ file, line, name: fit(name) })));
    const brokenSources = sourceIssues
      .filter(issue => issue.itemId === id && issue.path[0] === "stories" && issue.path[2] === "sources")
      .map(issue => ({ source: story.sources?.[issue.path[3] as number] ?? "", message: issue.message }));
    const tagSignal = tagSignals.get(id);
    const { suggestedStatus, reasons } = suggest(story.status, storyBranches, commits.get(id) ?? [], gitRead && !!defaultBranch, tagSignal);
    const stalled = stalledById.get(id);
    if (stalled) reasons.push(`In progress since ${stalled.since.slice(0, 10)}, longer than the ${stalled.afterWeeks} week stalled threshold.`);
    if (brokenSources.length) reasons.push(`${brokenSources.length === 1 ? "A source points" : `${brokenSources.length} sources point`} to something that no longer exists.`);
    const evidence: StoryEvidence = {
      id,
      title: story.title,
      status: story.status,
      suggestedStatus,
      reasons,
      ...(stalled ? { stalled } : {}),
      branches: storyBranches,
      commits: storyCommits,
      ...(moreCommits ? { moreCommits } : {}),
      plans: storyPlans,
      ...(morePlans ? { morePlans } : {}),
      tests: storyTests,
      ...(moreTests ? { moreTests } : {}),
      brokenSources,
      ...(tagSignal?.shippedIn ? { shippedIn: tagSignal.shippedIn } : {}),
    };
    return evidence;
  });

  return { ...(defaultBranch ? { defaultBranch } : {}), checked, notes, stories, missing };
}
