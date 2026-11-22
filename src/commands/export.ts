import { defaultExportMaxStories, prepareStoryMapExport } from "../export.js";
import { storyMapToCsv } from "../export-csv.js";
import { jsonDefaultMaxStories, storyMapToJson } from "../export-json.js";
import { storyMapExportFormats } from "../export-response.js";
import { storyMapToVsdx } from "../export-vsdx.js";
import { getStoryMapForViewer } from "../view.js";
import { ArgumentError, defineCommand, escapeText, loadInputsOrReport, loadMapOrReport, optionValue, writeOutput } from "./shared.js";

const exportFormats = storyMapExportFormats;

export default defineCommand({
  parse(rest: string[]) {
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
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    const document = loaded.map;
    const inputs = await loadInputsOrReport({ history: options.history, tests: options.tests });
    if (!inputs) return;
    if (options.tests && options.format !== "json") console.error(`warning: --tests-index is only used by --format json, so it is ignored`);
    const releaseIds = new Set(document.releases.map(release => release.id));
    if (options.format === "json" && options.collapsed.length) {
      console.error("warning: --collapsed is ignored by --format json, which includes every release");
      options.collapsed = [];
    }
    for (const id of options.collapsed) {
      if (!releaseIds.has(id)) console.error(`warning: --collapsed ${escapeText(id)} is not a release in ${escapeText(options.map)}, so it is ignored`);
    }

    // Whoever runs the CLI has the YAML file, so the export is always the internal view.
    const view = getStoryMapForViewer(document, {}, { canViewInternal: () => true, ...inputs })!;
    const exportOptions = { collapsedReleases: options.collapsed, maxStories: options.maxStories ?? (options.format === "json" ? jsonDefaultMaxStories : defaultExportMaxStories) };
    const file = options.format === "csv" ? storyMapToCsv(view, exportOptions)
      : options.format === "json" ? storyMapToJson(view, exportOptions)
      : storyMapToVsdx(view, exportOptions);
    if (!await writeOutput(file, options.output)) return;
    const { available, omitted } = prepareStoryMapExport(view, exportOptions);
    const collapsedCount = document.stories.length - available;
    const details = [
      omitted && `left out ${omitted} less recently changed`,
      collapsedCount && `${collapsedCount} in collapsed lanes`,
    ].filter(Boolean);
    const exported = available - omitted;
    console.error(`${options.output}: exported ${exported} ${exported === 1 ? "story" : "stories"}${details.length ? ` (${details.join(", ")})` : ""}`);
  },
});
