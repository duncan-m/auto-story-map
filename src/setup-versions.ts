import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { agentsRuleForm, agentsRuleHash, templateRules, type AgentsRuleForm, type KnownAgentsRules } from "./agents-rules.js";

/**
 * The parts of a host's set-up that `story-map init` writes from a template
 * and stamps with the version it came from:
 *
 * - `agents`: the story map section of `AGENTS.md`, between its markers
 * - `guide`: `docs/story-map.md`
 * - `workflow`: `.github/workflows/story-map.yml`
 */
export type SetupPart = "agents" | "guide" | "workflow";

export const setupParts: readonly SetupPart[] = ["agents", "guide", "workflow"];

/**
 * The hash of each template an earlier release shipped, for each part, mapped
 * to the versions that shipped it, oldest first. The package ships it as
 * `templates/known-versions.json`, generated from the release tags by
 * `scripts/known-versions.mjs`.
 */
export type KnownSetupVersions = Record<SetupPart, Record<string, string[]>> & {
  /**
   * The hash of each rule in the earlier `AGENTS.md` templates, by rule ID,
   * mapped to the versions that shipped it. The upgrade review compares a
   * host's section rule by rule with it. Left out, every rule the host has
   * that differs from this version's counts as edited.
   */
  rules?: KnownAgentsRules;
};

/** What a host's copy of a part says about where it came from. */
export interface SetupFileVersion {
  part: SetupPart;
  /** The version recorded in the file's marker or first line, if any. Files from before 0.7.8 have none. */
  recordedVersion?: string;
  /** The template hash recorded with it, such as `sha256:…`, if any. */
  recordedHash?: string;
  /** The hash of the file's body as it is now, worked out the same way. */
  hash: string;
  /** True when the body matches the recorded hash. */
  matchesRecorded: boolean;
  /** Earlier releases whose template has exactly this body, oldest first. */
  knownVersions: string[];
  /**
   * True when the body is a template the package shipped: it matches the
   * recorded hash or a known earlier template. Such a part is safe to replace.
   * False means the host edited it.
   */
  unedited: boolean;
  /**
   * The version the part came from: the recorded one when there is one,
   * otherwise the newest earlier release whose template matches. Left out for
   * an unmarked part that matches no known template, which counts as edited,
   * from an unknown version.
   */
  from?: string;
}

const agentsStart = /<!-- auto-story-map:start(?:[ \t]+([^\s>]+))?(?:[ \t]+(sha256:[0-9a-f]{64}))?[ \t]*-->/;
const agentsEnd = "<!-- auto-story-map:end -->";
const firstLine: Record<"guide" | "workflow", RegExp> = {
  guide: /^<!-- auto-story-map (\S+) (sha256:[0-9a-f]{64}) -->\n/,
  workflow: /^# auto-story-map (\S+) (sha256:[0-9a-f]{64})\n/,
};

const normalise = (text: string) => text.replace(/\r\n?/g, "\n");

/** The hash recorded for a part's body: `sha256:` and the hex digest of the body with line endings evened out. */
export function setupBodyHash(body: string) {
  return `sha256:${createHash("sha256").update(normalise(body), "utf8").digest("hex")}`;
}

/** True when the text has a story map section start marker, with or without a version. */
export function hasAgentsSection(text: string) {
  return agentsStart.test(text);
}

interface SplitFile {
  version?: string;
  hash?: string;
  body: string;
}

/**
 * Splits a host's copy of a part into its recorded version and hash and the
 * body they describe. For `agents` the body is the text between the start
 * marker's line and the end marker, so the rest of `AGENTS.md` is ignored.
 * For the guide and the workflow it is everything after the first line, or
 * the whole file when the first line records no version.
 */
function splitSetupFile(part: SetupPart, text: string): SplitFile | undefined {
  const normal = normalise(text);
  if (part === "agents") {
    const start = agentsStart.exec(normal);
    if (!start) return undefined;
    const lineEnd = normal.indexOf("\n", start.index + start[0].length);
    const bodyStart = lineEnd === -1 ? normal.length : lineEnd + 1;
    const end = normal.indexOf(agentsEnd, bodyStart);
    if (end === -1) return undefined;
    return { version: start[1], hash: start[2], body: normal.slice(bodyStart, end) };
  }
  const marker = firstLine[part].exec(normal);
  if (!marker) return { body: normal };
  return { version: marker[1], hash: marker[2], body: normal.slice(marker[0].length) };
}

/**
 * Replaces the story map section of a whole `AGENTS.md` with `section`, a
 * section with its markers, leaving the rest of the file byte for byte as it
 * is. A file with Windows line endings keeps them. Returns undefined when the
 * file has no complete section.
 */
export function replaceAgentsSection(text: string, section: string): string | undefined {
  const start = agentsStart.exec(text);
  if (!start) return undefined;
  const lineEnd = text.indexOf("\n", start.index + start[0].length);
  const end = text.indexOf(agentsEnd, lineEnd === -1 ? text.length : lineEnd + 1);
  if (lineEnd === -1 || end === -1) return undefined;
  const old = text.slice(start.index, end + agentsEnd.length);
  const replacement = normalise(section).replace(/\n$/, "");
  return text.slice(0, start.index) + (old.includes("\r\n") ? replacement.replace(/\n/g, "\r\n") : replacement) + text.slice(end + agentsEnd.length);
}

/** The body of a template or a host's copy, without any version marker, as the hash covers it. */
export function setupBody(part: SetupPart, text: string): string | undefined {
  return splitSetupFile(part, text)?.body;
}

/**
 * Reads where a host's copy of a part came from.
 *
 * Give it the whole file: all of `AGENTS.md`, or the guide or workflow as
 * they are. It returns the version and hash recorded in the file, the hash of
 * the body now, and whether that body is one the package shipped, either the
 * one recorded or, for files set up before versions were recorded, one of the
 * `known` earlier templates. Without `known`, only the recorded hash counts.
 *
 * Returns undefined for an `AGENTS.md` with no complete story map section.
 */
export function readSetupFileVersion(part: SetupPart, text: string, known?: KnownSetupVersions): SetupFileVersion | undefined {
  const split = splitSetupFile(part, text);
  if (!split) return undefined;
  const hash = setupBodyHash(split.body);
  const matchesRecorded = split.hash === hash;
  const knownVersions = [...(known?.[part]?.[hash] ?? [])];
  const unedited = matchesRecorded || knownVersions.length > 0;
  const from = split.version ?? knownVersions.at(-1);
  return {
    part,
    ...(split.version ? { recordedVersion: split.version } : {}),
    ...(split.hash ? { recordedHash: split.hash } : {}),
    hash,
    matchesRecorded,
    knownVersions,
    unedited,
    ...(from ? { from } : {}),
  };
}

/**
 * Records the version and the body's hash in a part's template, as `init`
 * writes it: in the `AGENTS.md` start marker, or as a comment on the first
 * line of the guide and the workflow. Any marker already there is replaced.
 *
 * `templateHash` records the template the body is based on instead of the
 * body's own hash. `story-map upgrade` gives it when the body keeps the
 * host's edits on top of this version's template, so the part still reads as
 * edited, from this version, and its edits are never replaced as unedited.
 */
export function stampSetupFile(part: SetupPart, text: string, version: string, templateHash?: string): string {
  const normal = normalise(text);
  const body = setupBody(part, normal);
  if (body === undefined) throw new Error("The AGENTS.md template has no complete story map section");
  // A body that keeps the host's edits records the template it is based on, so it still reads as edited.
  const hash = templateHash ?? setupBodyHash(body);
  if (part === "agents") return normal.replace(agentsStart, `<!-- auto-story-map:start ${version} ${hash} -->`);
  const line = part === "guide" ? `<!-- auto-story-map ${version} ${hash} -->` : `# auto-story-map ${version} ${hash}`;
  return `${line}\n${body}`;
}

/** Reads `templates/known-versions.json` from the installed package. */
export async function loadKnownSetupVersions(): Promise<KnownSetupVersions> {
  const raw = JSON.parse(await readFile(new URL("../templates/known-versions.json", import.meta.url), "utf8")) as Partial<KnownSetupVersions>;
  return { agents: raw.agents ?? {}, guide: raw.guide ?? {}, workflow: raw.workflow ?? {}, rules: raw.rules ?? {} };
}

/** One template a release shipped, for building the known versions. */
export interface ReleasedSetupTemplate {
  part: SetupPart;
  version: string;
  text: string;
  /** For `agents`: which template it is. Left out, a body that links to the skill is the short pointer. */
  form?: AgentsRuleForm;
}

/** Orders release versions such as `0.7.10` after `0.7.9`: negative when `a` is older, positive when newer. */
export function compareVersions(a: string, b: string) {
  const parts = (version: string) => version.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/**
 * Builds the contents of `templates/known-versions.json` from the templates
 * earlier releases shipped. Several templates may share a body, and so a
 * hash: their versions are listed together, oldest first.
 */
export function knownSetupVersionsFrom(templates: Iterable<ReleasedSetupTemplate>): KnownSetupVersions {
  const known: KnownSetupVersions & { rules: KnownAgentsRules } = { agents: {}, guide: {}, workflow: {}, rules: {} };
  const add = (hashes: Record<string, string[]>, hash: string, version: string) => {
    hashes[hash] ??= [];
    const versions = hashes[hash];
    if (!versions.includes(version)) versions.push(version);
  };
  for (const { part, version, text, form } of templates) {
    const body = setupBody(part, text);
    if (body === undefined) continue;
    add(known[part], setupBodyHash(body), version);
    if (part !== "agents") continue;
    for (const [id, rule] of templateRules(body, form ?? agentsRuleForm(body)).rules) {
      known.rules[id] ??= {};
      add(known.rules[id], agentsRuleHash(rule), version);
    }
  }
  const sorted = (hashes: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(hashes)
        .map(([hash, versions]) => [hash, versions.sort(compareVersions)] as const)
        .sort(([hashA, a], [hashB, b]) => compareVersions(a[0]!, b[0]!) || compareVersions(a.at(-1)!, b.at(-1)!) || (hashA < hashB ? -1 : 1)),
    );
  for (const part of setupParts) known[part] = sorted(known[part]);
  known.rules = Object.fromEntries(Object.keys(known.rules).sort().map(id => [id, sorted(known.rules[id])]));
  return known;
}
