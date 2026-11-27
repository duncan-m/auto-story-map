import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deliveryPlanGuideSection } from "../check.js";
import { initStoryMap } from "../init.js";
import { parseStoryMap } from "../schema.js";
import { defineCommand, optionValue } from "./shared.js";

export default defineCommand({
  parse(rest: string[]) {
    let ci = true;
    let skill = false;
    let dir = ".";
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      if (arg === "--no-ci") ci = false;
      else if (arg === "--skill") skill = true;
      else if (arg.split("=")[0] === "--dir") [dir, index] = optionValue(rest, index, "--dir");
      else return null;
    }
    return { ci, skill, dir: resolve(dir) };
  },

  async run(options) {
    let steps;
    try {
      steps = await initStoryMap(options.dir, { ci: options.ci, skill: options.skill });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    for (const step of steps) {
      console.log(`${step.action.padEnd(8)} ${step.path}${step.reason ? ` (${step.reason})` : ""}`);
    }
    const ask = await plansUnchosen(options.dir);
    if (ask) console.log(`${"ask".padEnd(8)} delivery plans (not chosen yet; see ${deliveryPlanGuideSection})`);
    console.log(`
Next, ask an agent in this repository to populate the map:

  Populate product/story-map.yaml for this product using the first-run workflow
  in docs/story-map.md. Start with the primary user journey and cite the
  evidence for each story. Validate the map and flag any uncertain release or
  status decisions for review.${ask ? `
  Then ask me whether to use delivery plans, linking to Write a delivery plan
  in docs/story-map.md, and record my answer with \`story-map settings\`.` : ""}`);
  },
});

/** True when the map has not recorded whether to use delivery plans. A map that cannot be read is left to validate. */
async function plansUnchosen(dir: string) {
  try {
    return parseStoryMap(await readFile(join(dir, "product/story-map.yaml"), "utf8")).settings?.plans === undefined;
  } catch {
    return false;
  }
}
