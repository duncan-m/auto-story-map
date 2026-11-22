import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkStoryMap, type StoryMapCheckResult } from "../check.js";
import { count, defineCommand, listWords, optionValue, printJson, readFormat, report, type ReportFormat } from "./shared.js";

const formats = ["text", "github", "json"] as const;

const checkedLabels = { sources: "sources", plans: "plan references", tests: "test tags" } as const;

export default defineCommand({
  parse(rest: string[]) {
    let format: (typeof formats)[number] = "text";
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
        if (name === "--format") format = readFormat(value, formats);
        else if (name === "--plans") plans.push(value);
        else if (name === "--tests") tests.push(value);
        else root = value;
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
  },

  async run(options) {
    const results: (StoryMapCheckResult & { file: string })[] = [];
    for (const path of options.paths) {
      let result: StoryMapCheckResult;
      try {
        result = await checkStoryMap(await readFile(path, "utf8"), {
          root: options.root,
          checkSources: options.checkSourceFiles,
          plans: options.plans,
          tests: options.tests,
          strict: options.strict,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = { valid: false, errors: 1, warnings: 0, checked: [], issues: [{ severity: "error", path: [], message }] };
      }
      if (!result.valid) process.exitCode = 1;
      results.push({ file: path, ...result });
      if (options.format !== "json") printResult(path, result, options.format);
    }
    if (options.format === "json") printJson("validation", { valid: results.every(result => result.valid), maps: results });
  },
});

function printResult(path: string, result: StoryMapCheckResult, format: ReportFormat) {
  for (const issue of result.issues) report(path, issue, format);
  if (!result.valid || !result.counts) return;
  const { activities, releases, stories } = result.counts;
  const listed = listWords(result.checked.map(check => checkedLabels[check]));
  const warned = result.warnings ? `, ${count(result.warnings, "warning", "warnings")}` : "";
  console.log(`${path}: valid (${count(activities, "activity", "activities")}, ${count(releases, "release", "releases")}, ${count(stories, "story", "stories")})${warned}${listed ? `; checked ${listed}` : ""}`);
}
