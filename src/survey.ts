import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { readTextFileWithin } from "./read-text.js";
import {
  markdownHeadings,
  maxMarkdownBytes,
  outsideLinkIssue,
  repositoryFiles,
  resolveRootedPath,
  type FileFilter,
  type ReferenceIssue,
} from "./references.js";

const run = promisify(execFile);

/** Most releases, docs and open plans listed. The rest are counted. */
export const surveyItemsMaxItems = 200;
/** Most `TODO` and `FIXME` comments listed. The rest are counted. */
export const surveyTodosMaxItems = 200;
/** Most headings listed for one doc. The rest are counted. */
export const surveyHeadingsMaxItems = 30;
/** Most changelog entries listed for one version. The rest are counted. */
export const surveyEntriesMaxItems = 10;
/** Longest heading, status, changelog entry or comment kept, in characters. */
export const surveyTextMaxLength = 200;
/** Largest code file read for `TODO` and `FIXME` comments, so a survey stays quick. */
export const surveyCodeFileMaxBytes = 1024 * 1024;

/** Options for `surveyRepository`. */
export interface RepositorySurveyOptions {
  /** Repository root: where Git runs and what every path is relative to. Defaults to the current directory. */
  root?: string;
  /** A `git tag --list` pattern, such as `v*`, for the release tags. Defaults to every tag. */
  tags?: string;
  /** The changelog, relative to the root. Defaults to `CHANGELOG.md` at the root, in any case. */
  changelog?: string;
  /** Folders or files whose Markdown is listed as docs. Defaults to the whole root. */
  docs?: readonly string[];
  /** Folders or files whose Markdown counts as plans. Defaults to docs inside a `plans`, `rfcs`, `proposals`, `adr` or `decisions` folder, and roadmaps. */
  plans?: readonly string[];
}

/** A release tag. `commit` is the commit it points to, and `date` when it was made. */
export interface SurveyTag {
  name: string;
  commit: string;
  date: string;
}

/** A version heading in the changelog, with the first of its entries. */
export interface SurveyChangelogVersion {
  heading: string;
  /** The heading as a source, such as `CHANGELOG.md#075`. */
  source: string;
  line: number;
  /** A date written in the heading, such as 2026-03-01. */
  date?: string;
  /** Top-level list items under the version, as written. */
  entries: string[];
  moreEntries?: number;
}

/** A suggested release: a version from a tag, the changelog or both. */
export interface SurveyRelease {
  /** The version, such as `0.7.5`, the tag name when it has no version, or `Unreleased`. */
  version: string;
  /** A release ID the map could use, such as `v0-7-5`. */
  suggestedId: string;
  /** The tag's date, or else the changelog's. */
  date?: string;
  /** True for the changelog's Unreleased section, which is work merged but not released. */
  unreleased?: boolean;
  tag?: SurveyTag;
  changelog?: SurveyChangelogVersion;
}

/** A heading in a doc, as a source the map can cite. */
export interface SurveyHeading {
  level: number;
  text: string;
  /** Such as `docs/billing.md#refunds`. */
  source: string;
}

/** A Markdown doc and its headings. */
export interface SurveyDoc {
  file: string;
  /** The first level 1 heading. */
  title?: string;
  headings: SurveyHeading[];
  moreHeadings?: number;
}

/** A plan doc that does not say it is done. */
export interface SurveyPlan {
  file: string;
  title?: string;
  /** The plan's `Status:` line, as written, when it has one. */
  status?: string;
}

/** A `TODO` or `FIXME` comment in code. */
export interface SurveyTodo {
  file: string;
  line: number;
  kind: "TODO" | "FIXME";
  /** The comment after the keyword. */
  text: string;
}

/** The outcome of `surveyRepository`. */
export interface RepositorySurvey {
  /** Which signals were read. `git` is missing outside a Git checkout, and `changelog` when there is none. */
  checked: ("git" | "tags" | "changelog" | "docs" | "plans" | "todos")[];
  /** Problems reading a signal, such as a shallow clone or a file too large to read. None of them stop the survey. */
  notes: string[];
  /** The commit history behind `HEAD`, when Git was read and it has commits. */
  history?: { commits: number; firstCommitAt: string; lastCommitAt: string };
  /** Oldest first, with Unreleased last. Only the newest `surveyItemsMaxItems` are listed. */
  releases: SurveyRelease[];
  moreReleases?: number;
  docs: SurveyDoc[];
  moreDocs?: number;
  /** Plans whose status does not say they are done, merged, shipped or dropped. */
  plans: SurveyPlan[];
  morePlans?: number;
  /** Plans left out because their status says they are finished. They are still listed in `docs`. */
  closedPlans: number;
  todos: SurveyTodo[];
  moreTodos?: number;
}

/** A problem with the options, such as an empty tag pattern or a changelog outside the root. */
export class RepositorySurveyError extends Error {}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const fit = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > surveyTextMaxLength ? `${line.slice(0, surveyTextMaxLength - 1)}…` : line;
};

function capped<T>(items: T[], max: number): [T[], number | undefined] {
  return items.length > max ? [items.slice(0, max), items.length - max] : [items, undefined];
}

const versionPattern = /^[vV]?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
/** Longest tag name read for a version. Git keeps tag names short. */
const tagNameMaxLength = 256;

/** Removes hyphens from both ends, without a regular expression that backtracks on long runs of them. */
function trimHyphens(text: string) {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "-") start++;
  while (end > start && text[end - 1] === "-") end--;
  return text.slice(start, end);
}

/** The version in a tag name such as `v1.2.0` or `pkg@1.2.0`, or undefined. */
export function tagVersion(tag: string): string | undefined {
  // Try the whole name, then the text after each @, /, _ or -, so pkg@1.2.0 gives 1.2.0.
  const name = tag.slice(0, tagNameMaxLength);
  for (let start = 0; start < name.length; start++) {
    if (start > 0 && !"@/_-".includes(name[start - 1])) continue;
    const match = versionPattern.exec(name.slice(start));
    if (match) return match[1];
  }
  return undefined;
}

/** A release ID from a version or tag, such as `v0-7-5` for 0.7.5, within the map's ID rules. */
export function suggestedReleaseId(version: string): string {
  if (/^unreleased$/i.test(version)) return "unreleased";
  const slug = trimHyphens(version.slice(0, tagNameMaxLength).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const id = /^\d/.test(slug) ? `v${slug}` : slug || "release";
  return trimHyphens(id.slice(0, 64));
}

/** Compares numeric versions: by each number, then a prerelease before its release. */
function compareVersions(a: string, b: string) {
  const [coreA, preA] = a.split("+")[0].split(/-(.*)/s);
  const [coreB, preB] = b.split("+")[0].split(/-(.*)/s);
  const partsA = coreA.split(".").map(Number);
  const partsB = coreB.split(".").map(Number);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const difference = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (difference) return difference;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}

async function readTags(root: string, pattern: string | undefined): Promise<SurveyTag[]> {
  const format = "--format=%(refname:short)%1f%(objectname)%1f%(*objectname)%1f%(creatordate:iso-strict)";
  const output = await git(root, ["tag", "--list", "--sort=creatordate", format, ...(pattern ? ["--", pattern] : [])]);
  return output.split("\n").filter(Boolean).map(line => {
    const [name, object, peeled, date] = line.split("\u001f");
    return { name, commit: peeled || object, date };
  });
}

async function readHistory(root: string): Promise<RepositorySurvey["history"]> {
  try {
    const commits = Number((await git(root, ["rev-list", "--count", "HEAD"])).trim());
    const lastCommitAt = (await git(root, ["log", "-1", "--format=%cI", "HEAD"])).trim();
    const roots = (await git(root, ["log", "--max-parents=0", "--format=%cI", "HEAD"])).split("\n").filter(Boolean).sort();
    return { commits, firstCommitAt: roots[0] ?? lastCommitAt, lastCommitAt };
  } catch {
    return undefined; // A repository with no commits yet.
  }
}

const changelogHeading = /^\[?[vV]?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?)\]?(?:\W|$)/;
const datePattern = /\b(\d{4}-\d{2}-\d{2})\b/;

/**
 * Reads a changelog's version headings, such as `## 1.2.0`, `## [1.2.0] - 2026-03-01`
 * or `## Unreleased`, and the top-level list items under each. Versions are the
 * headings at the level of the first one, so subheadings inside a version stay in it.
 */
export function changelogVersions(markdown: string, file: string): SurveyChangelogVersion[] {
  const headings = markdownHeadings(markdown);
  const isVersion = (text: string) => changelogHeading.test(text) || /^\[?unreleased\]?(?:\W|$)/i.test(text);
  const level = headings.find(heading => isVersion(heading.text))?.level;
  if (level === undefined) return [];
  const versions = headings.filter(heading => heading.level === level && isVersion(heading.text));
  const lines = markdown.split(/\r?\n/);
  return versions.map((heading, index) => {
    // The section runs to the next version, or to a heading above the versions' level.
    const next = index + 1 < versions.length ? versions[index + 1].line : headings.find(other => other.line > heading.line && other.level < level)?.line;
    const items = lines.slice(heading.line, (next ?? lines.length + 1) - 1)
      .map(line => /^ {0,1}[-*+]\s+(.*)$/.exec(line)?.[1])
      .filter((item): item is string => !!item?.trim())
      .map(fit);
    const [entries, moreEntries] = capped(items, surveyEntriesMaxItems);
    const date = datePattern.exec(heading.text)?.[1];
    return {
      heading: fit(heading.text),
      source: `${file}#${heading.anchor}`,
      line: heading.line,
      ...(date ? { date } : {}),
      entries,
      ...(moreEntries ? { moreEntries } : {}),
    };
  });
}

/** Joins tags and changelog versions into suggested releases: by version, oldest first, then tags with no version by date, then Unreleased. */
function suggestReleases(tags: SurveyTag[], versions: SurveyChangelogVersion[]): SurveyRelease[] {
  const byKey = new Map<string, SurveyRelease>();
  const keyOf = (version: string) => version.toLowerCase().replace(/^v/, "");
  for (const changelog of versions) {
    const unreleased = /^\[?unreleased/i.test(changelog.heading);
    const version = unreleased ? "Unreleased" : changelogHeading.exec(changelog.heading)![1];
    const key = keyOf(version);
    if (byKey.has(key)) continue;
    byKey.set(key, { version, suggestedId: suggestedReleaseId(version), ...(changelog.date ? { date: changelog.date } : {}), ...(unreleased ? { unreleased } : {}), changelog });
  }
  for (const tag of tags) {
    const version = tagVersion(tag.name) ?? tag.name;
    const key = keyOf(version);
    const known = byKey.get(key);
    if (known?.tag) continue;
    if (known) {
      byKey.set(key, { ...known, date: tag.date, tag });
    } else {
      byKey.set(key, { version, suggestedId: suggestedReleaseId(version), date: tag.date, tag });
    }
  }
  const numeric = (release: SurveyRelease) => !release.unreleased && /^\d+(\.\d+)+/.test(release.version);
  const all = [...byKey.values()];
  return [
    ...all.filter(numeric).sort((a, b) => compareVersions(a.version, b.version)),
    ...all.filter(release => !numeric(release) && !release.unreleased).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    ...all.filter(release => release.unreleased),
  ];
}

const skippedFolders = new Set(["dist", "build", "coverage", "vendor", "out", "target"]);
const markdownExtensions = new Set([".md", ".markdown", ".mdx"]);
const markdownFilter: FileFilter = {
  include: (_, name) => markdownExtensions.has(extname(name).toLowerCase()),
  skipFolder: name => skippedFolders.has(name),
};

const codeExtensions = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".swift", ".scala", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".m", ".mm",
  ".php", ".ex", ".exs", ".erl", ".dart", ".lua", ".r", ".pl", ".sh", ".bash", ".zsh", ".sql",
  ".css", ".scss", ".sass", ".less", ".html", ".htm", ".yml", ".yaml", ".toml",
]);
const codeFilter: FileFilter = {
  include: (_, name) => codeExtensions.has(extname(name).toLowerCase()),
  skipFolder: name => skippedFolders.has(name),
};

const planFolders = new Set(["plans", "plan", "rfcs", "rfc", "proposals", "adr", "adrs", "decisions"]);
const isPlanFile = (file: string) =>
  file.split("/").slice(0, -1).some(folder => planFolders.has(folder.toLowerCase())) || /^roadmap\.(md|markdown|mdx)$/i.test(basename(file));

const statusLine = /^\s*(?:[-*]\s+)?[*_]*status[*_]*\s*:[*_]*(.*)$/i;
const closedWords = new Set([
  "done", "built", "complete", "completed", "implemented", "merged", "shipped", "released", "delivered", "finished",
  "superseded", "replaced", "rejected", "declined", "withdrawn", "abandoned", "cut", "dropped", "obsolete", "deprecated", "archived",
]);

/** The plan's `Status:` line among its first lines, and whether its first word says it is finished. */
function planStatus(markdown: string): { status?: string; closed: boolean } {
  const line = markdown.split(/\r?\n/, 40).map(text => statusLine.exec(text)?.[1].trim()).find(Boolean);
  if (!line) return { closed: false };
  const word = /[\p{L}-]+/u.exec(line.toLowerCase())?.[0] ?? "";
  return { status: fit(line), closed: closedWords.has(word) };
}

/** Finds a `TODO` or `FIXME` that follows a comment marker on the line, such as `//`, `#`, `/*`, `*`, `--` or `<!--`. */
function todoIn(line: string): { kind: SurveyTodo["kind"]; text: string } | undefined {
  for (const match of line.matchAll(/\b(TODO|FIXME)\b/g)) {
    if (!followsCommentMarker(line.slice(0, match.index).trimEnd())) continue;
    let text = line.slice(match.index + match[0].length).trim();
    const close = commentClosers.find(closer => text.endsWith(closer));
    if (close) text = text.slice(0, -close.length).trimEnd();
    if (text.startsWith(":") || text.startsWith("-")) text = text.slice(1).trimStart();
    return { kind: match[1] as SurveyTodo["kind"], text: fit(text) };
  }
  return undefined;
}

const commentOpeners = ["//", "#", "<!--", "--", ";"];
const commentClosers = ["*/", "-->", "--!>"];

/** Whether text ends with a comment marker: `//`, `#`, `<!--`, `--`, `;`, `/*` or `/**`, or is only the `*` of a block comment's line. */
function followsCommentMarker(before: string) {
  let end = before.length;
  while (end > 0 && before[end - 1] === "*") end--;
  if (end < before.length) return before[end - 1] === "/" || !before.slice(0, end).trim();
  return commentOpeners.some(opener => before.endsWith(opener));
}

/** A problem a survey notes. Only the checks it shares with validate have a rule. */
type SurveyIssue = Omit<ReferenceIssue, "rule"> & Partial<Pick<ReferenceIssue, "rule">>;

/** Lists the files a set of paths names, through `repositoryFiles`, reporting paths that leave the root. */
async function listFiles(root: string, realRoot: string, paths: readonly string[], filter: FileFilter, issues: SurveyIssue[], empty: string) {
  const shown = (file: string) => relative(realRoot, file).split(sep).join("/");
  const files = new Set<string>();
  for (const path of paths) {
    const resolved = await resolveRootedPath(root, realRoot, path);
    if (resolved.kind === "issue") {
      issues.push(resolved.issue);
      continue;
    }
    const outside: string[] = [];
    const found = resolved.kind === "inside" ? await repositoryFiles(realRoot, resolved.path, filter, outside) : [];
    for (const link of outside) issues.push(outsideLinkIssue(shown(link)));
    if (!found.length && path !== ".") issues.push({ severity: "error", path: [], file: path, message: empty });
    for (const file of found) files.add(file);
  }
  return [...files].sort().map(file => ({ absolute: file, file: shown(file) }));
}

/**
 * Collects the facts an agent needs to draft a first map for a repository
 * that already has history, without changing anything: release tags and
 * changelog versions as suggested releases, Markdown docs and their headings
 * as candidate sources, and open plans and `TODO` and `FIXME` comments as
 * planned work. It reads and suggests only; the agent drafts the stories.
 * Git runs with argument arrays, never a shell, and works offline from the
 * checkout. No map is needed.
 */
export async function surveyRepository(options: RepositorySurveyOptions = {}): Promise<RepositorySurvey> {
  const root = resolve(options.root ?? ".");
  if (options.tags !== undefined && !options.tags.trim()) throw new RepositorySurveyError("--tags needs a tag pattern, such as 'v*'.");
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) throw new RepositorySurveyError(`--root ${options.root ?? "."} is not a folder.`);
  const realRoot = await realpath(root);
  const notes: string[] = [];
  const issues: SurveyIssue[] = [];
  const checked: RepositorySurvey["checked"] = [];

  let tags: SurveyTag[] = [];
  let history: RepositorySurvey["history"];
  let inRepository = false;
  try {
    inRepository = (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    notes.push("Not a Git checkout, so tags and history were not read.");
  }
  if (inRepository) {
    checked.push("git");
    history = await readHistory(root);
    const shallow = (await git(root, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
    if (shallow) notes.push("This is a shallow clone, so older commits and tags may be missing. Fetch the full history and tags for a complete survey.");
    tags = await readTags(root, options.tags);
    checked.push("tags");
    if (!tags.length) notes.push(options.tags ? `No tag matches --tags ${options.tags}.` : "The repository has no tags, so releases come from the changelog only.");
  }

  let versions: SurveyChangelogVersion[] = [];
  let changelog = options.changelog;
  if (changelog === undefined) changelog = (await readdir(root)).find(name => name.toLowerCase() === "changelog.md");
  if (changelog !== undefined) {
    const resolved = await resolveRootedPath(root, realRoot, changelog);
    if (resolved.kind === "issue") throw new RepositorySurveyError(`--changelog ${changelog}: ${resolved.issue.message}`);
    if (resolved.kind === "missing") throw new RepositorySurveyError(`--changelog ${changelog} does not exist.`);
    const file = relative(realRoot, resolved.path).split(sep).join("/");
    const source = await readTextFileWithin(resolved.path, maxMarkdownBytes);
    if (source === undefined) {
      notes.push(`${file} is larger than ${maxMarkdownBytes / 1024 / 1024} MB, so it was not read.`);
    } else {
      versions = changelogVersions(source, file);
      if (!versions.length) notes.push(`${file} has no version headings, such as ## 1.2.0 or ## Unreleased.`);
      checked.push("changelog");
    }
  } else {
    notes.push("No CHANGELOG.md at the root. Pass --changelog if the changelog has another name.");
  }
  const [releases, olderReleases] = (() => {
    const all = suggestReleases(tags, versions);
    return all.length > surveyItemsMaxItems ? [all.slice(-surveyItemsMaxItems), all.length - surveyItemsMaxItems] : [all, undefined];
  })();

  const docFiles = await listFiles(root, realRoot, options.docs?.length ? options.docs : ["."], markdownFilter, issues, "No Markdown files found.");
  const planFiles = options.plans?.length
    ? await listFiles(root, realRoot, options.plans, markdownFilter, issues, "No Markdown files found.")
    : docFiles.filter(doc => isPlanFile(doc.file));
  const markdown = new Map<string, string | undefined>();
  const readMarkdown = async (doc: { absolute: string; file: string }) => {
    if (!markdown.has(doc.absolute)) {
      const source = await readTextFileWithin(doc.absolute, maxMarkdownBytes);
      if (source === undefined) issues.push({ severity: "warning", path: [], file: doc.file, message: `Larger than ${maxMarkdownBytes / 1024 / 1024} MB, so it was not read.` });
      markdown.set(doc.absolute, source);
    }
    return markdown.get(doc.absolute);
  };

  const allDocs: SurveyDoc[] = [];
  for (const doc of docFiles) {
    const text = await readMarkdown(doc);
    if (text === undefined) continue;
    const found = markdownHeadings(text);
    const [headings, moreHeadings] = capped(found.map(heading => ({ level: heading.level, text: fit(heading.text), source: `${doc.file}#${heading.anchor}` })), surveyHeadingsMaxItems);
    const title = found.find(heading => heading.level === 1)?.text;
    allDocs.push({ file: doc.file, ...(title ? { title: fit(title) } : {}), headings, ...(moreHeadings ? { moreHeadings } : {}) });
  }
  const [docs, moreDocs] = capped(allDocs, surveyItemsMaxItems);
  checked.push("docs");

  const openPlans: SurveyPlan[] = [];
  let closedPlans = 0;
  for (const plan of planFiles) {
    const text = await readMarkdown(plan);
    if (text === undefined) continue;
    const { status, closed } = planStatus(text);
    if (closed) {
      closedPlans++;
      continue;
    }
    const title = markdownHeadings(text).find(heading => heading.level === 1)?.text;
    openPlans.push({ file: plan.file, ...(title ? { title: fit(title) } : {}), ...(status ? { status } : {}) });
  }
  const [plans, morePlans] = capped(openPlans, surveyItemsMaxItems);
  checked.push("plans");

  const allTodos: SurveyTodo[] = [];
  for (const code of await listFiles(root, realRoot, ["."], codeFilter, issues, "No code files found.")) {
    const source = await readTextFileWithin(code.absolute, surveyCodeFileMaxBytes);
    if (source === undefined) {
      issues.push({ severity: "warning", path: [], file: code.file, message: `Larger than ${surveyCodeFileMaxBytes / 1024 / 1024} MB, so its comments were not read.` });
      continue;
    }
    source.split(/\r?\n/).forEach((line, index) => {
      const todo = todoIn(line);
      if (todo) allTodos.push({ file: code.file, line: index + 1, ...todo });
    });
  }
  const [todos, moreTodos] = capped(allTodos, surveyTodosMaxItems);
  checked.push("todos");

  notes.push(...issues.map(issue => `${issue.file ? `${issue.file}: ` : ""}${issue.message}`));
  return {
    checked,
    notes,
    ...(history ? { history } : {}),
    releases,
    ...(olderReleases ? { moreReleases: olderReleases } : {}),
    docs,
    ...(moreDocs ? { moreDocs } : {}),
    plans,
    ...(morePlans ? { morePlans } : {}),
    closedPlans,
    todos,
    ...(moreTodos ? { moreTodos } : {}),
  };
}
