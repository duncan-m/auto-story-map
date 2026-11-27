import { resolve } from "node:path";
import { countStoryMapActions, filterStoryMapActions, getStoryMapActions, isStoryMapActionItemType, isStoryMapActionKind, storyMapActionItemTypes, storyMapActionKindOrder, type StoryMapAction, type StoryMapActionFilter } from "../actions.js";
import { buildStoryMapTests, findStoryTests } from "../tests.js";
import type { StoryMapTests } from "../tests-index.js";
import { ArgumentError, count, defineCommand, escapeText, loadInputsOrReport, loadMapOrReport, optionValue, printJson, readFormat, report } from "./shared.js";

const formats = ["text", "json"] as const;

function itemLabel(action: StoryMapAction) {
  if (action.item.type === "map") return "the map";
  return `${escapeText(action.item.id)} (${escapeText(action.item.title)})`;
}

export default defineCommand({
  parse(rest: string[]) {
    const options = {
      format: "text" as (typeof formats)[number],
      map: "product/story-map.yaml",
      root: ".",
      tests: [] as string[],
      testsIndex: undefined as string | undefined,
      filter: {} as StoryMapActionFilter,
    };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      const value = () => {
        const [found, next] = optionValue(rest, index, name);
        index = next;
        return found;
      };
      if (name === "--format") options.format = readFormat(value(), formats);
      else if (name === "--map") options.map = value();
      else if (name === "--root") options.root = value();
      else if (name === "--tests") options.tests.push(value());
      else if (name === "--tests-index") options.testsIndex = value();
      else if (name === "--release") options.filter.release = value();
      else if (name === "--kind") {
        const kind = value();
        if (!isStoryMapActionKind(kind)) throw new ArgumentError(`--kind must be one of ${storyMapActionKindOrder.join(", ")}`);
        options.filter.kind = kind;
      } else if (name === "--item-type") {
        const type = value();
        if (!isStoryMapActionItemType(type)) throw new ArgumentError(`--item-type must be one of ${storyMapActionItemTypes.join(", ")}`);
        options.filter.itemType = type;
      } else if (arg === "--needs-person") options.filter.needsPerson = true;
      else return null;
    }
    if (options.tests.length && options.testsIndex) throw new ArgumentError("use --tests or --tests-index, not both");
    return { ...options, root: resolve(options.root) };
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    let tests: StoryMapTests | undefined;
    if (options.tests.length) {
      const found = await findStoryTests(loaded, options.root, { paths: options.tests });
      for (const issue of found.issues) report(options.map, issue);
      if (found.issues.some(issue => issue.severity === "error")) {
        process.exitCode = 2;
        return;
      }
      tests = buildStoryMapTests(loaded, found.tests).index;
    } else if (options.testsIndex) {
      const inputs = await loadInputsOrReport({ tests: options.testsIndex });
      if (!inputs) return;
      tests = inputs.tests;
    }
    const { release } = options.filter;
    if (release !== undefined && !loaded.map.releases.some(item => item.id === release)) {
      console.error(`story-map: unknown release '${escapeText(release)}'.`);
      process.exitCode = 1;
      return;
    }
    const all = getStoryMapActions(loaded.map, { tests, locate: loaded.locate });
    const groups = filterStoryMapActions(all, options.filter);
    const total = countStoryMapActions(groups);

    if (options.format === "json") {
      printJson("actions", { total, checkedTests: !!tests, groups });
      return;
    }
    if (!groups.length) {
      console.log(countStoryMapActions(all) ? "No actions match these filters." : "Nothing is waiting on the map.");
      return;
    }
    const lines: string[] = [];
    for (const group of groups) {
      if (lines.length) lines.push("");
      lines.push(`${group.title} (${group.actions.length}): ${group.needsPerson ? "needs a person" : "a person or an agent"}`);
      lines.push(`  ${group.why}`);
      for (const action of group.actions) {
        const at = action.line ? `, line ${action.line}` : "";
        lines.push(`  - ${itemLabel(action)}${at}: ${escapeText(action.message)}`);
        if (action.command) lines.push(`    ${escapeText(action.command)}`);
      }
    }
    lines.push("");
    const people = groups.filter(group => group.needsPerson).reduce((sum, group) => sum + group.actions.length, 0);
    lines.push(`${count(total, "action", "actions")}, ${people} for a person only. Agents act only on the others.`);
    console.log(lines.join("\n"));
  },
});
