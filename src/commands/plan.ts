import { deliveryPlanGuideLink } from "../check.js";
import { closestIds } from "../read.js";
import { defaultPlansFolder, storyMapPlan } from "../plan.js";
import { getStoryMapForViewer, type StoryMapView } from "../view.js";
import { defineCommand, escapeText, loadMapOrReport, optionValue } from "./shared.js";

export default defineCommand({
  parse(rest: string[]) {
    let map = "product/story-map.yaml";
    let release: string | undefined;
    const ids: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (name === "--map") [map, index] = optionValue(rest, index, name);
      else if (name === "--release") [release, index] = optionValue(rest, index, name);
      else if (arg.startsWith("-")) return null;
      else ids.push(arg);
    }
    // Either stories or a release, not both.
    if (!!release === !!ids.length) return null;
    return { map, release, ids };
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    const chosen = loaded.map.settings?.plans;
    const view = getStoryMapForViewer(loaded.map, {}, { canViewInternal: () => true }) as StoryMapView;
    let skeleton;
    try {
      skeleton = storyMapPlan(view, options.release ? { release: options.release } : { stories: options.ids }, {
        plansFolder: typeof chosen === "string" ? chosen : defaultPlansFolder,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      process.exitCode = 1;
      const missing = options.ids.find(id => !loaded.map.stories.some(story => story.id === id));
      const suggestions = missing ? closestIds(missing, loaded.map.stories.map(story => story.id)) : [];
      console.error(`story-map: ${escapeText(error.message)}${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""}`);
      return;
    }
    // The skeleton goes to standard output, so it can be piped into a file; everything else goes to standard error.
    if (chosen === undefined) {
      console.error(`notice: Delivery plans: not chosen yet. Ask the person whether to use them, see ${await deliveryPlanGuideLink(process.cwd())}, and record the answer with \`story-map settings --plans <folder>\` or \`--plans off\`.`);
    } else if (chosen === false) {
      console.error("note: this product has chosen not to keep delivery plans (settings.plans is false), so save this only if a person asked for it.");
    }
    process.stdout.write(escapeMarkdown(skeleton.markdown));
    console.error(`Suggested path: ${escapeText(skeleton.path)}. The skeleton is printed only: save it to a new file, and never over an existing plan.`);
  },
});

/** Map text reaches the terminal, so escape controls but keep the line breaks. */
const escapeMarkdown = (markdown: string) => markdown.split("\n").map(escapeText).join("\n");
