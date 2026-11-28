import { readFile, realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { readPlanStatusLine, type PlanStatusWord } from "./plan-status.js";
import { markdownHeadings, maxMarkdownBytes, repositoryFiles, resolveRootedPath, type ReferenceIssue } from "./references.js";
import type { LoadedStoryMap } from "./schema.js";

/** The heading a plan's architecture decisions go under, as the engineering overview names it. */
export const planArchitectureHeading = "Architecture decisions";

/**
 * The placeholder hints a scaffolded `## Architecture decisions` section holds, one per question
 * in Record architecture decisions. `story-map plan` writes these, and the check reports a section
 * that still holds any of them, so the two must use the same text.
 */
export const planArchitectureHints = [
  "<!-- Where it runs: inside the existing package, CLI, board or CI workflow, or as its own service, worker or package. -->",
  "<!-- Data and contracts: who consumes it upstream and downstream, and what changes for each. -->",
  "<!-- Boundaries: which security boundaries it touches, and which it stays out of. -->",
  "<!-- Reversibility: how to undo it, including for hosts that have already upgraded. -->",
] as const;

/** The plan statuses that mean the work is still open, so its decisions still matter. */
const openStatuses: ReadonlySet<PlanStatusWord> = new Set(["proposed", "planned", "in progress"]);

/** `None:` as the routine answer starts, optionally in bold, and not the end of another word. */
const noneAnswer = /(?<![\p{L}\p{N}])None[*_]*\s*:/u;

/** A reason after `because`: at least one word. */
const becauseReason = /\bbecause\s+[*_]*[\p{L}\p{N}`]/iu;

/** What is wrong with a plan's architecture section, or undefined when it is fine. */
export type PlanArchitectureProblem =
  | { kind: "missing" }
  | { kind: "empty"; line: number }
  | { kind: "placeholder"; line: number }
  | { kind: "none-without-reason"; line: number };

/**
 * Reads the `## Architecture decisions` section of a plan, outside code fences, and returns
 * its problems: no section, an empty one, one that still holds a scaffold hint, or a `None:`
 * answer with no reason after `because`. Only the first section with the heading counts.
 */
export function planArchitectureProblems(markdown: string): PlanArchitectureProblem[] {
  const headings = markdownHeadings(markdown);
  const index = headings.findIndex(heading => heading.level === 2 && heading.text.trim().toLowerCase() === planArchitectureHeading.toLowerCase());
  if (index < 0) return [{ kind: "missing" }];
  const heading = headings[index]!;
  const next = headings.slice(index + 1).find(other => other.level <= heading.level);
  const lines = markdown.split(/\r?\n/);
  const end = next ? next.line - 1 : lines.length;
  const body = lines.slice(heading.line, end);
  const text = body.join("\n");

  if (planArchitectureHints.some(hint => text.includes(hint))) return [{ kind: "placeholder", line: heading.line }];
  if (!text.replace(/<!--[\s\S]*?-->/g, "").trim()) return [{ kind: "empty", line: heading.line }];

  const problems: PlanArchitectureProblem[] = [];
  let fence: string | undefined;
  body.forEach((line, offset) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      return;
    }
    if (fence) return;
    const none = noneAnswer.exec(line.replace(/`[^`]*`/g, code => " ".repeat(code.length)));
    if (none && !becauseReason.test(line.slice(none.index))) problems.push({ kind: "none-without-reason", line: heading.line + 1 + offset });
  });
  return problems;
}

const messages: Record<PlanArchitectureProblem["kind"], string> = {
  missing: `This open plan has no \`## ${planArchitectureHeading}\` section. Add one that says where the work runs, who consumes it, which boundaries it touches and how to undo it.`,
  empty: `The \`## ${planArchitectureHeading}\` section is empty. Answer where the work runs, who consumes it, which boundaries it touches and how to undo it.`,
  placeholder: `The \`## ${planArchitectureHeading}\` section still holds the scaffold's hints. Replace each hint with the plan's answer.`,
  "none-without-reason": "This `None:` answer gives no reason. Say why the work keeps the existing design, such as \"None: keeps the existing design because it adds a flag to an existing command.\"",
};

/**
 * Checks the `## Architecture decisions` section of each open Markdown plan under `planPaths`:
 * one whose status line starts with proposed, planned or in progress. Plans with no status line,
 * and finished, blocked or cut plans, are skipped. Each problem is a notice, or a warning once the
 * map sets `settings.architectureDecisions: required`. Like the other plan checks, it runs only on
 * the paths given, which `--check-sources` adds to only when `settings.plans` names a folder.
 * Paths that hold no plans are reported by `checkPlanReferences`, not here.
 */
export async function checkPlanArchitecture(loaded: LoadedStoryMap, root: string, planPaths: readonly string[]): Promise<ReferenceIssue[]> {
  const severity = loaded.map.settings?.architectureDecisions === "required" ? "warning" : "notice";
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
      if (!status?.word || !openStatuses.has(status.word)) continue;
      const plan = relative(realRoot, file).split(sep).join("/");
      for (const problem of planArchitectureProblems(text)) {
        issues.push({
          severity,
          rule: "plan-architecture-section",
          path: [],
          file: plan,
          line: problem.kind === "missing" ? status.line : problem.line,
          column: 1,
          message: messages[problem.kind],
        });
      }
    }
  }
  return issues;
}
