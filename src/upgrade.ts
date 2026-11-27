import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { unifiedDiff } from "./edit.js";
import { skillFile, skillPath, testFolder, workflowWithTests } from "./init.js";
import { loadKnownSetupVersions, readSetupFileVersion, setupBody, setupBodyHash, type KnownSetupVersions, type SetupFileVersion, type SetupPart } from "./setup-versions.js";
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
}

/** The state of each part of a host's set-up, as `story-map upgrade` reports it. */
export interface UpgradeReport {
  /** This version of the package, which every part is compared with. */
  packageVersion: string;
  /** The map the choices are read from, relative to the root. */
  map: string;
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
      for (const line of run.split("\n")) {
        const command = line.trim().replace(/\s+/g, " ");
        if (!command || command.startsWith("#")) continue;
        const storyMap = /(?:^|[\s/])story-map ([a-z][a-z-]*)/.exec(command);
        const key = storyMap ? `story-map ${storyMap[1]}` : command;
        if (!commands.has(key)) commands.set(key, command);
      }
    }
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
  if (!version) {
    return { ...base, state: "not-added", change: `add ${nouns[part]}`, recommendation: "add" };
  }
  const body = setupBody(part, text!)!;
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
  const [fullAgents, skillAgents, guide, workflow, skill] = await Promise.all([
    packaged("templates/AGENTS.md"),
    packaged("templates/AGENTS-skill.md"),
    packaged("docs/story-map.md"),
    packaged("templates/story-map-ci.yml"),
    skillFile(),
  ]);

  // The host keeps the rules as a skill when it has the skill or its section points to one.
  const usesSkill = skillText !== undefined || (agentsText !== undefined && (setupBody("agents", agentsText) ?? "").includes(skillPath));
  const agentsBodies = [agentsTemplateBody(fullAgents), agentsTemplateBody(skillAgents)];

  const folder = await testFolder(root);
  const testsInHost = workflowText ? /--tests (\S+)/.exec(workflowText)?.[1] : undefined;
  const workflowTarget = workflowWithTests(workflow, testsInHost ?? folder);
  const workflowBodies = [undefined, "test", "tests", "__tests__", ...(testsInHost ? [testsInHost] : [])].map(name => workflowWithTests(workflow, name));

  const parts: UpgradePart[] = [
    compareFile({ part: "agents", path: "AGENTS.md", text: agentsText, target: usesSkill ? agentsBodies[1] : agentsBodies[0], current: agentsBodies, known }),
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
  return { packageVersion: storyMapVersion, map: mapPath, overview, parts };
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
