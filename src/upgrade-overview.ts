import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { compareVersions } from "./setup-versions.js";
import type { UpgradePart, UpgradePartId } from "./upgrade.js";

/** The parts `templates/changes.yaml` has lines for. The choices are asked, not described. */
export type SetupChangePart = Exclude<UpgradePartId, "plans" | "storyIds">;

export const setupChangeParts: readonly SetupChangePart[] = ["agents", "guide", "workflow", "skill"];

/**
 * The plain-words lines the upgrade overview is built from, as shipped in
 * `templates/changes.yaml`: what each part does for a team, and what each
 * release changed in each part.
 */
export interface SetupChanges {
  /** One line for each part, shown when the part is being added. */
  install: Record<SetupChangePart, string>;
  /** For each version, the lines for each part it changed. */
  releases: Record<string, Partial<Record<SetupChangePart, string[]>>>;
}

/**
 * The short overview at the top of the upgrade review, in plain words for the
 * people who use the set-up. Show it to them as written.
 *
 * - `install`: nothing is set up yet, so it says how the set-up works
 * - `upgrade`: it says what changes for the team, for only the parts being applied
 * - `current`: nothing is applied
 */
export interface UpgradeOverview {
  kind: "install" | "upgrade" | "current";
  /** Such as "What changes for you since 0.7.5". */
  heading: string;
  /** One sentence each, at most `maxOverviewLines`. */
  lines: string[];
  /** The parts the host edited that this version also changes, which are kept as they are. */
  kept?: string;
  /** The product choices still to make. */
  decide?: string;
  /** Where to read more. */
  more: string;
}

/** The most lines the overview lists, so it stays short. */
export const maxOverviewLines = 8;

const packageRoot = new URL("../", import.meta.url);

/** Checks the shape of a parsed `changes.yaml`, naming the first problem. */
export function parseSetupChanges(text: string): SetupChanges {
  const data = parseYaml(text) as Partial<SetupChanges> | null;
  const isText = (value: unknown) => typeof value === "string" && value.trim() !== "";
  if (!data || typeof data.install !== "object" || data.install === null) throw new Error("changes.yaml needs an install section");
  for (const part of setupChangeParts) {
    if (!isText(data.install[part])) throw new Error(`changes.yaml has no install line for ${part}`);
  }
  if (!data.releases || typeof data.releases !== "object") throw new Error("changes.yaml needs a releases section");
  for (const [version, parts] of Object.entries(data.releases)) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`changes.yaml release ${version} is not a version such as 0.7.8`);
    if (!parts || typeof parts !== "object") throw new Error(`changes.yaml release ${version} has no parts`);
    for (const [part, lines] of Object.entries(parts)) {
      if (!setupChangeParts.includes(part as SetupChangePart)) throw new Error(`changes.yaml release ${version} names an unknown part ${part}`);
      if (!Array.isArray(lines) || !lines.length || !lines.every(isText)) throw new Error(`changes.yaml release ${version} needs a list of lines for ${part}`);
    }
  }
  return data as SetupChanges;
}

let shipped: Promise<SetupChanges> | undefined;

/** Reads `templates/changes.yaml` from the package. */
export function loadSetupChanges(): Promise<SetupChanges> {
  shipped ??= readFile(new URL("templates/changes.yaml", packageRoot), "utf8").then(parseSetupChanges);
  return shipped;
}

/** The lines for one part from every release newer than `from`, newest first. */
function releaseLines(changes: SetupChanges, part: SetupChangePart, from: string | undefined) {
  return Object.entries(changes.releases)
    .filter(([version]) => from === undefined || compareVersions(version, from) > 0)
    .sort(([a], [b]) => compareVersions(b, a))
    .map(([version, parts]) => ({ version, lines: parts[part] ?? [] }));
}

const listed = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const choiceWords: Partial<Record<UpgradePartId, string>> = {
  plans: "whether to use delivery plans",
  storyIds: "the story ID policy",
};

/**
 * True when simple mode updates part of an edited `AGENTS.md` section: the
 * rules the host left as an earlier release wrote them, new rules, and rules
 * this version drops.
 */
const mergesRules = (part: UpgradePart) =>
  part.part === "agents" && !!part.rules?.some(rule => rule.recommendation === "replace" || rule.recommendation === "add" || rule.recommendation === "remove");

/**
 * Builds the overview from the report's parts and the shipped lines. Only the
 * parts the review would apply count: a part being added gets its install
 * line, an outdated one the lines from each release since it came from, an
 * edited workflow the lines for the steps it gains, and an edited `AGENTS.md`
 * section the lines for its rules that simple mode updates. Parts the host edited that
 * this version also changes are kept, and the choices are asked, so both are
 * named after the lines instead.
 */
export function upgradeOverview(parts: readonly UpgradePart[], changes: SetupChanges, packageVersion: string): UpgradeOverview {
  const files = parts.filter(part => part.kind === "file");
  const install = files.filter(part => part.part !== "skill").every(part => part.state === "not-added");

  const added: string[] = [];
  const byVersion: { version: string; order: number; lines: string[] }[] = [];
  const froms: string[] = [];
  const kept: string[] = [];
  files.forEach((part, order) => {
    const id = part.part as SetupChangePart;
    if (part.recommendation === "add") {
      added.push(changes.install[id]);
    } else if (part.recommendation === "replace" || (part.recommendation === "review" && (part.additions?.length || mergesRules(part)))) {
      const releases = releaseLines(changes, id, part.from).filter(release => release.lines.length);
      if (part.from) froms.push(part.from);
      if (releases.length) byVersion.push(...releases.map(release => ({ ...release, order })));
      else if (part.additions?.length) byVersion.push({ version: packageVersion, order, lines: [`CI runs the ${listed(part.additions)} ${part.additions.length === 1 ? "step" : "steps"} too.`] });
      // An edited section whose unchanged rules are updated still keeps the rules the host reworded.
      if (part.rules?.some(rule => rule.recommendation === "review")) kept.push(`${part.title} (your reworded rules)`);
    } else if (part.recommendation === "review") {
      kept.push(part.title);
    }
  });
  byVersion.sort((a, b) => compareVersions(b.version, a.version) || a.order - b.order);
  const all = [...new Set([...added, ...byVersion.flatMap(release => release.lines)])];
  const lines = all.length > maxOverviewLines
    ? [...all.slice(0, maxOverviewLines - 1), `And ${all.length - maxOverviewLines + 1} more changes from earlier releases.`]
    : all;

  const decide = parts.filter(part => part.state === "not-chosen").map(part => choiceWords[part.part]).filter((words): words is string => !!words);
  const since = froms.sort(compareVersions)[0];
  const kind = install ? "install" : lines.length ? "upgrade" : "current";
  const heading = kind === "install"
    ? "How Auto Story Map works in this repository"
    : kind === "upgrade"
      ? since ? `What changes for you since ${since}` : `What changes for you with ${packageVersion}`
      : `Nothing to change: your set-up is up to date with ${packageVersion}`;
  return {
    kind,
    heading,
    lines,
    ...(kept.length ? { kept: `Kept as you have them: ${kept.length === 1 ? "1 part" : `${kept.length} parts`} you edited, ${listed(kept)}. Run story-map upgrade --diff to compare ${kept.length === 1 ? "it" : "them"} with this version.` } : {}),
    ...(decide.length ? { decide: `To decide: ${listed(decide)}.` } : {}),
    more: install ? "More: docs/story-map.md" : "More: docs/story-map.md#review-the-set-up-after-an-upgrade",
  };
}

/** The overview as lines of text: the heading, a bullet for each line, then what is kept, what to decide and where to read more. */
export function upgradeOverviewLines(overview: UpgradeOverview, bullet = "- "): string[] {
  const notes = [overview.kept, overview.decide].filter((note): note is string => !!note);
  return [
    overview.heading,
    ...(overview.lines.length ? ["", ...overview.lines.map(line => `${bullet}${line}`)] : []),
    "",
    ...notes,
    overview.more,
  ];
}
