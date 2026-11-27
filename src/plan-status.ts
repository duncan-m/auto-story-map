import { readFile, realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { maxMarkdownBytes, repositoryFiles, resolveRootedPath, storyIdPattern, type ReferenceIssue } from "./references.js";
import type { LoadedStoryMap } from "./schema.js";
import type { StoryStatus } from "./status.js";

/**
 * The words a plan's status line may start with: the map's statuses, as the board writes
 * them, and `proposed` for a plan that is not agreed yet.
 */
export const planStatusWords = ["proposed", "planned", "in progress", "merged", "shipped", "blocked", "cut"] as const;

/** A word a plan's status line may start with, such as `in progress`. */
export type PlanStatusWord = (typeof planStatusWords)[number];

/** How far each status has gone, for telling when a line is behind its stories. Blocked and cut have no place. */
const progress: Partial<Record<PlanStatusWord, number>> = { proposed: 0, planned: 0, "in progress": 1, merged: 2, shipped: 3 };

const wordOf: Record<StoryStatus, PlanStatusWord> = {
  planned: "planned", "in-progress": "in progress", merged: "merged", shipped: "shipped", blocked: "blocked", cut: "cut",
};

/**
 * The word a plan's status line should start with, given the statuses of the stories it names,
 * when `word` is behind them: behind every story, or `proposed` once any has shipped. Returns
 * undefined when `word` is current or ahead, or names no story that has a place in the order.
 */
export function caughtUpStatus(word: PlanStatusWord, statuses: readonly StoryStatus[]): PlanStatusWord | undefined {
  const line = progress[word];
  const counted = statuses.filter(status => progress[wordOf[status]] !== undefined);
  if (line === undefined || !counted.length) return undefined;
  const reached = Math.min(...counted.map(status => progress[wordOf[status]]!));
  if (reached > line) return wordOf[counted.find(status => progress[wordOf[status]] === reached)!];
  return word === "proposed" && counted.includes("shipped") ? "in progress" : undefined;
}

/** A status line: `Status:` at the start of a line, optionally in bold, as `story-map survey` reads it. */
const statusLine = /^[*_]*status[*_]*\s*:[*_]*\s*(.*)$/i;

/** The first word of a line, when it is one of `planStatusWords` and ends the first clause. */
const leadingWord = new RegExp(`^(${planStatusWords.map(word => word.replace(" ", "[ -]")).join("|")})(?=[.,;:]|\\s*$)`, "i");

/** A plan's status line, as `checkPlanStatusLines` reads it. */
export interface PlanStatusLine {
  /** 1-based line in the file. */
  line: number;
  /** The text after `Status:`. */
  text: string;
  /** The status the line starts with, or undefined when it starts with other words. */
  word?: PlanStatusWord;
  /** Story IDs the line names that are in the map, with ranges such as `ESM-162 to ESM-165` expanded. */
  stories: string[];
  /** Text in bold, such as a release title. */
  bold: string[];
}

/**
 * Reads the first `Status:` line of a plan, outside fenced code. Returns undefined when the plan
 * has none, so notes and retros in the plans folder are left alone.
 */
export function readPlanStatusLine(loaded: LoadedStoryMap, markdown: string): PlanStatusLine | undefined {
  let fence: string | undefined;
  const lines = markdown.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (fence) continue;
    const match = statusLine.exec(line);
    if (!match) continue;
    const text = match[1]!.trim();
    const word = leadingWord.exec(text)?.[1]?.toLowerCase().replace("-", " ") as PlanStatusWord | undefined;
    return { line: index + 1, text, ...(word ? { word } : {}), stories: namedStories(loaded, text), bold: [...text.matchAll(/\*\*([^*]+)\*\*/g)].map(bold => bold[1]!.trim()) };
  }
  return undefined;
}

/** The map's story IDs a line names, in order, with `A to B` and `A–B` ranges expanded to the IDs between. */
function namedStories(loaded: LoadedStoryMap, text: string): string[] {
  const pattern = storyIdPattern(loaded);
  if (!pattern) return [];
  const ids = new Set(loaded.map.stories.map(story => story.id));
  const named = new Set<string>();
  const matches = [...text.matchAll(pattern)];
  matches.forEach((match, index) => {
    named.add(match[0]);
    const next = matches[index + 1];
    if (!next) return;
    const between = text.slice(match.index + match[0].length, next.index);
    if (!/^(?:\s+to\s+|\s*[–—]\s*)$/.test(between)) return;
    const [prefix, from] = split(match[0]);
    const [nextPrefix, to] = split(next[0]);
    if (prefix !== nextPrefix || to <= from) return;
    for (const id of ids) {
      const [storyPrefix, number] = split(id);
      if (storyPrefix === prefix && number > from && number < to) named.add(id);
    }
  });
  return [...named].filter(id => ids.has(id));
}

function split(id: string): [string, number] {
  const at = id.lastIndexOf("-");
  return [id.slice(0, at), Number(id.slice(at + 1))];
}

/**
 * Checks the status line of each Markdown file under `planPaths` against the map, and warns when
 * it starts with words other than the map's statuses, is behind every story it names, or names in
 * bold a release title the map no longer has. A line that names none of the map's stories is
 * only checked for its words. Files without a status line are skipped. Paths that
 * cannot be read are left to `checkPlanReferences`, which reports them.
 */
export async function checkPlanStatusLines(loaded: LoadedStoryMap, root: string, planPaths: string[]): Promise<ReferenceIssue[]> {
  const realRoot = await realpath(root);
  const read = new Set<string>();
  const issues: ReferenceIssue[] = [];
  for (const planPath of planPaths) {
    const resolved = await resolveRootedPath(root, realRoot, planPath);
    if (resolved.kind !== "inside") continue;
    const files = await repositoryFiles(realRoot, resolved.path, { include: (_, name) => /\.(?:md|markdown)$/i.test(name) }, []);
    for (const file of files) {
      if (read.has(file)) continue;
      read.add(file);
      const text = await readFile(file, "utf8");
      if (text.length > maxMarkdownBytes) continue;
      const status = readPlanStatusLine(loaded, text);
      if (status) issues.push(...statusLineIssues(loaded, relative(realRoot, file).split(sep).join("/"), status));
    }
  }
  return issues;
}

/** The problems with one plan's status line. */
export function statusLineIssues(loaded: LoadedStoryMap, file: string, status: PlanStatusLine): ReferenceIssue[] {
  const at = { severity: "warning" as const, path: [], file, line: status.line };
  const issues: ReferenceIssue[] = [];
  const stories = status.stories.map(id => loaded.map.stories.find(story => story.id === id)!);

  if (!status.word) {
    issues.push({
      ...at,
      rule: "plan-status-words",
      message: `The status line starts with words other than the map's statuses. Start it with ${listOr(planStatusWords.map(word => `'${word}'`))}, followed by a full stop, and keep any notes after it.`,
    });
  } else {
    const counted = stories.filter(story => progress[wordOf[story.status]] !== undefined);
    const suggested = caughtUpStatus(status.word, counted.map(story => story.status));
    if (suggested) {
      const byWord = new Map<PlanStatusWord, string[]>();
      for (const story of counted) byWord.set(wordOf[story.status], [...byWord.get(wordOf[story.status]) ?? [], story.id]);
      const said = [...byWord].map(([word, ids]) => `${listAnd(ids)} ${ids.length === 1 ? "is" : "are"} ${word}`);
      issues.push({
        ...at,
        rule: "plan-status-behind",
        message: `The status line says '${status.word}', but in the map ${listAnd(said)}. Start the line with '${suggested}'.`,
      });
    }
  }

  const titles = new Set(loaded.map.releases.map(release => release.title));
  const holding = [...new Set(stories.map(story => story.release))]
    .map(id => loaded.map.releases.find(release => release.id === id)?.title)
    .filter((title): title is string => !!title && !status.bold.includes(title));
  // Without a story from this map, the line may be about another map, such as the guide's example.
  for (const bold of stories.length ? status.bold : []) {
    if (titles.has(bold) || !looksLikeRelease(status.text, bold)) continue;
    issues.push({
      ...at,
      rule: "plan-status-release",
      message: `The status line names the release '${bold}', which the map no longer has. ${holding.length ? `Use the title of the release that holds its stories: ${listOr(holding.map(title => `'${title}'`))}.` : "Use a release title from the map."}`,
    });
  }
  return issues;
}

/** Bold text names a release when it starts with a version, such as 0.7.7, or the word "release" is next to it. */
function looksLikeRelease(text: string, bold: string): boolean {
  if (/^v?\d+\.\d+/.test(bold)) return true;
  const at = text.indexOf(`**${bold}**`);
  return /\breleases?\s*$/i.test(text.slice(0, at)) || /^\s*releases?\b/i.test(text.slice(at + bold.length + 4));
}

const listAnd = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const listOr = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
