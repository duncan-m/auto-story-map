import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LoadedStoryMap, StoryMapIssue } from "./schema.js";

/** An issue found outside the map itself, such as in a delivery plan. */
export interface ReferenceIssue extends StoryMapIssue {
  /** File the issue is in, relative to the repository root. Omitted for the map. */
  file?: string;
}

const markdownExtensions = new Set([".md", ".markdown"]);

/** Strips inline Markdown so heading text matches what GitHub renders. */
function headingText(raw: string) {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
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

    const atx = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx) addHeading(atx[1]);
    else if (index > 0 && /^\s{0,3}(=+|-+)\s*$/.test(line) && lines[index - 1].trim() && !/^\s*([-*+]|\d+\.)\s/.test(lines[index - 1])) {
      addHeading(lines[index - 1]);
    }
    for (const match of line.matchAll(/<a\s[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) anchors.add(match[1].toLowerCase());
  });
  return anchors;
}

function looksLikePath(source: string) {
  return !/\s/.test(source) && !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith("//");
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * Checks that repository-relative sources exist and that Markdown heading
 * fragments match a heading. Absolute URLs and free text are not checked.
 */
export async function checkSources(loaded: LoadedStoryMap, root: string): Promise<ReferenceIssue[]> {
  const issues: ReferenceIssue[] = [];
  const anchorCache = new Map<string, Set<string>>();

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

      const absolute = resolve(root, file);
      const fromRoot = relative(root, absolute);
      if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
        report(`Source '${source}' points outside the repository.`);
        continue;
      }
      const info = await statOrNull(absolute);
      if (!info) {
        report(`Source file '${file}' does not exist.`);
        continue;
      }
      if (!fragment || !info.isFile() || !markdownExtensions.has(extname(file).toLowerCase())) continue;

      let anchors = anchorCache.get(absolute);
      if (!anchors) {
        anchors = markdownAnchors(await readFile(absolute, "utf8"));
        anchorCache.set(absolute, anchors);
      }
      if (!anchors.has(fragment.toLowerCase())) report(`'${file}' has no heading for '#${fragment}'.`);
    }
  }
  return issues;
}

async function markdownFiles(path: string): Promise<string[]> {
  const info = await statOrNull(path);
  if (!info) return [];
  if (info.isFile()) return [path];
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(child));
    else if (entry.isFile() && markdownExtensions.has(extname(entry.name).toLowerCase())) files.push(child);
  }
  return files.sort();
}

/**
 * Finds story IDs mentioned in delivery plans that are not in the map. Only IDs
 * that use a prefix already in the map, such as BUILDER- in BUILDER-102, are
 * checked, so text like UTF-8 is ignored.
 */
export async function checkPlanReferences(loaded: LoadedStoryMap, root: string, planPaths: string[]): Promise<ReferenceIssue[]> {
  const ids = new Set(loaded.map.stories.map(story => story.id));
  const prefixes = new Set(loaded.map.stories.flatMap(story => /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(story.id)?.[1] ?? []));
  const issues: ReferenceIssue[] = [];
  if (!prefixes.size) return issues;

  const escaped = [...prefixes].map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(?:${escaped.join("|")})-\\d+(?![A-Za-z0-9_-])`, "g");

  for (const planPath of planPaths) {
    const absolute = resolve(root, planPath);
    const files = await markdownFiles(absolute);
    if (!files.length) {
      issues.push({ severity: "error", path: [], file: planPath, message: "No Markdown files found." });
      continue;
    }
    for (const file of files) {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const match of line.matchAll(pattern)) {
          if (ids.has(match[0])) continue;
          issues.push({
            severity: "error",
            path: [],
            file: relative(root, file).split(sep).join("/"),
            line: index + 1,
            column: match.index + 1,
            message: `Unknown story ID '${match[0]}'. Add it to the map or correct the reference.`,
          });
        }
      });
    }
  }
  return issues;
}
