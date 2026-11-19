#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initStoryMap } from "./init.js";
import {
  describeIssueTarget,
  parseStoryMap,
  StoryMapValidationError,
  type StoryMapIssue,
} from "./schema.js";

const usage = `Usage:
  story-map init [--no-ci] [--dir <path>]
  story-map validate [--format text|github] <map.yaml> [other-map.yaml ...]

init
  Sets up a host repository: a starter product/story-map.yaml, the story map
  guide in docs/story-map.md, a story map section in AGENTS.md and a GitHub
  Actions workflow that validates the map. Existing files are never overwritten.

  --no-ci          Skip the GitHub Actions workflow.
  --dir <path>     Repository root. Defaults to the current directory.

validate
  --format text    Print file:line:column: problem (default).
  --format github  Print GitHub Actions annotations so problems appear on the PR diff.`;

type Format = "text" | "github";

function parseValidateArgs(rest: string[]) {
  let format: Format = "text";
  const paths: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--format" || arg.startsWith("--format=")) {
      const value = arg === "--format" ? rest[++index] : arg.slice("--format=".length);
      if (value !== "text" && value !== "github") return null;
      format = value;
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      paths.push(arg);
    }
  }
  return paths.length > 0 ? { format, paths } : null;
}

function parseInitArgs(rest: string[]) {
  let ci = true;
  let dir = ".";
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--no-ci") ci = false;
    else if (arg === "--dir" && rest[index + 1]) dir = rest[++index];
    else if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
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

function report(path: string, issue: StoryMapIssue, format: Format) {
  const message = issue.path.length ? `${describeIssueTarget(issue)}: ${issue.message}` : issue.message;
  if (format === "github") {
    const properties = [`file=${escapeProperty(path)}`];
    if (issue.line) properties.push(`line=${issue.line}`);
    if (issue.column) properties.push(`col=${issue.column}`);
    properties.push("title=Story map");
    console.log(`::error ${properties.join(",")}::${escapeData(message)}`);
  } else {
    const position = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ""}` : "";
    console.error(`${path}${position}: ${message}`);
  }
}

async function validate(options: NonNullable<ReturnType<typeof parseValidateArgs>>) {
  for (const path of options.paths) {
    try {
      const map = parseStoryMap(await readFile(path, "utf8"));
      const count = (n: number, noun: string, plural: string) => `${n} ${n === 1 ? noun : plural}`;
      console.log(`${path}: valid (${count(map.activities.length, "activity", "activities")}, ${count(map.releases.length, "release", "releases")}, ${count(map.stories.length, "story", "stories")})`);
    } catch (error) {
      process.exitCode = 1;
      if (error instanceof StoryMapValidationError) {
        for (const issue of error.issues) report(path, issue, options.format);
      } else {
        report(path, { path: [], message: error instanceof Error ? error.message : String(error) }, options.format);
      }
    }
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

const [command, ...rest] = process.argv.slice(2);
const validateOptions = command === "validate" ? parseValidateArgs(rest) : null;
const initOptions = command === "init" ? parseInitArgs(rest) : null;
if (validateOptions) {
  await validate(validateOptions);
} else if (initOptions) {
  await init(initOptions);
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log(usage);
} else {
  console.error(usage);
  process.exitCode = 2;
}
