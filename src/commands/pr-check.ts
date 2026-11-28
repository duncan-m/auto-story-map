import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { storyMapRuleLinker } from "../check.js";
import { diffStoryMaps } from "../diff.js";
import { checkPullRequest, type PrCheckCommit, type PrCheckResult } from "../pr-check.js";
import { loadStoryMap, StoryMapValidationError, type LoadedStoryMap } from "../schema.js";
import { readMapAt } from "./diff.js";
import { ArgumentError, count, defineCommand, optionValue, printJson, readFormat, report, UsageError, type ReportFormat } from "./shared.js";

const formats = ["text", "github", "json"] as const;

/** The non-merge commits in `base..head` that change the map. Merges only bring in work already on the base. */
async function mapCommits(base: string, head: string, mapPath: string): Promise<PrCheckCommit[]> {
  for (const ref of [base, head]) if (ref.startsWith("-")) throw new UsageError(`'${ref}' is not a Git reference.`);
  const gitPath = `./${relative(process.cwd(), resolve(mapPath)).split(sep).join("/")}`;
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)("git", ["log", "-z", "--no-merges", "--format=%H%x1f%an%x1f%ae%x1f%B", `${base}..${head}`, "--", gitPath], { maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    throw new UsageError(String((error as { stderr?: unknown }).stderr ?? "").trim() || `Could not read the commits in ${base}..${head}.`);
  }
  return stdout.split("\0").filter(Boolean).map(record => {
    const [sha, author, email, message = ""] = record.split("\x1f");
    return { sha: sha.trim(), author, email, message };
  });
}

async function readBody(path: string) {
  if (path !== "-") return readFile(path, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export default defineCommand({
  parse(rest: string[]) {
    let format: (typeof formats)[number] = "text";
    let map = "product/story-map.yaml";
    let head = "HEAD";
    let body: string | undefined;
    let approved = false;
    let strict = false;
    let draft: boolean | undefined;
    const botNames: string[] = [];
    const refs: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (name === "--format" || name === "--map" || name === "--head" || name === "--bot-names") {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--format") format = readFormat(value, formats);
        else if (name === "--map") map = value;
        else if (name === "--head") head = value;
        else botNames.push(...value.split(",").map(botName => botName.trim()).filter(Boolean));
      } else if (name === "--body-file") {
        // `-` reads the body from stdin, so it is allowed as the value.
        const value = arg === name ? rest[index + 1] : arg.slice(name.length + 1);
        if (!value || (arg === name && value.startsWith("-") && value !== "-")) return null;
        if (arg === name) index++;
        body = value;
      } else if (name === "--draft") {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (value !== "true" && value !== "false") throw new ArgumentError(`--draft must be true or false, not ${value}`);
        draft = value === "true";
      } else if (arg === "--approved") {
        approved = true;
      } else if (arg === "--strict") {
        strict = true;
      } else if (arg.startsWith("-")) {
        return null;
      } else {
        refs.push(arg);
      }
    }
    return refs.length === 1 ? { format, map, head, body, approved, draft, strict, botNames, base: refs[0] } : null;
  },

  async run(options) {
    let loaded: LoadedStoryMap;
    const link = await storyMapRuleLinker(process.cwd());
    try {
      loaded = loadStoryMap(await readFile(options.map, "utf8"));
    } catch (error) {
      process.exitCode = 1;
      if (error instanceof StoryMapValidationError) {
        for (const issue of error.issues) report(options.map, { ...issue, help: link(issue.rule) }, options.format === "github" ? "github" : "text");
      } else {
        console.error(`${options.map}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    let result: PrCheckResult;
    try {
      const before = await readMapAt(options.base, options.map);
      const body = options.body === undefined ? undefined : await readBody(options.body);
      result = checkPullRequest({
        diff: diffStoryMaps(before?.map ?? null, loaded.map),
        after: loaded.map,
        commits: await mapCommits(options.base, options.head, options.map),
        botNames: options.botNames,
        approved: options.approved,
        body,
        draft: options.draft,
        strict: options.strict,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = error instanceof UsageError ? 2 : 1;
      return;
    }
    // A problem with the description, not the map, has no path or item, so it is reported for the file as a whole rather than on line 1.
    const issues = result.issues.map(issue => ({ ...issue, ...(issue.path.length || issue.itemId ? loaded.locate(issue.path) : {}), help: link(issue.rule) }));
    if (!result.passed) process.exitCode = 1;
    if (options.format === "json") {
      printJson("pr-check", { ...result, issues: issues.map(issue => ({ ...issue, file: options.map })) });
      return;
    }
    for (const issue of issues) report(options.map, issue, options.format as ReportFormat);
    console.log(summary(result));
  },
});

function summary(result: PrCheckResult) {
  const parts = [
    result.agentCommits.length ? `${count(result.agentCommits.length, "agent commit", "agent commits")} changed the map` : "no agent commits changed the map",
    result.needsPerson.length ? `${count(result.needsPerson.length, "change needs", "changes need")} a person${result.approved ? ", approved" : ""}` : "nothing needs a person",
    result.checkedBody ? (result.merged.length ? `checked Tokens used for ${result.merged.join(", ")}` : "no stories marked merged") : "Tokens used not checked without --body-file",
  ];
  if (result.checkedReview) parts.push("checked the Review section");
  return `pr-check: ${result.passed ? "passed" : "failed"} (${parts.join("; ")})`;
}
