import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { code, diffStoryMaps, formatStoryMapDiff } from "../diff.js";
import { loadHistoricalStoryMap, parseStoryMap, StoryMapValidationError, type HistoricalStoryMap, type StoryMapDocument } from "../schema.js";
import { defineCommand, optionValue, report, UsageError } from "./shared.js";

/** Reads the base version leniently, since it may use an earlier format. The current map is always checked strictly. */
export async function readMapAt(ref: string, mapPath: string): Promise<HistoricalStoryMap | null> {
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

export default defineCommand({
  parse(rest: string[]) {
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
  },

  async run(options) {
    let after: StoryMapDocument;
    try {
      after = parseStoryMap(await readFile(options.map, "utf8"));
    } catch (error) {
      if (error instanceof StoryMapValidationError) {
        for (const issue of error.issues) report(options.map, issue);
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
  },
});
