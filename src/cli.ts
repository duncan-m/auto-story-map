#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { diffStoryMaps, formatStoryMapDiff } from "./diff.js";
import { buildStoryMapHistory, StoryMapHistoryError } from "./history-git.js";
import { initStoryMap } from "./init.js";
import { checkPlanReferences, checkSources, type ReferenceIssue } from "./references.js";
import {
  describeIssueTarget,
  loadStoryMap,
  parseStoryMap,
  StoryMapValidationError,
  type StoryMapDocument,
} from "./schema.js";

const usage = `Usage:
  story-map init [--no-ci] [--dir <path>]
  story-map validate [--format text|github] [--strict] [--check-sources] [--plans <path>] <map.yaml> [...]
  story-map diff [--format markdown|json] [--map <path>] <base-ref>
  story-map history [--map <path>] [--ref <ref>] [--out <file>] [--bot-names <names>] [--allow-shallow]

init
  Sets up a host repository: a starter product/story-map.yaml, the story map
  guide in docs/story-map.md, a story map section in AGENTS.md and a GitHub
  Actions workflow that validates the map. Existing files are never overwritten.

  --no-ci          Skip the GitHub Actions workflow.
  --dir <path>     Repository root. Defaults to the current directory.

validate
  Errors make the map invalid and exit 1. Warnings, such as a blocked story
  with no statusReason, are printed but exit 0 unless --strict is set.

  --format text      Print file:line:column: problem (default).
  --format github    Print GitHub Actions annotations so problems appear on the PR diff.
  --strict           Treat warnings as errors.
  --check-sources    Check that repository-relative sources exist and that
                     Markdown #heading fragments match a heading.
  --plans <path>     Check that story IDs mentioned in Markdown files under
                     <path> exist in the map. Repeat for several paths.
  --root <path>      Repository root for sources and plans. Defaults to the
                     current directory.

diff
  Compares the map with its version at <base-ref>, such as origin/main, and
  prints a Markdown summary for a pull request. Customer-facing changes come first.

  --map <path>       Map to compare. Defaults to product/story-map.yaml.
  --format json      Print the comparison as JSON instead.

history
  Reads the map's Git history and writes when each story was added, each
  status change and each story's last edit, who made it and who merged it, as
  JSON for the board. Run it when building the product, from a full clone.

  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --ref <ref>        Branch whose history to read. Defaults to HEAD.
  --out <file>       Write to a file instead of printing.
  --bot-names <names>
                     Comma-separated commit authors that are bots. Their edits
                     are credited to whoever merged them. Authors ending in
                     [bot] are always treated as bots. Repeat to add more.
  --allow-shallow    Build a partial history from a shallow clone instead of failing.`;

type Format = "text" | "github";

/** A problem with the command line, reported before the usage text. */
class ArgumentError extends Error {}

/**
 * Reads `--name value` and `--name=value`. A missing value, or a next argument
 * that is another option, such as `--map --strict`, is an error rather than
 * the value. Use `--name=-value` for a value that starts with a hyphen.
 */
function optionValue(rest: string[], index: number, name: string): [string, number] {
  const arg = rest[index];
  const [value, next] = arg === name ? [rest[index + 1], index + 1] : [arg.slice(name.length + 1), index];
  if (!value || (arg === name && value.startsWith("-"))) throw new ArgumentError(`${name} needs a value`);
  return [value, next];
}

function parseValidateArgs(rest: string[]) {
  let format: Format = "text";
  let checkSourceFiles = false;
  let strict = false;
  let root = ".";
  const plans: string[] = [];
  const paths: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (name === "--format" || name === "--plans" || name === "--root") {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--format") {
        if (value !== "text" && value !== "github") return null;
        format = value;
      } else if (name === "--plans") {
        plans.push(value);
      } else {
        root = value;
      }
    } else if (arg === "--check-sources") {
      checkSourceFiles = true;
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      paths.push(arg);
    }
  }
  return paths.length > 0 ? { format, paths, checkSourceFiles, strict, plans, root: resolve(root) } : null;
}

function parseDiffArgs(rest: string[]) {
  let format: "markdown" | "json" = "markdown";
  let map = "product/story-map.yaml";
  const refs: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (name === "--format" || name === "--map") {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--map") map = value;
      else if (value === "markdown" || value === "json") format = value;
      else return null;
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      refs.push(arg);
    }
  }
  return refs.length === 1 ? { format, map, base: refs[0] } : null;
}

function parseInitArgs(rest: string[]) {
  let ci = true;
  let dir = ".";
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--no-ci") ci = false;
    else if (arg.split("=")[0] === "--dir") [dir, index] = optionValue(rest, index, "--dir");
    else return null;
  }
  return { ci, dir: resolve(dir) };
}

// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
function escapeData(value: string) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(value: string) {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function report(mapPath: string, issue: ReferenceIssue, format: Format) {
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
    console.error(`${path}${position}: ${warning ? "warning: " : ""}${message}`);
  }
}

async function validate(options: NonNullable<ReturnType<typeof parseValidateArgs>>) {
  const count = (n: number, noun: string, plural: string) => `${n} ${n === 1 ? noun : plural}`;
  for (const path of options.paths) {
    try {
      const loaded = loadStoryMap(await readFile(path, "utf8"));
      const issues: ReferenceIssue[] = [];
      if (options.checkSourceFiles) issues.push(...await checkSources(loaded, options.root));
      if (options.plans.length) issues.push(...await checkPlanReferences(loaded, options.root, options.plans));
      const { map, warnings } = loaded;
      const all = ([...issues, ...warnings] as ReferenceIssue[]).sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0));
      for (const issue of all) report(path, issue, options.format);
      if (issues.length || (options.strict && warnings.length)) {
        process.exitCode = 1;
        continue;
      }
      const checked = [options.checkSourceFiles && "sources", options.plans.length && "plan references"].filter(Boolean);
      const warned = warnings.length ? `, ${count(warnings.length, "warning", "warnings")}` : "";
      console.log(`${path}: valid (${count(map.activities.length, "activity", "activities")}, ${count(map.releases.length, "release", "releases")}, ${count(map.stories.length, "story", "stories")})${warned}${checked.length ? `; checked ${checked.join(" and ")}` : ""}`);
    } catch (error) {
      process.exitCode = 1;
      if (error instanceof StoryMapValidationError) {
        for (const issue of error.issues) report(path, issue, options.format);
      } else {
        report(path, { severity: "error", path: [], message: error instanceof Error ? error.message : String(error) }, options.format);
      }
    }
  }
}

class UsageError extends Error {}

async function readMapAt(ref: string, mapPath: string): Promise<StoryMapDocument | null> {
  if (ref.startsWith("-")) throw new UsageError(`'${ref}' is not a Git reference.`);
  const gitPath = `./${relative(process.cwd(), resolve(mapPath)).split(sep).join("/")}`;
  let source: string;
  try {
    ({ stdout: source } = await promisify(execFile)("git", ["show", `${ref}:${gitPath}`], { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    if (/does not exist in|exists on disk, but not in/.test(stderr)) return null;
    throw new UsageError(stderr.trim() || `Could not read ${mapPath} at ${ref}.`);
  }
  try {
    return parseStoryMap(source);
  } catch (error) {
    throw new Error(`The map at ${ref} is not valid, so it cannot be compared:\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function diff(options: NonNullable<ReturnType<typeof parseDiffArgs>>) {
  let after: StoryMapDocument;
  try {
    after = parseStoryMap(await readFile(options.map, "utf8"));
  } catch (error) {
    if (error instanceof StoryMapValidationError) {
      for (const issue of error.issues) report(options.map, issue, "text");
    } else {
      console.error(`${options.map}: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
    return;
  }
  try {
    const before = await readMapAt(options.base, options.map);
    const result = diffStoryMaps(before, after);
    console.log(options.format === "json" ? JSON.stringify(result, null, 2) : formatStoryMapDiff(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

async function init(options: NonNullable<ReturnType<typeof parseInitArgs>>) {
  const steps = await initStoryMap(options.dir, { ci: options.ci });
  for (const step of steps) {
    console.log(`${step.action.padEnd(8)} ${step.path}${step.reason ? ` (${step.reason})` : ""}`);
  }
  console.log(`
Next, ask an agent in this repository to populate the map:

  Populate product/story-map.yaml for this product using the first-run workflow
  in docs/story-map.md. Start with the primary user journey and cite the
  evidence for each story. Validate the map and flag any uncertain release or
  status decisions for review.`);
}

function parseHistoryArgs(rest: string[]) {
  const options = { map: "product/story-map.yaml", ref: "HEAD", out: undefined as string | undefined, allowShallow: false, botNames: [] as string[] };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (name === "--map" || name === "--ref" || name === "--out") {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      options[name.slice(2) as "map" | "ref" | "out"] = value;
    } else if (name === "--bot-names") {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      options.botNames.push(...value.split(",").map(botName => botName.trim()).filter(Boolean));
    } else if (arg === "--allow-shallow") {
      options.allowShallow = true;
    } else {
      return null;
    }
  }
  return options;
}

async function history(options: NonNullable<ReturnType<typeof parseHistoryArgs>>) {
  try {
    const result = await buildStoryMapHistory({ map: options.map, ref: options.ref, allowShallow: options.allowShallow, botNames: options.botNames });
    const json = JSON.stringify(result, null, 2) + "\n";
    if (!options.out) {
      process.stdout.write(json);
      return;
    }
    await mkdir(dirname(resolve(options.out)), { recursive: true });
    await writeFile(options.out, json);
    const stories = new Set(result.events.map(event => event.storyId)).size;
    console.error(`${options.out}: ${result.events.length} changes to ${stories} stories${result.complete ? "" : " (partial: shallow clone)"}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof StoryMapHistoryError ? 2 : 1;
  }
}

const [command, ...rest] = process.argv.slice(2);
function parse<T>(name: string, parser: (rest: string[]) => T | null): T | null {
  if (command !== name) return null;
  try {
    return parser(rest);
  } catch (error) {
    if (!(error instanceof ArgumentError)) throw error;
    console.error(`story-map: ${error.message}\n`);
    return null;
  }
}
const validateOptions = parse("validate", parseValidateArgs);
const initOptions = parse("init", parseInitArgs);
const diffOptions = parse("diff", parseDiffArgs);
const historyOptions = parse("history", parseHistoryArgs);
if (validateOptions) {
  await validate(validateOptions);
} else if (diffOptions) {
  await diff(diffOptions);
} else if (historyOptions) {
  await history(historyOptions);
} else if (initOptions) {
  await init(initOptions);
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log(usage);
} else {
  console.error(usage);
  process.exitCode = 2;
}
