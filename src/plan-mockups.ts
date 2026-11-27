import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { markdownHeadings, repositoryFiles, resolveRootedPath, statOrNull, type ReferenceIssue } from "./references.js";
import type { StoryMapRuleId } from "./rules.js";
import type { LoadedStoryMap } from "./schema.js";

/** The heading a plan's mockup goes under, as `docs/story-map.md` names it. */
const mockupHeading = /^ui mockup$/i;

const markdownExtensions = new Set([".md", ".markdown"]);

/** A link or image in a mockup section, with where it is in the plan. */
interface SectionLink {
  target: string;
  image: boolean;
  line: number;
  column: number;
}

/** Finds `[text](target)`, `![alt](target)` and `<img src="target">` in a line, outside inline code. */
function linksIn(text: string, line: number): SectionLink[] {
  const code = text.replace(/`[^`]*`/g, match => " ".repeat(match.length));
  const links: SectionLink[] = [];
  for (const match of code.matchAll(/(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    links.push({ target: match[2], image: match[1] === "!", line, column: match.index + 1 });
  }
  for (const match of code.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    links.push({ target: match[1], image: true, line, column: match.index + 1 });
  }
  return links;
}

/** A link's file, relative to the plan, without its query or fragment, or undefined for a URL or a fragment alone. */
function linkedFile(target: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return undefined;
  const file = target.split(/[?#]/, 1)[0];
  if (!file) return undefined;
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
}

/** A plan's `## UI mockup` section: its anchor, heading line and the lines under it. */
interface MockupSection {
  anchor: string;
  line: number;
  links: SectionLink[];
}

/** Finds each UI mockup section in a plan, skipping code fences, up to the next heading at its level or above. */
function mockupSections(markdown: string): MockupSection[] {
  const headings = markdownHeadings(markdown);
  const lines = markdown.split(/\r?\n/);
  const sections: MockupSection[] = [];
  headings.forEach((heading, index) => {
    if (!mockupHeading.test(heading.text)) return;
    const next = headings.slice(index + 1).find(other => other.level <= heading.level);
    const end = next ? next.line - 1 : lines.length;
    const links: SectionLink[] = [];
    let fence: string | undefined;
    for (let number = heading.line + 1; number <= end; number++) {
      const text = lines[number - 1];
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
      if (fenceMatch) {
        if (!fence) fence = fenceMatch[1][0];
        else if (fenceMatch[1][0] === fence) fence = undefined;
        continue;
      }
      if (!fence) links.push(...linksIn(text, number));
    }
    sections.push({ anchor: heading.anchor, line: heading.line, links });
  });
  return sections;
}

/** The repository-relative `file#anchor` sources the map's stories list, lower-cased. */
function storySources(loaded: LoadedStoryMap) {
  const sources = new Set<string>();
  for (const story of loaded.map.stories) {
    for (const source of story.sources ?? []) {
      const [rawFile, fragment] = source.split("#", 2);
      if (fragment === undefined) continue;
      try {
        sources.add(`${decodeURIComponent(rawFile).replace(/^\.?\//, "")}#${decodeURIComponent(fragment)}`.toLowerCase());
      } catch {
        // checkSources reports a source that is not a valid path.
      }
    }
  }
  return sources;
}

/**
 * Checks the `## UI mockup` section of each Markdown plan under `planPaths`:
 * that it links an HTML mockup and embeds a PNG of it, that both files exist,
 * and that a story lists the section in its `sources`. A section with no links
 * or images at all says there is no mockup, so it is not checked. Paths that
 * hold no plans are reported by `checkPlanReferences`, not here.
 */
export async function checkPlanMockups(loaded: LoadedStoryMap, root: string, planPaths: readonly string[]): Promise<ReferenceIssue[]> {
  const issues: ReferenceIssue[] = [];
  const realRoot = await realpath(root);
  const shown = (file: string) => relative(realRoot, file).split(sep).join("/");
  const sources = storySources(loaded);
  const read = new Set<string>();

  for (const planPath of planPaths) {
    const resolved = await resolveRootedPath(root, realRoot, planPath);
    if (resolved.kind !== "inside") continue;
    const files = await repositoryFiles(realRoot, resolved.path, { include: (_, name) => markdownExtensions.has(extname(name).toLowerCase()) }, []);
    for (const file of files) {
      if (read.has(file)) continue;
      read.add(file);
      const plan = shown(file);
      for (const section of mockupSections(await readFile(file, "utf8"))) {
        if (!section.links.length) continue;
        const report = (message: string, rule: StoryMapRuleId, at: { line: number; column: number } = { line: section.line, column: 1 }) =>
          issues.push({ severity: "error", path: [], file: plan, line: at.line, column: at.column, message, rule });

        const linked = section.links.flatMap(link => {
          const target = linkedFile(link.target);
          return target ? [{ ...link, file: target, extension: extname(target).toLowerCase() }] : [];
        });
        const html = linked.filter(link => !link.image && (link.extension === ".html" || link.extension === ".htm"));
        const png = linked.filter(link => link.image && link.extension === ".png");
        if (!html.length) report("The UI mockup section links no HTML mockup. Link the mockup's .html file, kept next to the plan.", "mockup-without-html");
        if (!png.length) report("The UI mockup section embeds no PNG. Embed a .png of the mockup with ![what it shows](file.png).", "mockup-without-image");

        for (const link of [...html, ...png]) {
          const target = resolve(dirname(file), link.file);
          const fromRoot = relative(realRoot, target);
          const found = await resolveRootedPath(realRoot, realRoot, fromRoot);
          if (found.kind === "issue") {
            report(`Mockup file '${link.file}' is outside the repository. Keep the mockup next to the plan.`, "outside-repository", link);
            continue;
          }
          const info = found.kind === "inside" ? await statOrNull(found.path) : null;
          if (!info?.isFile()) report(`Mockup file '${link.file}' does not exist. Correct the link, or add the file.`, "missing-mockup-file", link);
        }

        if (!sources.has(`${plan}#${section.anchor}`.toLowerCase())) {
          report(`No story lists '${plan}#${section.anchor}' in its sources. Add it to the sources of each story the mockup shows, after the story's plan section.`, "unlinked-mockup");
        }
      }
    }
  }
  return issues;
}
