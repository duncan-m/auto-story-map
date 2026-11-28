import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentsSection, workflowWithTests } from "./init.js";
import { compareVersions, loadKnownSetupVersions, readSetupFileVersion, setupBody, setupBodyHash, setupParts, type KnownSetupVersions, type SetupFileVersion, type SetupPart } from "./setup-versions.js";
import { workflowCommands } from "./upgrade.js";
import { storyMapVersion } from "./version.js";

/** Where each part lives in a host repository. */
export const setupPartPaths: Record<SetupPart, string> = {
  agents: "AGENTS.md",
  guide: "docs/story-map.md",
  workflow: ".github/workflows/story-map.yml",
};

/** One part of a host's set-up that came from an older version, whose template has changed since. */
export interface SetupPartBehind {
  part: SetupPart;
  /** The file, relative to the repository root. */
  path: string;
  /** The version the part came from. */
  from: string;
}

const packageRoot = new URL("../", import.meta.url);
const packaged = (path: string) => readFile(new URL(path, packageRoot), "utf8");

let currentTemplates: Promise<Record<SetupPart, Set<string>>> | undefined;

/**
 * The body hashes of every template this version can write for each part: both
 * forms of the `AGENTS.md` section, the guide, and the workflow with and
 * without each `--tests` folder that `init` picks.
 */
export function currentSetupTemplateHashes(): Promise<Record<SetupPart, Set<string>>> {
  currentTemplates ??= (async () => {
    const workflow = await packaged("templates/story-map-ci.yml");
    const bodies: Record<SetupPart, (string | undefined)[]> = {
      agents: [agentsSection(await packaged("templates/AGENTS.md")), agentsSection(await packaged("templates/AGENTS-skill.md"))],
      guide: [setupBody("guide", await packaged("docs/story-map.md"))],
      workflow: [undefined, "test", "tests", "__tests__"].map(folder => setupBody("workflow", workflowWithTests(workflow, folder))),
    };
    return Object.fromEntries(setupParts.map(part => [part, new Set(bodies[part].filter(body => body !== undefined).map(setupBodyHash))])) as Record<SetupPart, Set<string>>;
  })();
  return currentTemplates;
}

/**
 * True when a part came from a version older than `packageVersion` and the
 * template it came from is not one this version writes. The template is the
 * recorded hash, or, for a part from before versions were recorded, the known
 * earlier template its body matches. An unmarked part that matches no known
 * template is from an unknown version, so it is never called behind.
 */
export function isSetupPartBehind(version: SetupFileVersion, current: ReadonlySet<string>, packageVersion: string = storyMapVersion): boolean {
  if (!version.from || compareVersions(version.from, packageVersion) >= 0) return false;
  const template = version.recordedHash ?? (version.knownVersions.length ? version.hash : undefined);
  return template !== undefined && !current.has(template);
}

/** Options for `findSetupBehind`, mainly for tests. */
export interface FindSetupBehindOptions {
  known?: KnownSetupVersions;
  current?: Record<SetupPart, ReadonlySet<string>>;
  packageVersion?: string;
}

/**
 * True when a host's workflow runs every command this version's template
 * runs. An edited workflow like that is not behind, since `story-map upgrade`
 * compares workflows by their commands and would offer nothing.
 */
async function runsEveryStep(text: string) {
  const template = workflowWithTests(await packaged("templates/story-map-ci.yml"), /--tests (\S+)/.exec(text)?.[1]);
  const have = workflowCommands(text);
  return [...workflowCommands(template).keys()].every(key => have.has(key));
}

/**
 * The parts of the set-up in `root` that are behind the installed package. A
 * missing or unreadable file, or an `AGENTS.md` without the story map section,
 * is left out, and so is an edited workflow that already runs every step,
 * matching `isUpgradePartBehind` in the upgrade report.
 */
export async function findSetupBehind(root: string, options: FindSetupBehindOptions = {}): Promise<SetupPartBehind[]> {
  const known = options.known ?? await loadKnownSetupVersions();
  const current = options.current ?? await currentSetupTemplateHashes();
  const behind: SetupPartBehind[] = [];
  for (const part of setupParts) {
    const path = setupPartPaths[part];
    const text = await readFile(join(root, path), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const version = readSetupFileVersion(part, text, known);
    if (!version?.from || !isSetupPartBehind(version, current[part], options.packageVersion)) continue;
    if (part === "workflow" && !version.unedited && await runsEveryStep(text)) continue;
    behind.push({ part, path, from: version.from });
  }
  return behind;
}

const partNames: Record<SetupPart, string> = {
  agents: "the story map section of AGENTS.md",
  guide: "docs/story-map.md",
  workflow: ".github/workflows/story-map.yml",
};

const listed = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The one notice `validate` prints for the parts that are behind, naming each of them. */
export function setupBehindMessage(behind: readonly SetupPartBehind[], packageVersion: string = storyMapVersion): string {
  const versions = [...new Set(behind.map(item => item.from))].sort(compareVersions);
  const parts = behind.map(item => versions.length > 1 ? `${partNames[item.part]} (from ${item.from})` : partNames[item.part]);
  return `This repository's set-up is from ${listed(versions)}, and the package is ${packageVersion}, which changes ${listed(parts)}. Run \`story-map upgrade\` to see what changes.`;
}
