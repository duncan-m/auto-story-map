import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { agentsRuleByOpening, agentsRuleHash, agentsRules, agentsSectionBlocks, isAgentsRuleId, templateRules, type AgentsRuleForm, type KnownAgentsRules } from "./agents-rules.js";
import { unifiedDiff } from "./edit.js";
import { skillFile, skillPath, testFolder, workflowWithTests } from "./init.js";
import { compareVersions, loadKnownSetupVersions, readSetupFileVersion, setupBody, setupBodyHash, type KnownSetupVersions, type SetupFileVersion, type SetupPart } from "./setup-versions.js";
import { present } from "./present.js";
import { loadSetupChanges, upgradeOverview, type SetupChanges, type UpgradeOverview } from "./upgrade-overview.js";
import { storyMapVersion } from "./version.js";

/**
 * Every part of a host's set-up that the upgrade review reports on:
 *
 * - the three files `init` stamps with a version (`agents`, `guide`, `workflow`)
 * - `skill`: `.claude/skills/story-map/SKILL.md`, from `init --skill`, which records no version
 * - `plans` and `storyIds`: the choices a person makes in the map's `settings`
 */
export type UpgradePartId = SetupPart | "skill" | "plans" | "storyIds";

export const upgradePartIds: readonly UpgradePartId[] = ["agents", "guide", "workflow", "skill", "plans", "storyIds"];

/**
 * The state of one part, compared with this version of the package.
 *
 * Files:
 * - `not-added`: the file, or the `AGENTS.md` section, is not there
 * - `current`: it matches this version's template
 * - `outdated`: it is a template an earlier release shipped, unedited, so it is safe to replace
 * - `edited`: the host changed it, and this version's template is the one it came from, so nothing new is offered
 * - `edited-outdated`: the host changed it, and this version's template differs from the one it came from, or the one it came from is unknown
 *
 * Choices in the map's `settings`:
 * - `not-chosen`: nobody has answered yet
 * - `chosen`: a person answered, and the answer is kept
 */
export type UpgradePartState = "not-added" | "current" | "outdated" | "edited" | "edited-outdated" | "not-chosen" | "chosen";

/**
 * What the review recommends for a part:
 * - `add`: add the missing part
 * - `optional`: the part is not added, and the host does not need it, such as the skill when `AGENTS.md` has the full rules
 * - `replace`: replace an unedited, outdated part with this version's
 * - `review`: the host edited a part this version changes, so a person compares the two
 * - `keep`: keep the part as it is
 * - `ask`: ask the person the product choice
 */
export type UpgradeRecommendation = "add" | "optional" | "replace" | "review" | "keep" | "ask";

/** One part of the set-up and what this version would change in it. */
export interface UpgradePart {
  part: UpgradePartId;
  /** `file` for a file or section `init` writes, `choice` for a setting in the map. */
  kind: "file" | "choice";
  /** A short name for people, such as "AGENTS.md section". */
  title: string;
  /** The repository-relative file the part lives in. For a choice, the map. */
  path: string;
  state: UpgradePartState;
  /** The version the part came from, when it is known. */
  from?: string;
  /** What this version changes in the part, in one sentence. */
  change: string;
  recommendation: UpgradeRecommendation;
  /**
   * Workflow steps this version's template runs that the host's workflow does
   * not, named by the command they run, such as `story-map diff`. Steps are
   * compared by command, so a host's own job names, Node version and
   * triggers do not count.
   */
  additions?: string[];
  /** A two-way unified diff from the host's copy to this version's, for an outdated or edited part. */
  diff?: string;
  /** For a choice: the value recorded in the map's settings. */
  value?: unknown;
  /** For a file `init` stamps: what ESM-166's marker reading found. */
  version?: SetupFileVersion;
  /**
   * For an `AGENTS.md` section that is outdated or edited: each rule compared
   * with this version's, so an edited section can be reviewed rule by rule.
   * This version's rules come first, in its order, then the rules only the
   * host has, in the host's order.
   */
  rules?: AgentsRuleReview[];
}

/**
 * The state of one `AGENTS.md` rule, compared with this version's:
 *
 * - `current`: the host's rule matches this version's
 * - `outdated`: the host's rule is an earlier release's, unedited, so it is safe to update
 * - `edited`: the host reworded it, and this version did not change it since the host's version
 * - `edited-outdated`: the host reworded it, and this version changed it too, or the host's version is unknown
 * - `removed`: the host's version had the rule and the host removed it, so it stays removed
 * - `new`: this version adds the rule
 * - `dropped`: the host has a rule an earlier release shipped and this version no longer does
 * - `added`: the host's own rule, which the package never shipped
 */
export type AgentsRuleState = "current" | "outdated" | "edited" | "edited-outdated" | "removed" | "new" | "dropped" | "added";

/**
 * What the review recommends for one rule: `keep` it as the host has it,
 * `replace` it with this version's, `add` this version's new rule, `remove` a
 * rule this version drops, or `review` it, when the host reworded a rule this
 * version also changes or drops. Simple mode keeps every rule marked `review`.
 */
export type AgentsRuleRecommendation = "keep" | "replace" | "add" | "remove" | "review";

/** One rule of the host's `AGENTS.md` section, compared with this version's. */
export interface AgentsRuleReview {
  /** The rule's ID, from its marker or recognised from its text. Left out for a paragraph of the host's own with no marker. */
  id?: string;
  /** The rule's name in the package, or the opening words of the host's own rule. */
  title: string;
  state: AgentsRuleState;
  recommendation: AgentsRuleRecommendation;
  /** What this version changes in the rule, in a few words. */
  change: string;
  /** How the host's rule was recognised: by its marker, by matching a template's text, or by its opening words. */
  matchedBy?: "marker" | "text" | "opening";
  /** The host's text of the rule, without its marker, when the host has it. */
  text?: string;
  /** This version's text of the rule, when this version has it and it differs from the host's. */
  template?: string;
  /** A unified diff from the host's rule to this version's, for an outdated or reworded rule. */
  diff?: string;
}

/** The state of each part of a host's set-up, as `story-map upgrade` reports it. */
/** How the upgrade review runs: `simple` applies the recommended changes, `advanced` shows each part's diff to accept or keep. */
export type UpgradeMode = "simple" | "advanced";

/** The question to ask when the map's `settings.upgrade` is not set. Ask the person, and record only their answer. */
export const upgradeModeQuestion = {
  question: "Do you want simple or advanced upgrades? Simple shows what changes for your team and applies the recommended changes, keeping your own edits. Advanced also shows each part's diff, for you to accept or keep.",
  link: "docs/story-map.md#choose-simple-or-advanced-mode",
  option: "story-map settings --upgrade simple|advanced",
} as const;

export interface UpgradeReport {
  /** This version of the package, which every part is compared with. */
  packageVersion: string;
  /** The map the choices are read from, relative to the root. */
  map: string;
  /** The person's choice of mode, from the map's `settings.upgrade`. Left out when nobody has chosen. */
  mode?: UpgradeMode;
  /** When `mode` is left out: the question to ask the person. */
  modeQuestion?: typeof upgradeModeQuestion;
  /** A short overview in plain words, from `templates/changes.yaml`, of what the review would apply. Show it to people as written. */
  overview: UpgradeOverview;
  /** Every part, in the order of `upgradePartIds`. */
  parts: UpgradePart[];
}

export interface UpgradeReportOptions {
  /** Repository root. Defaults to the current directory. */
  root?: string;
  /** The map whose settings hold the choices, relative to the root. Defaults to `product/story-map.yaml`. */
  map?: string;
  /** Earlier templates, for hosts set up before versions were recorded. Defaults to the package's `templates/known-versions.json`. */
  known?: KnownSetupVersions;
  /** The lines the overview is built from. Defaults to the package's `templates/changes.yaml`. */
  changes?: SetupChanges;
}

/** True when a part is behind this version: an outdated file, or an edited one this version also changes. ESM-172's reminder can use it. */
export function isUpgradePartBehind(part: Pick<UpgradePart, "state">) {
  return part.state === "outdated" || part.state === "edited-outdated";
}

const packageRoot = new URL("../", import.meta.url);
const packaged = (path: string) => readFile(new URL(path, packageRoot), "utf8");

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
    throw error;
  }
}

const titles: Record<UpgradePartId, string> = {
  agents: "AGENTS.md section",
  guide: "Guide",
  workflow: "CI workflow",
  skill: "Story map skill",
  plans: "Delivery plans",
  storyIds: "Story ID policy",
};

/** Each stamped part as a sentence names it. */
const nouns: Record<SetupPart, string> = {
  agents: "the story map section",
  guide: "the guide",
  workflow: "the workflow",
};

/**
 * The commands a workflow runs, each keyed by what it does: the
 * `story-map <command>` it calls, or the whole command with its spacing
 * evened out. Comment lines and blank lines in a multi-line `run` are left out.
 */
export function workflowCommands(text: string): Map<string, string> {
  const commands = new Map<string, string>();
  let workflow: unknown;
  try {
    workflow = parseYaml(text);
  } catch {
    return commands;
  }
  const jobs = (workflow as { jobs?: unknown } | null)?.jobs;
  if (!jobs || typeof jobs !== "object") return commands;
  for (const job of Object.values(jobs)) {
    const steps = (job as { steps?: unknown } | null)?.steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      const run = (step as { run?: unknown } | null)?.run;
      if (typeof run !== "string") continue;
      for (const [key, command] of runCommands(run)) if (!commands.has(key)) commands.set(key, command);
    }
  }
  return commands;
}

/** The commands in one step's `run`, keyed as `workflowCommands` keys them. */
export function runCommands(run: string): Map<string, string> {
  const commands = new Map<string, string>();
  for (const line of run.split("\n")) {
    const command = line.trim().replace(/\s+/g, " ");
    if (!command || command.startsWith("#")) continue;
    const storyMap = /(?:^|[\s/])story-map ([a-z][a-z-]*)/.exec(command);
    const key = storyMap ? `story-map ${storyMap[1]}` : command;
    if (!commands.has(key)) commands.set(key, command);
  }
  return commands;
}

/** Template commands the host's workflow does not run, by key. */
function missingSteps(host: string, template: string) {
  const have = workflowCommands(host);
  return [...workflowCommands(template).keys()].filter(key => !have.has(key));
}

interface FileCompare {
  part: SetupPart;
  path: string;
  /** The host's whole file, or undefined when it is not there. */
  text: string | undefined;
  /** This version's template for the host, without a marker. */
  target: string;
  /** Every body that counts as current, such as both forms of the AGENTS.md section. */
  current: string[];
  known: KnownSetupVersions;
}

/** Works out a stamped part's state from ESM-166's reading of its marker. */
function compareFile({ part, path, text, target, current, known }: FileCompare): UpgradePart {
  const base = { part, kind: "file" as const, title: titles[part], path };
  const version = text === undefined ? undefined : readSetupFileVersion(part, text, known);
  if (text === undefined || !version) {
    return { ...base, state: "not-added", change: `add ${nouns[part]}`, recommendation: "add" };
  }
  // A version is only read from a part whose markers were found, so the part has a body.
  const body = present(setupBody(part, text), `the body of ${path}`);
  const from = version.from ? { from: version.from } : {};
  if (current.includes(body)) {
    return { ...base, state: "current", ...from, change: "none", recommendation: "keep", version };
  }
  const diff = unifiedDiff(body, target);
  const additions = part === "workflow" ? missingSteps(body, target) : [];
  const withAdditions = additions.length ? { additions } : {};
  const adding = additions.length ? `, adding the ${additions.join(", ")} ${additions.length === 1 ? "step" : "steps"}` : "";
  if (version.unedited) {
    return { ...base, state: "outdated", ...from, change: `replace with ${storyMapVersion}${adding}`, recommendation: "replace", ...withAdditions, diff, version };
  }
  // Edited. The package changed the part too when the template it came from is not this one's.
  // A workflow is judged by its commands, since hosts change everything else.
  const packageChanged = part === "workflow"
    ? additions.length > 0
    : !version.recordedHash || !current.some(body => setupBodyHash(body) === version.recordedHash);
  if (!packageChanged) {
    return { ...base, state: "edited", ...from, change: "none; your edits are kept", recommendation: "keep", diff, version };
  }
  const since = version.from ? `since ${version.from}` : "since an unknown version";
  const change = part === "workflow"
    ? `add the ${additions.join(", ")} ${additions.length === 1 ? "step" : "steps"}`
    : `${nouns[part]} changed ${since}; compare it with yours`;
  return { ...base, state: "edited-outdated", ...from, change, recommendation: "review", ...withAdditions, diff, version };
}

interface AgentsRuleCompare {
  /** The host's section body. */
  body: string;
  /** This version's section body for the host, without a marker. */
  target: string;
  form: AgentsRuleForm;
  version: SetupFileVersion;
  /** The hashes of every body that counts as current. */
  currentHashes: string[];
  known?: KnownAgentsRules;
}

const openingWords = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 40 ? `${flat.slice(0, 40).trimEnd()}…` : flat;
};

/** The newest version in every list, or undefined when they share none. */
function inferredVersion(lists: string[][]) {
  if (!lists.length) return undefined;
  const shared = lists.reduce((left, right) => left.filter(version => right.includes(version)));
  return shared.sort(compareVersions).at(-1);
}

const ruleTitle = (id: string) => (isAgentsRuleId(id) ? agentsRules[id].title : id);

/**
 * Compares the host's `AGENTS.md` section with this version's, rule by rule.
 *
 * Each host paragraph is matched to a rule by its marker. A paragraph with no
 * marker, as in sections set up before 0.7.8, is matched by its text, against
 * this version's rules and the known rules of earlier releases, and then by
 * its opening words. A rule whose text is an earlier release's is unedited.
 * Whether this version changed a rule since the host's version, or had it
 * then, comes from the version the section came from and the known rules.
 */
export function reviewAgentsRules({ body, target, form, version, currentHashes, known = {} }: AgentsRuleCompare): AgentsRuleReview[] {
  const template = templateRules(target, form).rules;
  const knownVersions = (id: string, text: string) => known[id]?.[agentsRuleHash(text)] ?? [];
  const isKnown = (id: string, text: string) => knownVersions(id, text).length > 0;

  // Match the host's paragraphs to rules: markers first, then text, then opening words.
  const blocks = agentsSectionBlocks(body).filter(block => block.kind === "rule");
  const matched = new Map<string, { text: string; matchedBy: "marker" | "text" | "opening" }>();
  const own: { id?: string; text: string }[] = [];
  const unmarked: string[] = [];
  for (const block of blocks) {
    if (block.id === undefined) unmarked.push(block.text);
    else if (matched.has(block.id)) own.push({ text: block.text });
    else matched.set(block.id, { text: block.text, matchedBy: "marker" });
  }
  const free = (id: string) => !matched.has(id);
  for (const text of unmarked) {
    const hash = agentsRuleHash(text);
    const byText =
      [...template].find(([id, rule]) => free(id) && agentsRuleHash(rule) === hash)?.[0] ??
      Object.keys(known).find(id => free(id) && known[id][hash]);
    const byOpening = byText ? undefined : agentsRuleByOpening(text, form);
    if (byText) matched.set(byText, { text, matchedBy: "text" });
    else if (byOpening && free(byOpening)) matched.set(byOpening, { text, matchedBy: "opening" });
    else own.push({ text });
  }

  // An edited section with no marker comes from an unknown version. Its unedited rules say which
  // release it most likely came from: the newest one that shipped all of them.
  const from = version.from ?? inferredVersion([...matched].map(([id, host]) => knownVersions(id, host.text)).filter(versions => versions.length));
  // The host's section came from this version's template, so no rule changed since.
  const fromCurrent = from === storyMapVersion || (version.recordedHash !== undefined && currentHashes.includes(version.recordedHash));
  const changedSince = (id: string, text: string) => !fromCurrent && !(from && knownVersions(id, text).includes(from));
  const existedAt = (id: string) =>
    fromCurrent || (from ? Object.values(known[id] ?? {}).some(versions => versions.includes(from)) : Object.keys(known[id] ?? {}).length > 0);

  const reviews: AgentsRuleReview[] = [];
  for (const [id, rule] of template) {
    const title = ruleTitle(id);
    const host = matched.get(id);
    if (!host) {
      reviews.push(existedAt(id)
        ? { id, title, state: "removed", recommendation: "keep", change: "none; you removed it", template: rule }
        : { id, title, state: "new", recommendation: "add", change: "add this version's new rule", template: rule });
      continue;
    }
    const base = { id, title, matchedBy: host.matchedBy, text: host.text };
    if (agentsRuleHash(host.text) === agentsRuleHash(rule)) {
      reviews.push({ ...base, state: "current", recommendation: "keep", change: "none" });
    } else if (isKnown(id, host.text)) {
      reviews.push({ ...base, state: "outdated", recommendation: "replace", change: "update to this version's", template: rule, diff: unifiedDiff(`${host.text}\n`, `${rule}\n`) });
    } else if (!changedSince(id, rule)) {
      reviews.push({ ...base, state: "edited", recommendation: "keep", change: "none; your wording is kept" });
    } else {
      reviews.push({ ...base, state: "edited-outdated", recommendation: "review", change: "yours is kept; compare it with this version's", template: rule, diff: unifiedDiff(`${host.text}\n`, `${rule}\n`) });
    }
  }
  for (const [id, host] of matched) {
    if (template.has(id)) continue;
    const base = { id, title: ruleTitle(id), matchedBy: host.matchedBy, text: host.text };
    if (!known[id] && !isAgentsRuleId(id)) reviews.push({ ...base, state: "added", recommendation: "keep", change: "none; your own rule" });
    else if (isKnown(id, host.text)) reviews.push({ ...base, state: "dropped", recommendation: "remove", change: "this version drops it" });
    else reviews.push({ ...base, state: "dropped", recommendation: "review", change: "this version drops it; yours is kept" });
  }
  for (const { text } of own) reviews.push({ title: openingWords(text), state: "added", recommendation: "keep", change: "none; your own rule", text });
  return reviews;
}

/** The rules that need something, counted, such as "2 rules to update, 1 new rule to add, 1 reworded rule to review". */
export function summariseAgentsRules(rules: AgentsRuleReview[]) {
  const count = (test: (rule: AgentsRuleReview) => boolean, one: string, many: string) => {
    const total = rules.filter(test).length;
    return total ? [`${total} ${total === 1 ? one : many}`] : [];
  };
  const parts = [
    ...count(rule => rule.recommendation === "replace", "rule to update", "rules to update"),
    ...count(rule => rule.recommendation === "add", "new rule to add", "new rules to add"),
    ...count(rule => rule.recommendation === "remove", "dropped rule to remove", "dropped rules to remove"),
    ...count(rule => rule.recommendation === "review", "reworded rule to review", "reworded rules to review"),
    ...count(rule => rule.state === "added" || rule.state === "edited", "rule of yours kept", "rules of yours kept"),
  ];
  return parts.length ? parts.join(", ") : "no rule changes";
}

function agentsTemplateBody(text: string) {
  return setupBody("agents", text) ?? "";
}

/** Reads the choices from the map's settings, without validating the rest of the map. */
function mapSettings(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const map = parseYaml(text) as { settings?: unknown } | null;
    return map?.settings && typeof map.settings === "object" ? (map.settings as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function choice(part: "plans" | "storyIds", map: string, settings: Record<string, unknown> | undefined): UpgradePart {
  const base = { part, kind: "choice" as const, title: titles[part], path: map };
  const value = settings?.[part];
  if (value === undefined) {
    const where = part === "plans" ? "docs/story-map.md#choose-whether-to-use-delivery-plans" : "docs/story-map.md#change-the-map-from-the-command-line";
    const change = settings === undefined ? `the map is not there yet; ask once it is (see ${where})` : `ask the person (see ${where})`;
    return { ...base, state: "not-chosen", change, recommendation: "ask" };
  }
  return { ...base, state: "chosen", change: "none; the answer is kept", recommendation: "keep", value };
}

/** This version's template for each part, as it would be written in one host. */
export interface UpgradeTemplates {
  /** True when the host keeps the rules in the skill, so its `AGENTS.md` section is the short pointer. */
  usesSkill: boolean;
  /** This version's `AGENTS.md` section body for the host, without a marker. */
  agents: string;
  /** The guide, without a marker. */
  guide: string;
  /** The workflow for the host, with its `--tests` folder, without a marker. */
  workflow: string;
  /** The skill file. */
  skill: string;
  /** Every body that counts as current: both forms of the section, and the workflow with each `--tests` folder. */
  bodies: { agents: string[]; workflow: string[] };
}

/**
 * This version's templates as they apply to one host: the full rules or the
 * pointer to the skill in `AGENTS.md`, and the workflow with the host's
 * `--tests` folder. Give it the host's current files, or undefined for the
 * ones that are not there.
 */
export async function upgradeTemplates(root: string, host: { agents?: string; workflow?: string; skill?: string }): Promise<UpgradeTemplates> {
  const [fullAgents, skillAgents, guide, workflow, skill] = await Promise.all([
    packaged("templates/AGENTS.md"),
    packaged("templates/AGENTS-skill.md"),
    packaged("docs/story-map.md"),
    packaged("templates/story-map-ci.yml"),
    skillFile(),
  ]);
  // The host keeps the rules as a skill when it has the skill or its section points to one.
  const usesSkill = host.skill !== undefined || (host.agents !== undefined && (setupBody("agents", host.agents) ?? "").includes(skillPath));
  const agentsBodies = [agentsTemplateBody(fullAgents), agentsTemplateBody(skillAgents)];
  const folder = await testFolder(root);
  const testsInHost = host.workflow ? /--tests (\S+)/.exec(host.workflow)?.[1] : undefined;
  return {
    usesSkill,
    agents: usesSkill ? agentsBodies[1] : agentsBodies[0],
    guide,
    workflow: workflowWithTests(workflow, testsInHost ?? folder),
    skill,
    bodies: {
      agents: agentsBodies,
      workflow: [undefined, "test", "tests", "__tests__", ...(testsInHost ? [testsInHost] : [])].map(name => workflowWithTests(workflow, name)),
    },
  };
}

/**
 * Reports the state of each part of a host's set-up, compared with this
 * version of the package. It reads the repository and writes nothing.
 *
 * Files `init` stamps are read with `readSetupFileVersion`, so a part whose
 * body is a template the package shipped counts as unedited, and anything
 * else as edited. The workflow is also compared by the commands its steps
 * run, so a missing step is reported as an addition. The skill records no
 * version: one that differs from this version's is reported as
 * `edited-outdated`, since an edit cannot be told apart from an old copy.
 */
export async function upgradeReport(options: UpgradeReportOptions = {}): Promise<UpgradeReport> {
  const root = await realpath(options.root ?? ".");
  const mapPath = options.map ?? "product/story-map.yaml";
  const known = options.known ?? (await loadKnownSetupVersions());
  const at = (path: string) => readOptional(join(root, path));

  const [agentsText, guideText, workflowText, skillText, mapText] = await Promise.all(
    ["AGENTS.md", "docs/story-map.md", ".github/workflows/story-map.yml", skillPath, mapPath].map(at),
  );
  const targets = await upgradeTemplates(root, { agents: agentsText, workflow: workflowText, skill: skillText });
  const { usesSkill, bodies: { agents: agentsBodies, workflow: workflowBodies } } = targets;
  const [agentsTarget, guide, workflowTarget, skill] = [targets.agents, targets.guide, targets.workflow, targets.skill];

  const agents = compareFile({ part: "agents", path: "AGENTS.md", text: agentsText, target: agentsTarget, current: agentsBodies, known });
  const agentsBody = agentsText === undefined ? undefined : setupBody("agents", agentsText);
  if (agents.version && agentsBody !== undefined && ["outdated", "edited", "edited-outdated"].includes(agents.state)) {
    agents.rules = reviewAgentsRules({
      body: agentsBody,
      target: agentsTarget,
      form: usesSkill ? "skill" : "full",
      version: agents.version,
      currentHashes: agentsBodies.map(setupBodyHash),
      known: known.rules,
    });
    if (agents.state === "edited-outdated") {
      agents.change = `the story map section changed ${agents.from ? `since ${agents.from}` : "since an unknown version"}: ${summariseAgentsRules(agents.rules)}`;
    }
  }
  const parts: UpgradePart[] = [
    agents,
    compareFile({ part: "guide", path: "docs/story-map.md", text: guideText, target: guide, current: [guide], known }),
    compareFile({ part: "workflow", path: ".github/workflows/story-map.yml", text: workflowText, target: workflowTarget, current: workflowBodies, known }),
  ];

  const skillBase = { part: "skill" as const, kind: "file" as const, title: titles.skill, path: skillPath };
  if (skillText === undefined) {
    parts.push(usesSkill
      ? { ...skillBase, state: "not-added", change: "add the skill your AGENTS.md section points to", recommendation: "add" }
      : { ...skillBase, state: "not-added", change: "none; AGENTS.md has the full rules (see Install a story map skill)", recommendation: "optional" });
  } else if (skillText.replace(/\r\n?/g, "\n") === skill) {
    parts.push({ ...skillBase, state: "current", change: "none", recommendation: "keep" });
  } else {
    parts.push({ ...skillBase, state: "edited-outdated", change: "differs from this version's skill, which records no version; compare it with yours", recommendation: "review", diff: unifiedDiff(skillText.replace(/\r\n?/g, "\n"), skill) });
  }

  const settings = mapSettings(mapText);
  parts.push(choice("plans", mapPath, settings), choice("storyIds", mapPath, settings));
  const overview = upgradeOverview(parts, options.changes ?? (await loadSetupChanges()), storyMapVersion);
  const mode = settings?.upgrade === "simple" || settings?.upgrade === "advanced" ? settings.upgrade : undefined;
  return { packageVersion: storyMapVersion, map: mapPath, ...(mode ? { mode } : { modeQuestion: upgradeModeQuestion }), overview, parts };
}

const stateWords: Record<UpgradePartState, string> = {
  "not-added": "not added",
  current: "current",
  outdated: "outdated",
  edited: "edited",
  "edited-outdated": "edited and outdated",
  "not-chosen": "not chosen",
  chosen: "chosen",
};

/** The state in words, with the version it came from, such as "edited, from 0.7.5". */
export function describeUpgradeState(part: UpgradePart) {
  const words = stateWords[part.state];
  if (part.kind === "choice") return part.state === "chosen" ? `${words}: ${JSON.stringify(part.value)}` : words;
  if (part.state === "not-added" || (part.state === "current" && !part.from)) return words;
  return `${words}, from ${part.from ?? "an unknown version"}`;
}
