#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  describeIssueTarget,
  parseStoryMap,
  StoryMapValidationError,
  type StoryMapIssue,
} from "./schema.js";

const usage = `Usage: story-map validate [--format text|github] <map.yaml> [other-map.yaml ...]

  --format text    Print file:line:column: problem (default).
  --format github  Print GitHub Actions annotations so problems appear on the PR diff.`;

type Format = "text" | "github";

function parseArgs(args: string[]) {
  const [command, ...rest] = args;
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
  return command === "validate" && paths.length > 0 ? { format, paths } : null;
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

const options = parseArgs(process.argv.slice(2));
if (!options) {
  console.error(usage);
  process.exitCode = 2;
} else {
  for (const path of options.paths) {
    try {
      const map = parseStoryMap(await readFile(path, "utf8"));
      console.log(`${path}: valid (${map.activities.length} activities, ${map.releases.length} releases, ${map.stories.length} stories)`);
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
