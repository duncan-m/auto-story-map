import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseDocument, isMap, isSeq, type YAMLMap, type YAMLSeq } from "yaml";
import { agentsSectionBlocks, type AgentsSectionBlock } from "./agents-rules.js";
import { proposeStoryMapEdit, unifiedDiff, type StoryIdScheme, type StoryMapEditOperation } from "./edit.js";
import { destination, skillPath } from "./init.js";
import { replaceAgentsSection, setupBody, setupBodyHash, stampSetupFile, type SetupPart } from "./setup-versions.js";
import { upgradeOverview, loadSetupChanges, type UpgradeOverview } from "./upgrade-overview.js";
import { runCommands, upgradePartIds, upgradeReport, upgradeTemplates, workflowCommands, type AgentsRuleReview, type UpgradePart, type UpgradePartId, type UpgradeMode, type UpgradeReport, type UpgradeReportOptions } from "./upgrade.js";
import { storyMapVersion } from "./version.js";

/**
 * How the upgrade review applies changes:
 *
 * - `simple`: what the report recommends. Unedited parts are replaced, missing
 *   parts and workflow steps are added, the unchanged rules of an edited
 *   `AGENTS.md` section are updated, and every edit of the host's is kept.
 * - `advanced`: only the parts the person accepted, given as `parts`. An
 *   accepted part is replaced with this version's, even when the host edited it.
 */
export type UpgradeApplyMode = UpgradeMode;

/** The person's answers to the product choices. Only ever an answer they gave: leave a choice out for "not now". */
export interface UpgradeAnswers {
  /** A repository-relative folder for delivery plans, or false for none. */
  plans?: string | false;
  storyIds?: StoryIdScheme;
  /** The mode the person chose for later reviews, recorded in `settings.upgrade`. */
  upgrade?: UpgradeMode;
}

export interface UpgradeApplyOptions extends UpgradeReportOptions {
  /** Defaults to `simple`. */
  mode?: UpgradeApplyMode;
  /** For `advanced`: the parts the person accepted. Every other part is kept. Empty keeps every part, as when the person accepts none in the walk-through. */
  parts?: readonly UpgradePartId[];
  /** The person's answers to the product choices. */
  answers?: UpgradeAnswers;
  /** Write the changes. Without it, nothing is written, and the result says what would change. */
  write?: boolean;
}

/**
 * What happens to one part:
 *
 * - `add`: the part, or the `AGENTS.md` section, is added
 * - `replace`: it is replaced with this version's
 * - `update`: this version's changes are merged into the host's edited copy:
 *   the unchanged rules of an `AGENTS.md` section, or the steps a workflow is missing
 * - `record`: the person's answer to a choice is recorded in the map
 * - `ask`: a choice nobody has made, to ask the person
 * - `keep`: nothing changes, such as a current part or one the host edited
 */
export type UpgradeChangeAction = "add" | "replace" | "update" | "record" | "ask" | "keep";

/** One part, and what applying the review does to it. */
export interface UpgradeChange {
  part: UpgradePartId;
  title: string;
  /** The file it changes, relative to the root. For a choice, the map. */
  path: string;
  action: UpgradeChangeAction;
  /** What happens, in a few words. */
  change: string;
  /** A unified diff of the file, from the host's to the result, when it changes. */
  diff?: string;
  /** For a choice the person answered: the value recorded. */
  value?: unknown;
  /**
   * Set on the extra change for a setting the run records because of a part it applies,
   * such as `architectureDecisions` when the `agents` part gains its rule. That change
   * shares the part's ID, so tell the two apart by this, not by `part` alone.
   */
  setting?: "architectureDecisions";
}

/** A product choice still to make. Ask the person, and record only their answer. */
export interface UpgradeQuestion {
  part: "plans" | "storyIds";
  /** The question to ask, in plain words. */
  question: string;
  /** The guide section that explains it. */
  link: string;
  /** How to give the answer to `story-map upgrade`, such as `--plans <folder>|off`. */
  option: string;
}

/** What applying the upgrade review changes, or would change without `write`. */
export interface UpgradeApplyResult {
  mode: UpgradeApplyMode;
  /** The report the changes were worked out from, before anything was written. */
  report: UpgradeReport;
  /** The overview of what is applied, in plain words. Show it to people as written. */
  overview: UpgradeOverview;
  /**
   * One entry for each part, in the order of `upgradePartIds`, then one with the `agents`
   * part's ID, the map's path and `setting: "architectureDecisions"` when the run adds the
   * architecture rule: `record` when it records the setting, `keep` when the map has problems.
   */
  changes: UpgradeChange[];
  /** The product choices nobody has made, and the person has not answered. */
  questions: UpgradeQuestion[];
  /** The mode recorded in the map's `settings.upgrade`, from `answers.upgrade`, when it changes. */
  modeRecorded?: UpgradeMode;
  /**
   * `required` when this run adds the `architecture-decisions` rule, or the skill's
   * `skill-architecture-decisions`, to the `AGENTS.md` section and the map had no
   * `settings.architectureDecisions`, so the person who accepts the rule also turns on its check.
   */
  architectureDecisionsRecorded?: "required";
  /** True when at least one file changes. */
  changed: boolean;
  /** True when the changes were written. */
  written: boolean;
  /** The files written, or that `write` would write, relative to the root. */
  files: string[];
}

/** A file the upgrade would write, with the text it was worked out from. */
interface PlannedFile {
  path: string;
  /** The text read from the host, or undefined for a new file. */
  before: string | undefined;
  after: string;
}

/** A part the upgrade cannot apply as asked, such as an unknown part in `parts`. */
export class UpgradeApplyError extends Error {}

const questions: Record<"plans" | "storyIds", Omit<UpgradeQuestion, "part">> = {
  plans: {
    question: "Do you want to use delivery plans, and if so, in which folder, such as docs/plans?",
    link: "docs/story-map.md#choose-whether-to-use-delivery-plans",
    option: "--plans <folder>|off",
  },
  storyIds: {
    question: "Should story-map add number new stories one after the highest number (next), or take the lowest free number (lowest-free)?",
    link: "docs/story-map.md#change-the-map-from-the-command-line",
    option: "--story-ids next|lowest-free",
  },
};

/** The part IDs `--apply` takes, such as `guide,workflow`. `story-ids` is accepted for `storyIds`. */
export function parseUpgradeParts(list: string): UpgradePartId[] {
  const parts = list.split(",").map(part => part.trim()).filter(Boolean).map(part => (part === "story-ids" ? "storyIds" : part));
  const unknown = parts.filter(part => !(upgradePartIds as readonly string[]).includes(part));
  if (unknown.length) throw new UpgradeApplyError(`Unknown part ${unknown.join(", ")}. The parts are ${upgradePartIds.join(", ")}.`);
  if (!parts.length) throw new UpgradeApplyError(`Name at least one part: ${upgradePartIds.join(", ")}.`);
  return [...new Set(parts)] as UpgradePartId[];
}

const renderBlock = (block: AgentsSectionBlock) => (block.kind === "rule" && block.id ? `<!-- rule: ${block.id} -->\n${block.text}` : block.text);

/** A section body from its blocks, as the templates lay them out: one blank line between blocks. */
const renderBlocks = (blocks: readonly AgentsSectionBlock[]) => `${blocks.map(renderBlock).join("\n\n")}\n`;

/**
 * Merges this version's `AGENTS.md` section with the host's edited one, rule
 * by rule, from ESM-173's review. Simple mode takes this version's text for a
 * rule marked `replace` or `add`, leaves out one marked `remove` and the rules
 * the host removed, and keeps the host's own text for everything else: the
 * rules they reworded, their own rules and their own headings.
 *
 * The result follows this version's order. Each block only the host has, such
 * as a rule of their own, goes after the block it follows in the host's
 * section, so it stays where they put it.
 */
export function mergeAgentsSection(hostBody: string, target: string, rules: readonly AgentsRuleReview[]): string {
  const byId = new Map(rules.filter(rule => rule.id).map(rule => [rule.id!, rule]));
  const templateBlocks = agentsSectionBlocks(target);
  const templateIds = new Set(templateBlocks.filter(block => block.id).map(block => block.id!));
  const templateHeadings = new Set(templateBlocks.filter(block => block.kind === "heading").map(block => block.text));

  // This version's blocks, with the host's text where it is kept.
  const out: { block: AgentsSectionBlock; anchor?: string }[] = [];
  for (const block of templateBlocks) {
    if (block.kind === "heading") {
      out.push({ block, anchor: `heading:${block.text}` });
      continue;
    }
    const rule = block.id ? byId.get(block.id) : undefined;
    if (rule?.state === "removed") continue;
    const kept = rule && rule.text !== undefined && rule.recommendation !== "replace" && rule.recommendation !== "add";
    out.push({ block: kept ? { ...block, text: rule.text! } : block, anchor: block.id && `rule:${block.id}` });
  }

  // The host's blocks this version does not have, each placed after the block it follows in the host's section.
  const ruleForText = (text: string) => rules.find(rule => rule.text === text && !(rule.id && templateIds.has(rule.id)));
  const templateRuleForText = (text: string) => rules.find(rule => rule.text === text && rule.id && templateIds.has(rule.id));
  let after = -1;
  for (const block of agentsSectionBlocks(hostBody)) {
    if (block.kind === "heading") {
      if (templateHeadings.has(block.text)) {
        after = out.findIndex(item => item.anchor === `heading:${block.text}`);
        continue;
      }
      out.splice(++after, 0, { block });
      continue;
    }
    // A rule of this version's, by its review or, failing that, its marker.
    const id = templateRuleForText(block.text)?.id ?? (block.id && templateIds.has(block.id) && !byId.has(block.id) ? block.id : undefined);
    if (id) {
      const index = out.findIndex(item => item.anchor === `rule:${id}`);
      if (index !== -1) after = index;
      continue;
    }
    const own = ruleForText(block.text);
    if (own?.recommendation === "remove") continue;
    out.splice(++after, 0, { block });
  }
  return renderBlocks(out.map(item => item.block));
}

/** The indentation of the line `index` is on, and where that line starts. */
function lineAt(text: string, index: number) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  return { start, indent: /^[ \t]*/.exec(text.slice(start))![0] };
}

/**
 * Each step of this version's workflow template as text, with the comment
 * lines before it, keyed by the command it runs, as `workflowCommands` keys them.
 */
function templateSteps(template: string) {
  const steps = new Map<string, { text: string; indent: string }>();
  const document = parseDocument(template);
  const jobs = document.get("jobs", true);
  if (!isMap(jobs)) return steps;
  for (const job of (jobs as YAMLMap).items) {
    const list = isMap(job.value) ? (job.value as YAMLMap).get("steps", true) : undefined;
    if (!isSeq(list)) continue;
    for (const item of (list as YAMLSeq).items as { range?: [number, number, number] }[]) {
      if (!item.range) continue;
      const { start, indent } = lineAt(template, item.range[0]);
      // Comment lines right above the step belong to it.
      let from = start;
      while (from > 0) {
        const previous = lineAt(template, from - 1);
        if (!template.slice(previous.start, from).trim().startsWith("#")) break;
        from = previous.start;
      }
      const end = template.indexOf("\n", item.range[1] - 1);
      const text = template.slice(from, end === -1 ? template.length : end + 1);
      const run = isMap(item) ? (item as unknown as YAMLMap).get("run") : undefined;
      for (const key of typeof run === "string" ? runCommands(run).keys() : []) {
        if (!steps.has(key)) steps.set(key, { text, indent });
      }
    }
  }
  return steps;
}

/**
 * Adds the steps this version's workflow runs that the host's does not, at
 * the end of the steps of the host's job that runs `story-map validate`, or
 * its first job with steps. The rest of the file is kept as it is. Returns
 * undefined when the steps cannot be added safely, such as for a steps list
 * written inline, so the person adds them by hand.
 */
export function addWorkflowSteps(host: string, template: string, keys: readonly string[]): string | undefined {
  const document = parseDocument(host);
  if (document.errors.length) return undefined;
  const jobs = document.get("jobs", true);
  if (!isMap(jobs)) return undefined;
  const lists = (jobs as YAMLMap).items
    .map(job => (isMap(job.value) ? (job.value as YAMLMap).get("steps", true) as unknown : undefined))
    .filter((list): list is YAMLSeq => isSeq(list) && !list.flow && list.items.length > 0);
  const runsValidate = (list: YAMLSeq) => list.items.some(item => {
    const run = isMap(item) ? (item as YAMLMap).get("run") : undefined;
    return typeof run === "string" && runCommands(run).has("story-map validate");
  });
  const list = lists.find(runsValidate) ?? lists[0];
  if (!list) return undefined;
  const steps = templateSteps(template);
  const added = keys.map(key => steps.get(key));
  if (added.some(step => !step)) return undefined;

  const items = list.items as { range?: [number, number, number] }[];
  const first = items[0].range;
  const last = items.at(-1)!.range;
  if (!first || !last) return undefined;
  const { indent } = lineAt(host, first[0]);
  let at = host.indexOf("\n", last[1] - 1);
  at = at === -1 ? host.length : at + 1;
  const newline = host.includes("\r\n") ? "\r\n" : "\n";
  const lead = at === host.length && !host.endsWith("\n") ? newline : "";
  const text = [...new Set(added)]
    .map(step => step!.text.split("\n").map(line => (line.startsWith(step!.indent) ? indent + line.slice(step!.indent.length) : line)).join("\n"))
    .join("")
    .replace(/\n/g, newline);
  const result = host.slice(0, at) + lead + text + host.slice(at);
  const have = workflowCommands(result);
  return parseDocument(result).errors.length || !keys.every(key => have.has(key)) ? undefined : result;
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The rules that ask for architecture decisions, in the full section and the pointer to the skill. */
const architectureRuleIds: ReadonlySet<string> = new Set(["architecture-decisions", "skill-architecture-decisions"]);

/** True when the story map section of an `AGENTS.md` file has a rule asking for architecture decisions, by its marker. */
function asksForArchitectureDecisions(text: string | undefined) {
  const body = text === undefined ? undefined : setupBody("agents", text);
  return body !== undefined && agentsSectionBlocks(body).some(block => block.kind === "rule" && block.id !== undefined && architectureRuleIds.has(block.id));
}

/** The map's `settings.architectureDecisions`, without validating the rest of the map. */
function architectureDecisionsSetting(text: string): unknown {
  try {
    const map = parseDocument(text).toJS() as { settings?: { architectureDecisions?: unknown } } | null;
    return map?.settings?.architectureDecisions;
  } catch {
    return undefined;
  }
}

/** True when an outdated or edited rule review has something simple mode applies. */
const appliesRule = (rule: AgentsRuleReview) => rule.recommendation === "replace" || rule.recommendation === "add" || rule.recommendation === "remove";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Applies the upgrade review to a host repository, or, without `write`, says
 * what it would change. It is what `story-map upgrade --mode simple` and
 * `--apply <parts>` run, and what the interactive walk-through and `init`
 * build on.
 *
 * Writes are safe:
 *
 * - A part the host edited is never replaced in simple mode. Only the parts of
 *   it this version changes and the host did not, such as an unchanged rule
 *   or a missing workflow step, are merged in.
 * - A file whose text would not change is not written, so a repository with
 *   nothing to apply is left byte for byte as it was.
 * - Before writing, every file is read again, and if any changed since it was
 *   read, nothing is written.
 * - A product choice is recorded only from `answers`. One with no answer is
 *   listed in `questions`, to ask the person.
 *
 * A replaced or added file records this version in its marker. A part that
 * keeps the host's edits on top of this version's template records the
 * template's hash, so it still reads as edited, and validate stops reminding.
 * One that still has reworded rules for the person to review keeps its marker,
 * so the review and the reminder still offer them.
 */
export async function applyUpgrade(options: UpgradeApplyOptions = {}): Promise<UpgradeApplyResult> {
  const mode = options.mode ?? "simple";
  if (mode === "advanced" && !options.parts) throw new UpgradeApplyError("Advanced mode applies only the parts you name, such as --apply guide,workflow.");
  if (mode === "simple" && options.parts?.length) throw new UpgradeApplyError("Simple mode applies the recommended changes. Name parts only in advanced mode.");
  const root = await realpath(options.root ?? ".");
  const mapPath = options.map ?? "product/story-map.yaml";
  const report = await upgradeReport({ ...options, root, map: mapPath });
  const at = (path: string) => readOptional(join(root, path));
  const [agentsText, workflowText, skillText, mapText] = await Promise.all(["AGENTS.md", ".github/workflows/story-map.yml", skillPath, mapPath].map(at));
  const templates = await upgradeTemplates(root, { agents: agentsText, workflow: workflowText, skill: skillText });
  const chosen = new Set(options.parts ?? []);
  const answers = options.answers ?? {};

  const planned: PlannedFile[] = [];
  const changes: UpgradeChange[] = [];
  /** The recommendation each part ends up with, for the overview of what is applied. */
  const applied = new Map<UpgradePartId, UpgradePart>();

  const stamped = (part: SetupPart) =>
    part === "agents"
      ? stampSetupFile("agents", `<!-- auto-story-map:start -->\n${templates.agents}<!-- auto-story-map:end -->\n`, storyMapVersion)
      : stampSetupFile(part, part === "guide" ? templates.guide : templates.workflow, storyMapVersion);
  const plan = (path: string, before: string | undefined, after: string) => {
    if (before !== after) planned.push({ path, before, after });
    return before === after ? undefined : unifiedDiff(before ?? "", after);
  };
  const keep = (part: UpgradePart, change: string) => {
    changes.push({ part: part.part, title: part.title, path: part.path, action: "keep", change });
    applied.set(part.part, { ...part, recommendation: part.recommendation === "review" ? "review" : "keep" });
  };

  for (const part of report.parts) {
    const take = mode === "advanced" ? chosen.has(part.part) : undefined;
    const base = { part: part.part, title: part.title, path: part.path };

    if (part.kind === "choice") {
      const choice = part.part as "plans" | "storyIds";
      const answer = answers[choice];
      if (answer !== undefined) {
        changes.push({ ...base, action: "record", change: `record ${JSON.stringify(answer)} in settings.${choice}`, value: answer });
      } else if (part.state === "not-chosen") {
        changes.push({ ...base, action: "ask", change: "ask the person; not now leaves it unset" });
      } else {
        changes.push({ ...base, action: "keep", change: part.change });
      }
      continue;
    }

    if (part.state === "current" || take === false) {
      keep(part, part.state === "current" ? "none" : "kept as it is");
      continue;
    }

    if (part.part === "skill") {
      const wanted = take || part.recommendation === "add";
      if (!wanted) {
        keep(part, part.change);
        continue;
      }
      const diff = plan(skillPath, skillText, templates.skill);
      const action = skillText === undefined ? "add" : "replace";
      changes.push({ ...base, action, change: action === "add" ? "add the skill" : "replace with this version's skill", ...(diff ? { diff } : {}) });
      applied.set(part.part, { ...part, recommendation: action });
      continue;
    }

    const setupPart = part.part as SetupPart;
    const hostText = setupPart === "agents" ? agentsText : setupPart === "workflow" ? workflowText : await at(part.path);

    if (part.state === "not-added") {
      if (setupPart === "workflow" && !(await exists(join(root, "package-lock.json")))) {
        keep(part, "not added: there is no package-lock.json; add `story-map validate --format github product/story-map.yaml` to your CI");
        applied.set(part.part, { ...part, recommendation: "keep" });
        continue;
      }
      let after: string;
      if (setupPart !== "agents" || hostText === undefined) after = stamped(setupPart);
      else {
        // Append the section to the host's own AGENTS.md, as init does.
        const separator = hostText.length === 0 || hostText.endsWith("\n\n") ? "" : hostText.endsWith("\n") ? "\n" : "\n\n";
        after = hostText + separator + stamped("agents");
      }
      const diff = plan(part.path, hostText, after);
      changes.push({ ...base, action: "add", change: setupPart === "agents" && hostText !== undefined ? "add the story map section" : `add ${part.path}`, ...(diff ? { diff } : {}) });
      applied.set(part.part, { ...part, recommendation: "add" });
      continue;
    }

    // Replace: an unedited part in simple mode, or any part the person accepted in advanced mode.
    if (take || part.recommendation === "replace") {
      const after = setupPart === "agents" ? replaceAgentsSection(hostText!, stamped("agents")) : stamped(setupPart);
      if (after === undefined) {
        keep(part, "kept: the story map section's markers could not be read");
        continue;
      }
      const diff = plan(part.path, hostText, after);
      changes.push({ ...base, action: "replace", change: `replace with ${storyMapVersion}${part.state === "outdated" ? "" : ", replacing your edits"}`, ...(diff ? { diff } : {}) });
      applied.set(part.part, { ...part, recommendation: "replace" });
      continue;
    }

    // Simple mode, edited parts: merge only what the host did not change.
    if (setupPart === "agents" && part.recommendation === "review" && part.rules?.some(appliesRule)) {
      const body = mergeAgentsSection(setupBody("agents", hostText!)!, templates.agents, part.rules);
      const toReview = part.rules.filter(rule => rule.recommendation === "review").length;
      // With reworded rules still to review, the marker stays, so the review and the reminder still offer them.
      const marker = /<!-- auto-story-map:start[^>]*-->/.exec(hostText!)![0];
      const section = toReview
        ? `${marker}\n${body}<!-- auto-story-map:end -->`
        : stampSetupFile("agents", `<!-- auto-story-map:start -->\n${body}<!-- auto-story-map:end -->\n`, storyMapVersion, setupBodyHash(templates.agents));
      const after = replaceAgentsSection(hostText!, section)!;
      const count = (recommendation: string) => part.rules!.filter(rule => rule.recommendation === recommendation).length;
      const words = [
        count("replace") && `update ${plural(count("replace"), "rule", "rules")}`,
        count("add") && `add ${plural(count("add"), "new rule", "new rules")}`,
        count("remove") && `remove ${plural(count("remove"), "dropped rule", "dropped rules")}`,
        toReview && `keep ${plural(toReview, "reworded rule", "reworded rules")} for you to review`,
      ].filter(Boolean);
      const diff = plan(part.path, hostText, after);
      changes.push({ ...base, action: "update", change: words.join(", "), ...(diff ? { diff } : {}) });
      applied.set(part.part, part);
      continue;
    }
    if (setupPart === "workflow" && part.additions?.length) {
      const merged = addWorkflowSteps(setupBody("workflow", hostText!)!, templates.workflow, part.additions);
      if (merged === undefined) {
        keep(part, `kept: add the ${part.additions.join(", ")} ${part.additions.length === 1 ? "step" : "steps"} by hand`);
        continue;
      }
      // The steps are what the workflow is compared by, so it is now this version's, with the host's edits.
      const after = stampSetupFile("workflow", merged, storyMapVersion, setupBodyHash(templates.workflow));
      const diff = plan(part.path, hostText, after);
      changes.push({ ...base, action: "update", change: `add the ${part.additions.join(", ")} ${part.additions.length === 1 ? "step" : "steps"}`, ...(diff ? { diff } : {}) });
      applied.set(part.part, part);
      continue;
    }
    keep(part, part.recommendation === "review" ? "kept as you edited it; run story-map upgrade --diff to compare" : part.change);
  }

  // Taking the architecture-decisions rule turns on its check, unless the map already says how strict it is.
  // The rule is new in this version, so a section that lacked it before has not been asked.
  const agentsFile = planned.find(file => file.path === "AGENTS.md");
  const adoptsArchitecture = agentsFile !== undefined && mapText !== undefined
    && asksForArchitectureDecisions(agentsFile.after) && !asksForArchitectureDecisions(agentsFile.before)
    && architectureDecisionsSetting(mapText) === undefined;
  // The setting is recorded only in a map that is valid already, so a map with problems never stops the rest of the upgrade.
  const architectureOperation = { op: "architecture-decisions", architectureDecisions: "required" } as StoryMapEditOperation;
  const recordsArchitecture = adoptsArchitecture
    && (await proposeStoryMapEdit(mapText!, [architectureOperation], { check: { root } }).then(edit => edit.valid, () => false));
  if (adoptsArchitecture) {
    changes.push({
      part: "agents",
      setting: "architectureDecisions",
      title: "Architecture decisions",
      path: mapPath,
      ...(recordsArchitecture
        ? { action: "record" as const, change: "record \"required\" in settings.architectureDecisions, so open plans without the section get warnings", value: "required" }
        : { action: "keep" as const, change: `not recorded: ${mapPath} has problems; fix them, then run story-map settings --architecture-decisions required --write` }),
    });
  }

  // Record the answers in the map, through the same checks as story-map settings.
  const operations: StoryMapEditOperation[] = [
    ...(answers.plans === undefined ? [] : [{ op: "plans", plans: answers.plans } as StoryMapEditOperation]),
    ...(answers.storyIds === undefined ? [] : [{ op: "story-ids", storyIds: answers.storyIds } as StoryMapEditOperation]),
    ...(answers.upgrade === undefined ? [] : [{ op: "upgrade-mode", upgrade: answers.upgrade } as StoryMapEditOperation]),
    ...(recordsArchitecture ? [architectureOperation] : []),
  ];
  let modeRecorded: UpgradeMode | undefined;
  if (operations.length) {
    const recorded = changes.filter(change => change.action === "record");
    if (mapText === undefined) {
      for (const change of recorded) Object.assign(change, { action: "ask", change: "the map is not there yet; ask again once it is", value: undefined });
    } else {
      const edit = await proposeStoryMapEdit(mapText, operations, { check: { root } });
      if (!edit.valid) throw new UpgradeApplyError(`${mapPath} would not be valid with the answers, so nothing was written. Run story-map validate to see why.`);
      if (edit.changed) {
        const diff = unifiedDiff(mapText, edit.source);
        if (recorded[0]) recorded[0].diff = diff;
        if (answers.upgrade !== undefined && report.mode !== answers.upgrade) modeRecorded = answers.upgrade;
        plan(mapPath, mapText, edit.source);
      } else {
        for (const change of recorded) Object.assign(change, { action: "keep", change: "none; the map already has this answer" });
      }
    }
  }

  const overviewParts = report.parts.map(part => applied.get(part.part) ?? part);
  const overview = upgradeOverview(overviewParts, options.changes ?? (await loadSetupChanges()), storyMapVersion);
  const asked = changes.filter(change => change.action === "ask").map(change => ({ part: change.part as "plans" | "storyIds", ...questions[change.part as "plans" | "storyIds"] }));
  const files = planned.map(file => file.path);

  if (options.write && planned.length) {
    // Check every file first, so a file edited meanwhile stops the whole upgrade, not half of it.
    const targets = await Promise.all(planned.map(file => destination(root, file.path)));
    for (const [index, file] of planned.entries()) {
      if ((await readOptional(targets[index])) !== file.before) throw new UpgradeApplyError(`${file.path} changed while the upgrade ran, so nothing was written. Run it again.`);
    }
    for (const [index, file] of planned.entries()) {
      await mkdir(dirname(targets[index]), { recursive: true });
      await writeFile(targets[index], file.after, file.before === undefined ? { flag: "wx" } : {});
    }
  }

  const architectureDecisionsRecorded = recordsArchitecture && planned.some(file => file.path === mapPath) ? "required" as const : undefined;
  return { mode, report, overview, changes, questions: asked, ...(modeRecorded ? { modeRecorded } : {}), ...(architectureDecisionsRecorded ? { architectureDecisionsRecorded } : {}), changed: planned.length > 0, written: !!options.write && planned.length > 0, files };
}
