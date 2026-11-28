import { needsPersonLabels, type StoryMapDiff } from "./diff.js";
import type { NeedsPersonChange } from "./needs-person.js";
import { becauseReason, noneAnswer } from "./plan-architecture.js";
import { escapeRegExp } from "./references.js";
import type { StoryMapRuleId } from "./rules.js";
import type { StoryMapDocument, StoryMapIssue } from "./schema.js";
import { present } from "./present.js";

/** The rules only `pr-check` reports, beside the ones `story-map diff` lists under Needs a person. */
export const prCheckRules = ["missing-tokens-used", "missing-review", "missing-architecture"] as const satisfies readonly StoryMapRuleId[];

/**
 * Names in a commit's author or `Co-Authored-By` trailers that mark it as
 * written with a coding agent. Matched as whole words, ignoring case.
 */
export const knownAgentNames = ["Claude", "Codex", "Copilot", "Cursor", "Devin", "Gemini", "Aider", "Jules", "OpenHands"] as const;

/** One commit in the pull request that changes the map. */
export interface PrCheckCommit {
  sha: string;
  /** The author's name. */
  author: string;
  /** The author's email, when known. */
  email?: string;
  /** The whole commit message, for its trailers. */
  message: string;
}

export interface PrCheckOptions {
  /** The comparison of the base map with the pull request's, from `diffStoryMaps`. */
  diff: StoryMapDiff;
  /** The pull request's map, to locate each problem. */
  after: StoryMapDocument;
  /** The non-merge commits in the pull request that change the map. */
  commits: readonly PrCheckCommit[];
  /** Commit authors that are bots, as for `story-map history --bot-names`. Authors ending in `[bot]` always are. */
  botNames?: readonly string[];
  /** True when a person approved the changes that need a person, such as with the `map-approved` label. */
  approved?: boolean;
  /** The pull request's description. When absent, the Tokens used and Review sections are not checked. */
  body?: string;
  /**
   * Whether the pull request is a draft. A pull request known to be ready for
   * review, with `draft: false` and a body, needs a Review section that records
   * a review, and, when the map sets `settings.architectureDecisions: required`,
   * an Architecture line. When absent, neither is checked.
   */
  draft?: boolean;
  /** Fail on warnings too, as `validate --strict` does. */
  strict?: boolean;
}

/** Why a commit counts as an agent's: its author is a bot, or a trailer names an agent. */
export interface PrCheckAgentCommit {
  sha: string;
  /** The bot author or the agent the trailer names, such as `Claude`. */
  agent: string;
}

/** One problem `pr-check` found. `line` and `column` locate it in the map when they can. */
export interface PrCheckIssue extends Pick<StoryMapIssue, "severity" | "path" | "message" | "rule" | "itemId"> {}

export interface PrCheckResult {
  /** False when any issue is an error. */
  passed: boolean;
  /** Commits in the pull request that change the map and were written with an agent. */
  agentCommits: PrCheckAgentCommit[];
  /** The changes that need a person, whether or not they fail the check. */
  needsPerson: NeedsPersonChange[];
  /** True when changes that need a person were let through because a person approved them. */
  approved: boolean;
  /** Stories this pull request marks merged. */
  merged: string[];
  /** Whether the body was checked for a Tokens used section. */
  checkedBody: boolean;
  /** Whether the body was checked for a Review section, because the pull request is ready for review. */
  checkedReview: boolean;
  /** Whether the body was checked for an Architecture line, because the pull request is ready and the map requires architecture decisions. */
  checkedArchitecture: boolean;
  issues: PrCheckIssue[];
}

const agentPattern = new RegExp(`\\b(${knownAgentNames.map(escapeRegExp).join("|")})\\b`, "i");

/**
 * Says which agent wrote a commit, or undefined when it looks like a person's.
 * A commit is an agent's when its author is a bot or a `Co-Authored-By`
 * trailer names a known agent. The author's own name is not matched against
 * agent names, so a person called Jules is not mistaken for one.
 */
export function commitAgent(commit: PrCheckCommit, botNames: readonly string[] = []): string | undefined {
  const bots = new Set(botNames.map(name => name.trim().toLowerCase()).filter(Boolean));
  const author = commit.author.trim();
  if (author.toLowerCase().endsWith("[bot]") || bots.has(author.toLowerCase())) return author;
  // Read the trailers line by line rather than with a regex, so a long line cannot make matching slow.
  const trailer = "co-authored-by:";
  for (const line of commit.message.split(/\r?\n/)) {
    if (line.slice(0, trailer.length).toLowerCase() !== trailer) continue;
    const agent = agentPattern.exec(line.slice(trailer.length));
    if (agent) return knownAgentNames.find(name => name.toLowerCase() === agent[1].toLowerCase()) ?? agent[1];
  }
  return undefined;
}

/**
 * The text of the body's “Tokens used” section, without HTML comments, up to
 * the next heading of the same or a higher level. Undefined when there is no
 * such heading.
 */
export function tokensUsedSection(body: string): string | undefined {
  return descriptionSection(body, /^ {0,3}#{1,6}[ \t]+tokens used[ \t#]*$/i);
}

/**
 * The text of the body's “Review” section, without HTML comments, the
 * template's empty labels, such as `- Target:` with nothing after it, and
 * labels with only a placeholder, such as `- Target: pending`, up to
 * the next heading of the same or a higher level. An empty string means the
 * template was left as it was. Undefined when there is no such heading.
 */
export function reviewSection(body: string): string | undefined {
  const section = descriptionSection(body, /^ {0,3}#{1,6}[ \t]+review[ \t#]*$/i);
  if (section === undefined) return undefined;
  // A list item or line that is only a label, such as `- **Level:**`, or a label with a
  // placeholder such as `- Target: pending`, records nothing.
  const placeholder = /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*|__)?[^:*_\n]{1,40}:(?:\*\*|__)?[ \t]*(?:pending|tbd|todo|to do|none yet)?[ \t.]*$/i;
  return section.split("\n").filter(line => !placeholder.test(line)).join("\n").trim();
}

function descriptionSection(body: string, heading: RegExp): string | undefined {
  const lines = body.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?(-->|$)/g, "").split("\n");
  const start = lines.findIndex(line => heading.test(line));
  if (start === -1) return undefined;
  // Each heading pattern matches a Markdown heading, so the line starts with #.
  const level = present(/^ *(#+)/.exec(lines[start]), "the level of a description heading")[1].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => {
    const heading = /^ {0,3}(#{1,6})[ \t]/.exec(line);
    return heading !== null && heading[1].length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** What is wrong with a description's Architecture line, or undefined when it answers. */
export type ArchitectureLineProblem = "missing" | "empty" | "none-without-reason";

/** A line that starts the answer, such as `Architecture: …`, `- **Architecture:** …` or `> *Architecture:* …`. */
const architectureLabel = /^ {0,3}(?:>[ \t]*)?(?:[-*+][ \t]+)?(?:\*\*|__|\*|_)?architecture(?:\*\*|__|\*|_)?[ \t]*:(?:\*\*|__|\*|_)?(.*)$/i;

/**
 * Reads the description's Architecture line, outside HTML comments and code
 * fences, and says what is wrong with it: there is none, it is empty, as the
 * template leaves it, or it answers `None:` with no reason after `because`.
 * The answer runs on to the end of its paragraph or list item, so a reason
 * that wraps onto the next line counts. Only the first Architecture line counts.
 */
export function architectureLineProblem(body: string): ArchitectureLineProblem | undefined {
  const lines = body.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?(-->|$)/g, "").split("\n");
  const index = firstArchitectureLine(lines);
  if (index === -1) return "missing";
  const text = architectureAnswer(lines, index);
  if (!text) return "empty";
  return noneAnswer.test(text) && !becauseReason.test(text) ? "none-without-reason" : undefined;
}

/** The index of the first Architecture line outside code fences, or -1. */
function firstArchitectureLine(lines: readonly string[]): number {
  // The fence that is open, such as "```" or "~~~~", which only a line starting with as many of the same character closes.
  let open = "";
  return lines.findIndex(line => {
    const marker = fence.exec(line)?.[1];
    if (marker && !open) open = marker;
    else if (marker && marker[0] === open[0] && marker.length >= open.length) open = "";
    else if (!open) return architectureLabel.test(line);
    return false;
  });
}

const fence = /^ {0,3}(`{3,}|~{3,})/;

/** The paragraph or list item ends at a blank line, a heading, a fence or the next list item. */
const answerEnd = /^ {0,3}(#{1,6}[ \t]|```|~~~|[-*+][ \t]|\d{1,9}[.)][ \t])/;

/** The answer after the label at `index`, to the end of its paragraph or list item, with inline code blanked. */
function architectureAnswer(lines: readonly string[], index: number): string {
  // The caller found the label on this line.
  const answer = [present(architectureLabel.exec(lines[index]), "the Architecture label")[1]];
  for (const line of lines.slice(index + 1)) {
    if (!line.trim() || answerEnd.test(line)) break;
    answer.push(line);
  }
  return answer.join(" ").replace(/`[^`]*`/g, "code").trim();
}

const architectureReasons: Record<ArchitectureLineProblem, string> = {
  missing: "its description has no Architecture line",
  empty: "the Architecture line in its description is empty",
  "none-without-reason": "the Architecture line answers None: without a reason after because",
};

/** The `missing-architecture` warning for a ready pull request's body, or undefined when its Architecture line answers. */
function architectureIssue(body: string): PrCheckIssue | undefined {
  const problem = architectureLineProblem(body);
  if (!problem) return undefined;
  return {
    severity: "warning",
    path: ["settings", "architectureDecisions"],
    rule: "missing-architecture",
    message: `This pull request is ready for review, but ${architectureReasons[problem]}. Answer the four architecture questions there, or point to the plan's Architecture decisions section. Routine work answers "None: keeps the existing design because …" with a real reason.`,
  };
}

const idPattern = (id: string) => new RegExp(`(^|[^A-Za-z0-9-])${escapeRegExp(id)}(?![A-Za-z0-9]|-[0-9])`, "i");

/** Where a change that needs a person sits in the pull request's map, so annotations land on its line. */
function changePath(change: NeedsPersonChange, after: StoryMapDocument): { path: (string | number)[]; itemId?: string } {
  const at = (items: readonly { id: string }[] | undefined, key: string) => {
    const index = items?.findIndex(item => item.id === change.itemId) ?? -1;
    return index === -1 ? [] : [key, index];
  };
  switch (change.itemType) {
    case "story": return { path: at(after.stories, "stories"), itemId: change.itemId };
    case "activity": return { path: at(after.activities, "activities"), itemId: change.itemId };
    case "release": return { path: at(after.releases, "releases"), itemId: change.itemId };
    case "persona": return { path: at(after.personas, "personas"), itemId: change.itemId };
    case "job": {
      for (const [index, persona] of (after.personas ?? []).entries()) {
        const job = persona.jobs?.findIndex(item => item.id === change.itemId) ?? -1;
        if (job !== -1) return { path: ["personas", index, "jobs", job], itemId: change.itemId };
      }
      return { path: [], itemId: change.itemId };
    }
    case "map":
      if (change.rule === "settings-changed") return { path: after.settings && change.itemId in after.settings ? ["settings", change.itemId] : [] };
      return { path: change.change.startsWith("visibility") ? ["visibility"] : after.customer ? ["customer"] : [] };
  }
}

const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * Checks a pull request against the map rules a check can see. Each change
 * that only a person should make is an error when any commit that changes the
 * map was written with an agent, unless a person approved it. With a body,
 * each story the pull request marks merged needs a Tokens used section that
 * names it, or that explains, without naming any story, why there is no count.
 */
export function checkPullRequest(options: PrCheckOptions): PrCheckResult {
  const { diff, after } = options;
  const issues: PrCheckIssue[] = [];

  const agentCommits = options.commits.flatMap(commit => {
    const agent = commitAgent(commit, options.botNames);
    return agent ? [{ sha: commit.sha, agent }] : [];
  });
  const approved = !!options.approved && diff.needsPerson.length > 0 && agentCommits.length > 0;
  if (agentCommits.length && !options.approved) {
    const shown = agentCommits.slice(0, 3).map(commit => `${shortSha(commit.sha)} (${commit.agent})`).join(", ");
    const more = agentCommits.length > 3 ? ` and ${agentCommits.length - 3} more` : "";
    for (const change of diff.needsPerson) {
      issues.push({
        severity: "error",
        ...changePath(change, after),
        rule: change.rule,
        message: `${needsPersonLabels[change.rule]}: ${change.change}. Only a person should make this change, and the map was changed in commits written with an agent: ${shown}${more}. Have a person make it, or approve it with the map-approved label.`,
      });
    }
  }

  const merged = [
    ...diff.stories.added.filter(story => story.status === "merged").map(story => story.id),
    ...diff.stories.updated.filter(story => story.status?.to === "merged").map(story => story.id),
  ];
  const { body } = options;
  const checkedBody = body !== undefined;
  if (checkedBody && merged.length) {
    const section = tokensUsedSection(body);
    const index = (id: string) => after.stories.findIndex(story => story.id === id);
    const missing = (id: string, why: string) => issues.push({ severity: "error", path: ["stories", index(id)], itemId: id, rule: "missing-tokens-used", message: why });
    if (section === undefined) {
      for (const id of merged) missing(id, `This pull request marks ${id} merged, but its description has no Tokens used section. Paste the output of story-map tokens --format markdown ${id} there, or say why the tokens could not be counted.`);
    } else if (!section) {
      for (const id of merged) missing(id, `This pull request marks ${id} merged, but the Tokens used section in its description is empty. Paste the output of story-map tokens --format markdown ${id} there, or say why the tokens could not be counted.`);
    } else {
      // A section that names no story ID is an explanation for all of them, such as why nothing could be counted.
      const names = after.stories.some(story => idPattern(story.id).test(section));
      if (names) {
        for (const id of merged) {
          if (!idPattern(id).test(section)) missing(id, `This pull request marks ${id} merged, but the Tokens used section in its description does not name it. Add the output of story-map tokens --format markdown ${id}, or say why its tokens could not be counted.`);
        }
      }
    }
  }

  // Only a pull request known to be ready is checked, so a draft, or a host whose CI does not pass draft, is never warned.
  const checkedReview = checkedBody && options.draft === false;
  if (checkedReview) {
    const section = reviewSection(body);
    const why = section === undefined ? "its description has no Review section" : !section ? "the Review section in its description is empty" : undefined;
    if (why) {
      issues.push({
        severity: "warning",
        path: [],
        rule: "missing-review",
        message: `This pull request is ready for review, but ${why}. Record the review of its diff there: the target, the commit reviewed, the level, the findings fixed and the findings declined. A person's review of the same diff also counts. If no review could be run, say so and convert the pull request back to a draft.`,
      });
    }
  }

  // Only a ready pull request in a map that requires architecture decisions is checked, so hosts that have not adopted them see nothing.
  const checkedArchitecture = checkedReview && after.settings?.architectureDecisions === "required";
  const architecture = checkedArchitecture ? architectureIssue(body) : undefined;
  if (architecture) issues.push(architecture);

  return {
    passed: !issues.some(issue => issue.severity === "error" || (options.strict && issue.severity === "warning")),
    agentCommits,
    needsPerson: diff.needsPerson,
    approved,
    merged,
    checkedBody,
    checkedReview,
    checkedArchitecture,
    issues,
  };
}
