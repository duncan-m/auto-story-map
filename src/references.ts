import { lstat, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LoadedStoryMap, StoryMapIssue } from "./schema.js";

/** An issue found outside the map itself, such as in a delivery plan. */
export interface ReferenceIssue extends StoryMapIssue {
  /** File the issue is in, relative to the repository root. Omitted for the map. */
  file?: string;
}

const markdownExtensions = new Set([".md", ".markdown"]);

/** Largest Markdown file read for heading anchors, so source checks stay quick. */
export const maxMarkdownBytes = 5 * 1024 * 1024;

/**
 * Removes every `open … close` span with a nonempty body and keeps what
 * `keep` returns for it. Each character is visited a bounded number of times,
 * so text with many unclosed openers stays linear (a regex would rescan the
 * rest of the text from every opener).
 */
function replaceSpans(text: string, open: string, close: string, keep: (body: string) => string, allowEmpty = false) {
  let out = "";
  let from = 0;
  let closeAt = -1;
  for (let i = text.indexOf(open); i !== -1; i = text.indexOf(open, i + 1)) {
    if (i < from) continue;
    if (closeAt <= i) closeAt = text.indexOf(close, i + 1);
    if (closeAt === -1) break;
    if (closeAt === i + 1 && !allowEmpty) continue;
    out += text.slice(from, i) + keep(text.slice(i + 1, closeAt));
    from = closeAt + 1;
    i = closeAt;
  }
  return out + text.slice(from);
}

/** Replaces `[text](url)` and `![text](url)` with their text, in linear time. */
function stripLinks(text: string) {
  let out = "";
  let from = 0;
  let bracketAt = -1;
  let parenAt = -1;
  for (let i = text.indexOf("["); i !== -1; i = text.indexOf("[", i + 1)) {
    if (i < from) continue;
    if (bracketAt <= i) bracketAt = text.indexOf("]", i + 1);
    if (bracketAt === -1) break;
    if (text[bracketAt + 1] !== "(") continue;
    if (parenAt <= bracketAt + 1) parenAt = text.indexOf(")", bracketAt + 2);
    if (parenAt === -1) break;
    const start = i > from && text[i - 1] === "!" ? i - 1 : i;
    out += text.slice(from, start) + text.slice(i + 1, bracketAt);
    from = parenAt + 1;
    i = parenAt;
  }
  return out + text.slice(from);
}

/** Strips inline Markdown so heading text matches what GitHub renders. */
function headingText(raw: string) {
  const withoutTags = replaceSpans(raw, "<", ">", () => "");
  return replaceSpans(stripLinks(withoutTags), "`", "`", body => body, true).trim();
}

const isSpace = (char: string) => /\s/.test(char);

/** Returns an ATX heading's text without its opening and closing `#`s, or undefined. */
function atxHeading(line: string) {
  const opening = /^\s{0,3}#{1,6}\s+/.exec(line);
  if (!opening) return undefined;
  const text = line.slice(opening[0].length).trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end === text.length || end === 0 || !isSpace(text[end - 1])) return text;
  while (end > 0 && isSpace(text[end - 1])) end--;
  return text.slice(0, end);
}

/**
 * Returns the `id` and `name` values of each `<a …>` tag in a line. A tag runs
 * to the next `>`, so a quoted `<` inside it does not end it. Openers inside a
 * tag already read share its end, so each character is read once.
 */
function htmlAnchors(line: string) {
  const ids: string[] = [];
  const opener = /<a\s/gi;
  for (let match = opener.exec(line); match; match = opener.exec(line)) {
    const close = line.indexOf(">", match.index);
    const tag = line.slice(match.index, close === -1 ? line.length : close);
    for (const attribute of tag.matchAll(/\b(?:id|name)=["']([^"']+)["']/gi)) ids.push(attribute[1].toLowerCase());
    if (close === -1) break;
    opener.lastIndex = close + 1;
  }
  return ids;
}

/** GitHub’s heading anchor rules: lower case, drop punctuation, spaces become hyphens. */
export function slugify(heading: string) {
  return headingText(heading).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
}

/** Returns every anchor a Markdown file defines: heading slugs (with GitHub’s -1, -2 suffixes) and HTML ids. */
export function markdownAnchors(markdown: string) {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  const addHeading = (raw: string) => {
    const base = slugify(raw);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  };

  let fence: string | undefined;
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, index) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = undefined;
      return;
    }
    if (fence) return;

    const atx = atxHeading(line);
    if (atx !== undefined) addHeading(atx);
    else if (index > 0 && /^\s{0,3}(=+|-+)\s*$/.test(line) && lines[index - 1].trim() && !/^\s*([-*+]|\d+\.)\s/.test(lines[index - 1])) {
      addHeading(lines[index - 1]);
    }
    for (const id of htmlAnchors(line)) anchors.add(id);
  });
  return anchors;
}

function looksLikePath(source: string) {
  return !/\s/.test(source) && !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith("//");
}

export async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

const insideRoot = (root: string, path: string) => {
  const fromRoot = relative(root, path);
  return !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
};

type Resolved = { kind: "inside"; path: string } | { kind: "missing" } | { kind: "outside" };

/** Most symbolic links followed for one path, so a loop of links ends. */
const maxLinks = 40;

/**
 * Resolves a path inside `realRoot` one component at a time, following
 * symbolic links only while they stay inside it. It never looks at anything
 * outside the repository, so a link cannot reveal whether a file outside
 * exists. The result is made only of real directories and files inside the
 * root, so it is safe to read.
 */
async function resolveInRepository(realRoot: string, path: string): Promise<Resolved> {
  const lexical = resolve(realRoot, path);
  if (!insideRoot(realRoot, lexical)) return { kind: "outside" };
  let current = realRoot;
  let segments = relative(realRoot, lexical).split(sep).filter(Boolean);
  let links = 0;
  while (segments.length) {
    const next = join(current, segments.shift()!);
    const info = await lstat(next).catch(() => null);
    if (!info) return { kind: "missing" };
    if (!info.isSymbolicLink()) {
      current = next;
      continue;
    }
    if (++links > maxLinks) return { kind: "missing" };
    const target = resolve(current, await readlink(next));
    if (!insideRoot(realRoot, target)) return { kind: "outside" };
    // Walk the link's target from the root, so links within it are checked too.
    segments = [...relative(realRoot, target).split(sep).filter(Boolean), ...segments];
    current = realRoot;
  }
  return { kind: "inside", path: current };
}

/**
 * Checks that repository-relative sources exist and that Markdown heading
 * fragments match a heading. Absolute URLs and free text are not checked.
 */
export async function checkSources(loaded: LoadedStoryMap, root: string): Promise<ReferenceIssue[]> {
  const issues: ReferenceIssue[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const realRoot = await realpath(root);

  for (const [storyIndex, story] of loaded.map.stories.entries()) {
    for (const [sourceIndex, source] of (story.sources ?? []).entries()) {
      if (!looksLikePath(source)) continue;
      const path = ["stories", storyIndex, "sources", sourceIndex];
      const report = (message: string) => issues.push({ severity: "error", path, message, itemId: story.id, ...loaded.locate(path) });

      const [rawFile, rawFragment] = source.split("#", 2);
      let file: string;
      let fragment: string | undefined;
      try {
        file = decodeURIComponent(rawFile).replace(/^\.?\//, "");
        fragment = rawFragment === undefined ? undefined : decodeURIComponent(rawFragment);
      } catch {
        report(`Source '${source}' is not a valid path.`);
        continue;
      }
      if (!file) continue;

      if (!insideRoot(root, resolve(root, file))) {
        report(`Source '${source}' points outside the repository.`);
        continue;
      }
      const resolved = await resolveInRepository(realRoot, file);
      if (resolved.kind === "outside") {
        report(`Source '${source}' points outside the repository through a symbolic link.`);
        continue;
      }
      const absolute = resolved.kind === "inside" ? resolved.path : undefined;
      const info = absolute && await statOrNull(absolute);
      if (!absolute || !info) {
        report(`Source file '${file}' does not exist.`);
        continue;
      }
      if (!fragment || !info.isFile() || !markdownExtensions.has(extname(file).toLowerCase())) continue;

      let anchors = anchorCache.get(absolute);
      if (!anchors && info.size > maxMarkdownBytes) {
        report(`'${file}' is larger than ${maxMarkdownBytes / 1024 / 1024} MB, so '#${fragment}' was not checked.`);
        continue;
      }
      if (!anchors) {
        anchors = markdownAnchors(await readFile(absolute, "utf8"));
        anchorCache.set(absolute, anchors);
      }
      if (!anchors.has(fragment.toLowerCase())) report(`'${file}' has no heading for '#${fragment}'.`);
    }
  }
  return issues;
}

/** Which files a walk lists, and which folders it skips. */
export interface FileFilter {
  /** Whether to list a file, given its path relative to the root and its name. */
  include(path: string, name: string): boolean;
  /** Whether to skip a folder, given its name. Dot folders and node_modules are always skipped. */
  skipFolder?(name: string): boolean;
}

/**
 * Lists the files under a real path inside the root that `filter` includes. A
 * path that names a file is listed whatever its name. Symbolic links are
 * followed only while they stay inside the root, and each is reported in
 * `outside` otherwise. Each directory is listed once, so a loop of links ends.
 */
export async function repositoryFiles(realRoot: string, path: string, filter: FileFilter, outside: string[], seen = new Set<string>()): Promise<string[]> {
  const info = await statOrNull(path);
  if (!info) return [];
  if (info.isFile()) return [path];
  if (seen.has(path)) return [];
  seen.add(path);
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    let child = join(path, entry.name);
    let kind: "file" | "directory" | undefined = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : undefined;
    if (entry.isSymbolicLink()) {
      const resolved = await resolveInRepository(realRoot, relative(realRoot, child));
      if (resolved.kind === "outside") outside.push(child);
      if (resolved.kind !== "inside") continue;
      child = resolved.path;
      const target = await statOrNull(child);
      kind = target?.isDirectory() ? "directory" : target?.isFile() ? "file" : undefined;
    }
    if (kind === "directory") {
      if (!filter.skipFolder?.(entry.name)) files.push(...await repositoryFiles(realRoot, child, filter, outside, seen));
    } else if (kind === "file" && filter.include(relative(realRoot, child).split(sep).join("/"), entry.name)) {
      files.push(child);
    }
  }
  return [...new Set(files)].sort();
}

const markdownFilter: FileFilter = { include: (_, name) => markdownExtensions.has(extname(name).toLowerCase()) };

/** The map's story ID prefixes, such as BUILDER in BUILDER-102, escaped for a regular expression. */
function storyIdPrefixes(loaded: Pick<LoadedStoryMap, "map">): string | undefined {
  const prefixes = new Set(loaded.map.stories.flatMap(story => /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(story.id)?.[1] ?? []));
  if (!prefixes.size) return undefined;
  return `(?:${[...prefixes].map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
}

/**
 * Matches story IDs that use a prefix already in the map, such as BUILDER- in
 * BUILDER-102, as whole words, so text like UTF-8 or BUILDER-1x is ignored.
 * Returns undefined when no story ID has a prefix.
 */
export function storyIdPattern(loaded: Pick<LoadedStoryMap, "map">): RegExp | undefined {
  const prefixes = storyIdPrefixes(loaded);
  return prefixes ? new RegExp(`(?<![A-Za-z0-9_-])${prefixes}-\\d+(?![A-Za-z0-9_-])`, "g") : undefined;
}

/**
 * Matches story IDs in Git branch names, such as ESM-105 in
 * `feat/esm-105-look-up-evidence`. Branch names are usually lower case and
 * carry words after the ID, so this ignores case and allows a hyphen after
 * the number. A longer number or a letter after it still does not match, so
 * ESM-10 is never found in ESM-105. Returns undefined when no story ID has a prefix.
 */
export function branchIdPattern(loaded: Pick<LoadedStoryMap, "map">): RegExp | undefined {
  const prefixes = storyIdPrefixes(loaded);
  return prefixes ? new RegExp(`(?<![A-Za-z0-9])${prefixes}-\\d+(?![A-Za-z0-9_])`, "gi") : undefined;
}

/** The outcome of checking that a path passed on the command line stays inside the root. */
export type RootedPath = { kind: "inside"; path: string } | { kind: "missing" } | { kind: "issue"; issue: ReferenceIssue };

/** Resolves a command-line path against the root, reporting one that leaves it directly or through a symbolic link. */
export async function resolveRootedPath(root: string, realRoot: string, path: string): Promise<RootedPath> {
  if (!insideRoot(root, resolve(root, path))) {
    return { kind: "issue", issue: { severity: "error", path: [], file: path, message: "Points outside the repository." } };
  }
  const resolved = await resolveInRepository(realRoot, relative(root, resolve(root, path)));
  if (resolved.kind === "outside") {
    return { kind: "issue", issue: { severity: "error", path: [], file: path, message: "Points outside the repository through a symbolic link." } };
  }
  return resolved;
}

/** The issue for a file that a walk skipped because a symbolic link leads out of the repository. */
export const outsideLinkIssue = (file: string): ReferenceIssue =>
  ({ severity: "error", path: [], file, message: "Points outside the repository through a symbolic link, so it was not read." });

/** A story ID mentioned in a Markdown file. */
export interface StoryMention {
  id: string;
  /** Path relative to the repository root, with `/` separators. */
  file: string;
  line: number;
  column: number;
  /** The whole line, as written. */
  text: string;
}

/**
 * Lists the story IDs mentioned in Markdown files under `paths`, whether or
 * not they are in the map, with paths that could not be read in `issues`. Only
 * IDs that use a prefix already in the map are found (see `storyIdPattern`).
 */
export async function findStoryMentions(loaded: LoadedStoryMap, root: string, paths: string[]): Promise<{ mentions: StoryMention[]; issues: ReferenceIssue[] }> {
  const pattern = storyIdPattern(loaded);
  const mentions: StoryMention[] = [];
  const issues: ReferenceIssue[] = [];
  if (!pattern) return { mentions, issues };

  const realRoot = await realpath(root);
  const shown = (file: string) => relative(realRoot, file).split(sep).join("/");
  const read = new Set<string>();

  for (const planPath of paths) {
    const resolved = await resolveRootedPath(root, realRoot, planPath);
    if (resolved.kind === "issue") {
      issues.push(resolved.issue);
      continue;
    }
    const outside: string[] = [];
    const files = resolved.kind === "inside" ? await repositoryFiles(realRoot, resolved.path, markdownFilter, outside) : [];
    for (const link of outside) issues.push(outsideLinkIssue(shown(link)));
    if (!files.length) {
      issues.push({ severity: "error", path: [], file: planPath, message: "No Markdown files found." });
      continue;
    }
    for (const file of files) {
      if (read.has(file)) continue;
      read.add(file);
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((text, index) => {
        for (const match of text.matchAll(pattern)) {
          mentions.push({ id: match[0], file: shown(file), line: index + 1, column: match.index + 1, text });
        }
      });
    }
  }
  return { mentions, issues };
}

/**
 * Finds story IDs mentioned in delivery plans that are not in the map. Only IDs
 * that use a prefix already in the map are checked (see `storyIdPattern`).
 */
export async function checkPlanReferences(loaded: LoadedStoryMap, root: string, planPaths: string[]): Promise<ReferenceIssue[]> {
  const ids = new Set(loaded.map.stories.map(story => story.id));
  const issues: ReferenceIssue[] = [];
  // One path at a time, so each path's problems come in the order the paths were given.
  for (const planPath of planPaths) {
    const found = await findStoryMentions(loaded, root, [planPath]);
    issues.push(...found.issues);
    for (const mention of found.mentions) {
      if (ids.has(mention.id)) continue;
      issues.push({
        severity: "error",
        path: [],
        file: mention.file,
        line: mention.line,
        column: mention.column,
        message: `Unknown story ID '${mention.id}'. Add it to the map or correct the reference.`,
      });
    }
  }
  return issues;
}
