import { buildStoryMapHistory, StoryMapHistoryError } from "../history-git.js";
import { defineCommand, optionValue, writeOutput } from "./shared.js";

/** Warns about versions of the map that history could not read. They do not fail the build. */
function warnSkipped(result: Awaited<ReturnType<typeof buildStoryMapHistory>>) {
  if (!result.skippedCount) return;
  const shown = (result.skipped ?? []).slice(0, 3);
  const versions = result.skippedCount === 1 ? "1 version" : `${result.skippedCount} versions`;
  console.error(`warning: skipped ${versions} of the map that could not be read, so changes made in ${result.skippedCount === 1 ? "it are" : "them are"} missing:`);
  for (const version of shown) console.error(`  ${version.commit.slice(0, 12)}: ${version.reason}`);
  if (result.skippedCount > shown.length) console.error(`  and ${result.skippedCount - shown.length} more, listed in the file's skipped field`);
}

export default defineCommand({
  parse(rest: string[]) {
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
  },

  async run(options) {
    try {
      const result = await buildStoryMapHistory({ map: options.map, ref: options.ref, allowShallow: options.allowShallow, botNames: options.botNames });
      warnSkipped(result);
      if (!await writeOutput(JSON.stringify(result, null, 2) + "\n", options.out)) return;
      const stories = new Set(result.events.map(event => event.storyId)).size;
      const named = result.changes?.length ?? 0;
      console.error(`${options.out}: ${result.events.length} changes to ${stories} stories, ${named} pull ${named === 1 ? "request or commit names" : "requests or commits name"} a story${result.complete ? "" : " (partial: shallow clone)"}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = error instanceof StoryMapHistoryError ? 2 : 1;
    }
  },
});
