import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseStoryMapHistory, type StoryMapHistory } from "../history.js";
import type { ReferenceIssue } from "../references.js";
import { describeIssueTarget, loadStoryMap, StoryMapValidationError, type LoadedStoryMap } from "../schema.js";
import { parseStoryMapTests, type StoryMapTests } from "../tests-index.js";

/** A problem with the command line, reported before the command's usage text. Exits 2. */
export class ArgumentError extends Error {}

/** A problem with what the command was asked to read, such as a Git reference. Exits 2 without the usage text. */
export class UsageError extends Error {}

/** One subcommand: its parser and what it runs. A parser returns null when the arguments do not fit its usage. */
export interface Command<Options> {
  parse(rest: string[]): Options | null;
  run(options: Options): Promise<void>;
}

export const defineCommand = <Options>(command: Command<Options>) => command;

/**
 * Reads `--name value` and `--name=value`. A missing value, or a next argument
 * that is another option, such as `--map --strict`, is an error rather than
 * the value. Use `--name=-value` for a value that starts with a hyphen.
 */
export function optionValue(rest: string[], index: number, name: string): [string, number] {
  const arg = rest[index];
  const [value, next] = arg === name ? [rest[index + 1], index + 1] : [arg.slice(name.length + 1), index];
  if (!value || (arg === name && value.startsWith("-"))) throw new ArgumentError(`${name} needs a value`);
  return [value, next];
}

/** Text output is `text`, the default for people, or `json` for agents and scripts. */
export function readFormat<Format extends string>(value: string, formats: readonly Format[]): Format {
  if (!formats.includes(value as Format)) throw new ArgumentError(`--format must be ${formats.join(" or ")}, not ${value}`);
  return value as Format;
}

// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
export function escapeData(value: string) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
export function escapeProperty(value: string) {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// Map text reaches diagnostics, so a line break or terminal control in it must not start what looks like another record.
export function escapeText(value: string) {
  return value.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/g, char =>
    char === "\n" ? "\\n" : char === "\r" ? "\\r" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Escapes each line of multi-line map text, such as notes, keeping its line breaks. */
export function escapeLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n").map(escapeText);
}

export type ReportFormat = "text" | "github";

/** Prints one issue: `file:line:column: problem` on stderr, or a GitHub Actions annotation on stdout. */
export function report(mapPath: string, issue: ReferenceIssue, format: ReportFormat = "text") {
  const path = issue.file ?? mapPath;
  const message = issue.path.length ? `${describeIssueTarget(issue)}: ${issue.message}` : issue.message;
  const warning = issue.severity === "warning";
  if (format === "github") {
    const properties = [`file=${escapeProperty(path)}`];
    if (issue.line) properties.push(`line=${issue.line}`);
    if (issue.column) properties.push(`col=${issue.column}`);
    properties.push("title=Story map");
    console.log(`::${warning ? "warning" : "error"} ${properties.join(",")}::${escapeData(message)}`);
  } else {
    const position = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ""}` : "";
    console.error(`${escapeText(path)}${position}: ${warning ? "warning: " : ""}${escapeText(message)}`);
  }
}

/** Prints a problem with a file that is not the map, such as an unreadable history file. */
export function reportFile(path: string, error: unknown) {
  console.error(`${escapeText(path)}: ${escapeText(error instanceof Error ? error.message : String(error))}`);
}

/** Reads and validates the map, printing its errors and setting exit code 1 when it cannot be used. */
export async function loadMapOrReport(path: string): Promise<LoadedStoryMap | null> {
  try {
    return loadStoryMap(await readFile(path, "utf8"));
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof StoryMapValidationError) {
      for (const issue of error.issues) report(path, issue);
    } else {
      reportFile(path, error);
    }
    return null;
  }
}

/** Reads the optional history and tests index files. Returns null, with exit code 1, when either cannot be read. */
export async function loadInputsOrReport(paths: { history?: string; tests?: string }): Promise<{ history?: StoryMapHistory; tests?: StoryMapTests } | null> {
  const inputs: { history?: StoryMapHistory; tests?: StoryMapTests } = {};
  for (const [key, path, parse] of [["history", paths.history, parseStoryMapHistory], ["tests", paths.tests, parseStoryMapTests]] as const) {
    if (!path) continue;
    try {
      (inputs as Record<string, unknown>)[key] = parse(await readFile(path, "utf8"));
    } catch (error) {
      reportFile(path, error);
      process.exitCode = 1;
      return null;
    }
  }
  return inputs;
}

/** Writes to stdout when `out` is absent or `-`, otherwise to the file, creating its folder. Returns true when it wrote a file. */
export async function writeOutput(text: string | Uint8Array, out?: string): Promise<boolean> {
  if (!out || out === "-") {
    process.stdout.write(text);
    return false;
  }
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, text);
  return true;
}

/** Prints a JSON document tagged with `format: "auto-story-map.<kind>"` and `version: 1`, so agents can check what they got. */
export function printJson(kind: string, body: object) {
  process.stdout.write(`${JSON.stringify({ format: `auto-story-map.${kind}`, version: 1, ...body }, null, 2)}\n`);
}

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Joins words as “a, b and c”. */
export function listWords(words: string[]) {
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] ?? "";
}
