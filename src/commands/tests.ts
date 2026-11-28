import { resolve } from "node:path";
import { buildStoryMapTests, findStoryTests } from "../tests.js";
import { defineCommand, escapeText, loadMapOrReport, optionValue, report, writeOutput } from "./shared.js";

export default defineCommand({
  parse(rest: string[]) {
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
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    const found = await findStoryTests(loaded, options.root, { paths: options.tests });
    for (const issue of found.issues) report(options.map, issue);
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
    // Written to standard output, the index is the whole output, so there is no summary.
    if (!await writeOutput(`${JSON.stringify(index, null, 2)}\n`, options.out) || !options.out) return;
    const stories = new Set(index.tests.flatMap(test => test.storyIds)).size;
    const omitted = (index.omitted ?? []).reduce((sum, entry) => sum + entry.count, 0);
    console.error(`${escapeText(options.out)}: ${index.tests.length} ${index.tests.length === 1 ? "test" : "tests"} for ${stories} ${stories === 1 ? "story" : "stories"}${omitted ? ` (${omitted} more not listed)` : ""}`);
  },
});
