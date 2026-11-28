import { createHash } from "node:crypto";
import type { StoryMapRuleId } from "./rules.js";

/** Which `AGENTS.md` template a rule belongs to: the full rules, or the short pointer `init --skill` writes. */
export type AgentsRuleForm = "full" | "skill";

/** What the package knows about one rule in its `AGENTS.md` templates. */
export interface AgentsRuleInfo {
  form: AgentsRuleForm;
  /** A short name for people, such as "Record the tokens used". */
  title: string;
  /**
   * The opening words of the rule in every release that shipped it, before
   * rules carried IDs. They name the rules in those releases' templates, so
   * hosts set up before 0.7.8 can be compared rule by rule.
   */
  openings: string[];
  /** The validation rule that checks the same thing, when there is one, under the same ID. */
  check?: StoryMapRuleId;
}

/**
 * Every rule in the package's `AGENTS.md` templates, by its stable ID. Each
 * rule in a template is one paragraph, with `<!-- rule: <id> -->` on the line
 * before it. IDs follow ESM-159's validation rule IDs: lower-case words joined
 * by hyphens, never taken from the rule's text, so a reworded rule keeps its
 * ID. A rule that a validation rule checks shares that rule's ID.
 *
 * To add a rule, add an entry here and its marker in the template. Never
 * reuse or rename an ID: a rule the package drops keeps its entry, so hosts
 * that still have it can be told it was dropped.
 */
export const agentsRules = {
  "source-of-truth": { form: "full", title: "The map is the source of truth", openings: ["Treat [product/story-map.yaml]"] },
  "populate-first-map": { form: "full", title: "Populate the first map", openings: ["When `product/story-map.yaml` is missing"] },
  "choose-upgrade-mode": { form: "full", title: "Ask for simple or advanced upgrades", openings: ["Before you run `npx --no-install story-map upgrade`"] },
  "choose-delivery-plans": { form: "full", title: "Ask whether to use delivery plans", openings: ["If `settings.plans` is not set in `product/story-map.yaml`"], check: "choose-delivery-plans" },
  "write-delivery-plans": { form: "full", title: "Write a delivery plan", openings: ["When `settings.plans` names a folder"] },
  "link-mockups": { form: "full", title: "Link mockups and designs", openings: ["When a plan has a mockup"] },
  "architecture-decisions": { form: "full", title: "Record architecture decisions", openings: ["Record the architecture decisions"] },
  "update-map-in-pr": { form: "full", title: "Update the map in the same PR", openings: ["When a change affects a user journey"] },
  "audience-and-status": { form: "full", title: "Audience and delivery status", openings: ["Keep new stories internal by default"] },
  "release-notes-and-impact": { form: "full", title: "Release notes and impact", openings: ["Record each release’s notes"] },
  "jobs-to-be-done": { form: "full", title: "Tag stories with jobs to be done", openings: ["Tag each story you add or change"] },
  "outstanding-actions": { form: "full", title: "Find outstanding map work", openings: ["To find outstanding map work"] },
  "agreed-estimates": { form: "full", title: "Only agreed estimates", openings: ["A story's `estimate`"] },
  "record-tokens": { form: "full", title: "Record the tokens used", openings: ["When you open the pull request that finishes a story"] },
  "test-names": { form: "full", title: "Story IDs in test names", openings: ["When you add or change a test"] },
  "validate-after-change": { form: "full", title: "Validate after every map change", openings: ["Run `npx --no-install story-map validate"] },
  "branch-and-title-names": { form: "full", title: "Name branches and pull requests", openings: ["Name each branch"] },
  "pr-diff-summary": { form: "full", title: "Map summary in the PR", openings: ["In the PR description"] },
  "review-before-ready": { form: "full", title: "Review the diff before it is ready", openings: ["Review each pull request's diff"] },
  "skill-source-of-truth": { form: "skill", title: "The map is the source of truth, with the skill", openings: ["Treat [product/story-map.yaml]"] },
  "skill-short-rules": { form: "skill", title: "The short rules", openings: ["Never remove `draft` yourself", "If `settings.plans` is not set in the map"] },
  "skill-architecture-decisions": { form: "skill", title: "Record architecture decisions, with the skill", openings: ["Answer the four architecture questions"] },
  "skill-review-before-ready": { form: "skill", title: "Review the diff before it is ready, with the skill", openings: ["Before you mark a pull request ready"] },
} as const satisfies Record<string, AgentsRuleInfo>;

/** The stable ID of a rule in the `AGENTS.md` templates, such as `record-tokens`. */
export type AgentsRuleId = keyof typeof agentsRules;

/** Every rule ID, in the order the templates list them. */
export const agentsRuleIds = Object.keys(agentsRules) as AgentsRuleId[];

/** True when `value` is the ID of a rule the package ships or once shipped. */
export const isAgentsRuleId = (value: unknown): value is AgentsRuleId =>
  typeof value === "string" && Object.hasOwn(agentsRules, value);

/** The marker that names a rule: an HTML comment on the line before its paragraph. */
export const agentsRuleMarker = /^<!--[ \t]*rule:[ \t]*([a-z0-9][a-z0-9-]*)[ \t]*-->[ \t]*$/;

/** One block of a story map section: a rule's paragraph, or a heading. */
export interface AgentsSectionBlock {
  kind: "rule" | "heading";
  /** The ID from the rule's marker, when it has one. */
  id?: string;
  /** The text, without its marker. */
  text: string;
}

/**
 * Splits the body of a story map section into its headings and paragraphs.
 * A paragraph is a run of lines between blank lines. A rule marker names the
 * paragraph that follows it, even across a blank line. Headings are lines
 * that start with `#` at the start of a paragraph.
 */
export function agentsSectionBlocks(body: string): AgentsSectionBlock[] {
  const blocks: AgentsSectionBlock[] = [];
  let pendingId: string | undefined;
  for (const paragraph of body.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    const lines = paragraph.split("\n").filter(line => line.trim() !== "");
    while (lines.length) {
      const marker = agentsRuleMarker.exec(lines[0].trim());
      if (marker) {
        pendingId = marker[1];
        lines.shift();
      } else if (lines[0].startsWith("#")) {
        blocks.push({ kind: "heading", text: lines.shift()!.trim() });
      } else {
        break;
      }
    }
    if (!lines.length) continue;
    blocks.push({ kind: "rule", ...(pendingId ? { id: pendingId } : {}), text: lines.join("\n").trim() });
    pendingId = undefined;
  }
  return blocks;
}

/** The hash of a rule's text with its spacing evened out, so a rule rewrapped across lines still matches. */
export function agentsRuleHash(text: string) {
  return `sha256:${createHash("sha256").update(text.replace(/\s+/g, " ").trim(), "utf8").digest("hex")}`;
}

/** The rule a paragraph from a template without rule markers is, by its opening words. */
export function agentsRuleByOpening(text: string, form?: AgentsRuleForm): AgentsRuleId | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  return agentsRuleIds.find(id => (!form || agentsRules[id].form === form) && agentsRules[id].openings.some(opening => flat.startsWith(opening)));
}

/**
 * The hash of each rule's text in every earlier release's template, mapped
 * to the versions that shipped it, oldest first. The package keeps it under
 * `rules` in `templates/known-versions.json`.
 */
export type KnownAgentsRules = Record<string, Record<string, string[]>>;

/**
 * The rules in a template body, by ID. Rules with markers use them. A
 * template from before rules carried IDs is named by each rule's opening
 * words. Paragraphs that neither names, and a second copy of a rule, are
 * listed in `unnamed`: `npm run known-versions` fails on them, so the table
 * above stays complete.
 */
export function templateRules(body: string, form: AgentsRuleForm): { rules: Map<string, string>; unnamed: string[] } {
  const rules = new Map<string, string>();
  const unnamed: string[] = [];
  for (const block of agentsSectionBlocks(body)) {
    if (block.kind !== "rule") continue;
    const id = block.id ?? agentsRuleByOpening(block.text, form);
    if (!id || rules.has(id)) unnamed.push(block.text);
    else rules.set(id, block.text);
  }
  return { rules, unnamed };
}

/** The form of an `AGENTS.md` template body: the short pointer when it links to the skill. */
export const agentsRuleForm = (body: string): AgentsRuleForm => (body.includes(".claude/skills/story-map/SKILL.md") ? "skill" : "full");
