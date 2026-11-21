#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { code, diffStoryMaps, formatStoryMapDiff } from "./diff.js";
import { defaultExportMaxStories, prepareStoryMapExport } from "./export.js";
import { storyMapToCsv } from "./export-csv.js";
import { jsonDefaultMaxStories, storyMapToJson } from "./export-json.js";
import { storyMapExportFormats } from "./export-response.js";
import { storyMapToVsdx } from "./export-vsdx.js";
import { parseStoryMapHistory, type StoryMapHistory } from "./history.js";
import { buildStoryMapHistory, StoryMapHistoryError } from "./history-git.js";
import { initStoryMap } from "./init.js";
import { buildStoryMapTests, checkStoryTests, findStoryTests } from "./tests.js";
import { parseStoryMapTests, type StoryMapTests } from "./tests-index.js";
import { checkPlanReferences, checkSources, type ReferenceIssue } from "./references.js";
import {
  describeIssueTarget,
  loadHistoricalStoryMap,
  loadStoryMap,
  parseStoryMap,
  StoryMapValidationError,
  type HistoricalStoryMap,
  type StoryMapDocument,
} from "./schema.js";
import { getStoryMapForViewer } from "./view.js";

const usage = `Usage:
  story-map init [--no-ci] [--dir <path>]
  story-map validate [--format text|github] [--strict] [--check-sources] [--plans <path>] [--tests <path>] <map.yaml> [...]
  story-map diff [--format markdown|json] [--map <path>] <base-ref>
  story-map history [--map <path>] [--ref <ref>] [--out <file>] [--bot-names <names>] [--allow-shallow]
  story-map tests [--tests <path>] [--root <path>] [--out <file>] [<map.yaml>]
  story-map export --format vsdx|csv|json [--output <file>] [--history <file>] [--tests-index <file>] [--collapsed <release IDs>] [--max-stories <n>] [<map.yaml>]

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
  --tests <path>     Check story IDs in the names of tests under <path>: an
                     error for an ID that is not in the map, and a warning for
                     an in-progress or merged story with no tagged tests.
                     Repeat for several paths.
  --root <path>      Repository root for sources, plans and tests. Defaults to
                     the current directory.

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
  --allow-shallow    Build a partial history from a shallow clone instead of failing.

tests
  Finds tests whose names contain a story ID, such as
  test("ESM-702: exports a valid Visio package", …), and writes them as JSON
  for the board. It reads the source text only, so no test code runs. The map
  is validated first, and defaults to product/story-map.yaml.

  --tests <path>     A test file, or a folder whose *.test.*, *.spec.* files
                     and test/, tests/ and __tests__/ folders are read.
                     Repeat for several paths. Defaults to the whole root.
  --root <path>      Repository root. Defaults to the current directory.
  --out <file>       Write to a file instead of printing.

export
  Writes the whole internal map as a file to import into Lucidchart, Miro,
  Visio or a spreadsheet, or as JSON for an agent to review. The map is
  validated first, and errors exit 1. The map defaults to
  product/story-map.yaml.

  --format vsdx|csv|json
                     Required. vsdx writes a Visio file, csv a row per story,
                     and json every story's details with notes on where the
                     data came from and what is left out.
  --output <file>    Defaults to story-map.<format>. Use - to write to stdout.
  --history <file>   History from story-map history, used to choose the most
                     recently changed stories when there are too many, and
                     included in json.
  --tests-index <file>
                     Tests index from story-map tests, included in json.
  --collapsed <release IDs>
                     Comma-separated releases to export as a header and a
                     story count, without their stories. Repeat to add more.
  --max-stories <n>  Most stories to export. Defaults to ${defaultExportMaxStories}, or
                     every story for json.`;

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
  const tests: string[] = [];
  const paths: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (name === "--format" || name === "--plans" || name === "--tests" || name === "--root") {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--format") {
        if (value !== "text" && value !== "github") return null;
        format = value;
      } else if (name === "--plans") {
        plans.push(value);
      } else if (name === "--tests") {
        tests.push(value);
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
  return paths.length > 0 ? { format, paths, checkSourceFiles, strict, plans, tests, root: resolve(root) } : null;
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

// Map text reaches diagnostics, so a line break or terminal control in it must not start what looks like another record.
function escapeText(value: string) {
  return value.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/g, char =>
    char === "\n" ? "\\n" : char === "\r" ? "\\r" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
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
    console.error(`${escapeText(path)}${position}: ${warning ? "warning: " : ""}${escapeText(message)}`);
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
      if (options.tests.length) {
        const found = await findStoryTests(loaded, options.root, { paths: options.tests });
        issues.push(...found.issues, ...checkStoryTests(loaded, found.tests));
      }
      const { map } = loaded;
      const errors = issues.filter(issue => issue.severity === "error");
      const warnings = [...loaded.warnings, ...issues.filter(issue => issue.severity === "warning")];
      const all = ([...issues, ...loaded.warnings] as ReferenceIssue[]).sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0));
      for (const issue of all) report(path, issue, options.format);
      if (errors.length || (options.strict && warnings.length)) {
        process.exitCode = 1;
        continue;
      }
      const checked = [options.checkSourceFiles && "sources", options.plans.length && "plan references", options.tests.length && "test tags"].filter(Boolean);
      const listed = checked.length > 1 ? `${checked.slice(0, -1).join(", ")} and ${checked[checked.length - 1]}` : checked[0];
      const warned = warnings.length ? `, ${count(warnings.length, "warning", "warnings")}` : "";
      console.log(`${path}: valid (${count(map.activities.length, "activity", "activities")}, ${count(map.releases.length, "release", "releases")}, ${count(map.stories.length, "story", "stories")})${warned}${listed ? `; checked ${listed}` : ""}`);
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

/** Reads the base version leniently, since it may use an earlier format. The current map is always checked strictly. */
async function readMapAt(ref: string, mapPath: string): Promise<HistoricalStoryMap | null> {
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
    return loadHistoricalStoryMap(source);
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
    const result = diffStoryMaps(before?.map ?? null, after);
    const dropped = before && (before.dropped.stories || before.dropped.fields) ? before.dropped : undefined;
    if (options.format === "json") {
      console.log(JSON.stringify(dropped ? { ...result, baseDropped: dropped } : result, null, 2));
      return;
    }
    let markdown = formatStoryMapDiff(result);
    if (dropped) {
      const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
      const parts = [
        dropped.fields && `${count(dropped.fields, "field")} the format no longer has`,
        dropped.stories && `${count(dropped.stories, "story")} that no longer ${dropped.stories === 1 ? "validates" : "validate"}${dropped.storyIds.length ? ` (${dropped.storyIds.map(code).join(", ")})` : ""}`,
      ].filter(Boolean);
      const note = `> [!NOTE]\n> The map at ${code(options.base)} uses an older format, so this comparison leaves out ${parts.join(" and ")} from it.`;
      markdown = markdown.replace(/^## Story map changes\n\n/, match => `${match}${note}\n\n`);
    }
    console.log(markdown);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

async function init(options: NonNullable<ReturnType<typeof parseInitArgs>>) {
  let steps;
  try {
    steps = await initStoryMap(options.dir, { ci: options.ci });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
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
    warnSkipped(result);
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

/** Warns about versions of the map that history could not read. They do not fail the build. */
function warnSkipped(result: Awaited<ReturnType<typeof buildStoryMapHistory>>) {
  if (!result.skippedCount) return;
  const shown = (result.skipped ?? []).slice(0, 3);
  const versions = result.skippedCount === 1 ? "1 version" : `${result.skippedCount} versions`;
  console.error(`warning: skipped ${versions} of the map that could not be read, so changes made in ${result.skippedCount === 1 ? "it are" : "them are"} missing:`);
  for (const version of shown) console.error(`  ${version.commit.slice(0, 12)}: ${version.reason}`);
  if (result.skippedCount > shown.length) console.error(`  and ${result.skippedCount - shown.length} more, listed in the file's skipped field`);
}

function parseTestsArgs(rest: string[]) {
  const options = { map: "product/story-map.yaml", root: ".", out: undefined as string | undefined, tests: [] as string[] };
  const paths: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (name === "--tests" || name === "--root" || name === "--out") {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--tests") options.tests.push(value);
      else options[name.slice(2) as "root" | "out"] = value;
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      paths.push(arg);
    }
  }
  if (paths.length > 1) return null;
  return { ...options, map: paths[0] ?? options.map, root: resolve(options.root), tests: options.tests.length ? options.tests : ["."] };
}

async function tests(options: NonNullable<ReturnType<typeof parseTestsArgs>>) {
  let loaded;
  try {
    loaded = loadStoryMap(await readFile(options.map, "utf8"));
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof StoryMapValidationError) {
      for (const issue of error.issues) report(options.map, issue, "text");
    } else {
      console.error(`${escapeText(options.map)}: ${escapeText(error instanceof Error ? error.message : String(error))}`);
    }
    return;
  }
  const found = await findStoryTests(loaded, options.root, { paths: options.tests });
  for (const issue of found.issues) report(options.map, issue, "text");
  if (found.issues.some(issue => issue.severity === "error")) {
    process.exitCode = 2;
    return;
  }
  const { index, unknownIds } = buildStoryMapTests(loaded, found.tests);
  if (unknownIds.length) {
    const shown = unknownIds.slice(0, 3).map(id => escapeText(id)).join(", ");
    const more = unknownIds.length > 3 ? ` and ${unknownIds.length - 3} more` : "";
    console.error(`warning: left out tags for stories that are not in the map: ${shown}${more}. Run story-map validate --tests to see where they are.`);
  }
  const json = JSON.stringify(index, null, 2) + "\n";
  if (!options.out) {
    process.stdout.write(json);
    return;
  }
  await mkdir(dirname(resolve(options.out)), { recursive: true });
  await writeFile(options.out, json);
  const stories = new Set(index.tests.flatMap(test => test.storyIds)).size;
  const omitted = (index.omitted ?? []).reduce((sum, entry) => sum + entry.count, 0);
  console.error(`${escapeText(options.out)}: ${index.tests.length} ${index.tests.length === 1 ? "test" : "tests"} for ${stories} ${stories === 1 ? "story" : "stories"}${omitted ? ` (${omitted} more not listed)` : ""}`);
}

const exportFormats = storyMapExportFormats;

function parseExportArgs(rest: string[]) {
  let format: (typeof exportFormats)[number] | undefined;
  let output: string | undefined;
  let historyPath: string | undefined;
  let testsPath: string | undefined;
  let maxStories: number | undefined;
  const collapsed: string[] = [];
  const paths: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (name === "--format" || name === "--output" || name === "--history" || name === "--tests-index" || name === "--collapsed" || name === "--max-stories") {
      // `--output -` means stdout, so `-` on its own is a value here.
      const [value, next] = name === "--output" && arg === name && rest[index + 1] === "-" ? ["-", index + 1] : optionValue(rest, index, name);
      index = next;
      if (name === "--format") {
        if (!exportFormats.includes(value as never)) throw new ArgumentError(`--format must be ${exportFormats.join(", ")}, not ${value}`);
        format = value as (typeof exportFormats)[number];
      } else if (name === "--output") {
        output = value;
      } else if (name === "--history") {
        historyPath = value;
      } else if (name === "--tests-index") {
        testsPath = value;
      } else if (name === "--collapsed") {
        collapsed.push(...value.split(",").map(id => id.trim()).filter(Boolean));
      } else {
        maxStories = Number(value);
        if (!/^\d+$/.test(value) || maxStories < 1) throw new ArgumentError(`--max-stories must be a whole number of at least 1, not ${value}`);
      }
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      paths.push(arg);
    }
  }
  if (!format) throw new ArgumentError("--format is required");
  if (paths.length > 1) return null;
  return { format, map: paths[0] ?? "product/story-map.yaml", output: output ?? `story-map.${format}`, history: historyPath, tests: testsPath, collapsed, maxStories };
}

async function exportMap(options: NonNullable<ReturnType<typeof parseExportArgs>>) {
  let document: StoryMapDocument;
  let history: StoryMapHistory | undefined;
  let tests: StoryMapTests | undefined;
  try {
    document = loadStoryMap(await readFile(options.map, "utf8")).map;
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof StoryMapValidationError) {
      for (const issue of error.issues) report(options.map, issue, "text");
    } else {
      console.error(`${escapeText(options.map)}: ${escapeText(error instanceof Error ? error.message : String(error))}`);
    }
    return;
  }
  if (options.history) {
    try {
      history = parseStoryMapHistory(await readFile(options.history, "utf8"));
    } catch (error) {
      console.error(`${escapeText(options.history)}: ${escapeText(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = 1;
      return;
    }
  }
  if (options.tests) {
    try {
      tests = parseStoryMapTests(await readFile(options.tests, "utf8"));
    } catch (error) {
      console.error(`${escapeText(options.tests)}: ${escapeText(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = 1;
      return;
    }
    if (options.format !== "json") console.error(`warning: --tests-index is only used by --format json, so it is ignored`);
  }
  const releaseIds = new Set(document.releases.map(release => release.id));
  for (const id of options.collapsed) {
    if (!releaseIds.has(id)) console.error(`warning: --collapsed ${escapeText(id)} is not a release in ${escapeText(options.map)}, so it is ignored`);
  }

  // Whoever runs the CLI has the YAML file, so the export is always the internal view.
  const view = getStoryMapForViewer(document, {}, { canViewInternal: () => true, history, tests })!;
  const exportOptions = { collapsedReleases: options.collapsed, maxStories: options.maxStories ?? (options.format === "json" ? jsonDefaultMaxStories : defaultExportMaxStories) };
  const file = options.format === "csv" ? storyMapToCsv(view, exportOptions)
    : options.format === "json" ? storyMapToJson(view, exportOptions)
    : storyMapToVsdx(view, exportOptions);
  if (options.output === "-") {
    process.stdout.write(file);
    return;
  }
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  await writeFile(options.output, file);
  const { available, omitted } = prepareStoryMapExport(view, exportOptions);
  const collapsedCount = document.stories.length - available;
  const details = [
    omitted && `left out ${omitted} less recently changed`,
    collapsedCount && `${collapsedCount} in collapsed lanes`,
  ].filter(Boolean);
  const exported = available - omitted;
  console.error(`${options.output}: exported ${exported} ${exported === 1 ? "story" : "stories"}${details.length ? ` (${details.join(", ")})` : ""}`);
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
const exportOptions = parse("export", parseExportArgs);
const testsOptions = parse("tests", parseTestsArgs);
if (validateOptions) {
  await validate(validateOptions);
} else if (diffOptions) {
  await diff(diffOptions);
} else if (historyOptions) {
  await history(historyOptions);
} else if (initOptions) {
  await init(initOptions);
} else if (exportOptions) {
  await exportMap(exportOptions);
} else if (testsOptions) {
  await tests(testsOptions);
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log(usage);
} else {
  console.error(usage);
  process.exitCode = 2;
}
