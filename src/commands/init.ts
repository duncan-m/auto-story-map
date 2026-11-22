import { resolve } from "node:path";
import { initStoryMap } from "../init.js";
import { defineCommand, optionValue } from "./shared.js";

export default defineCommand({
  parse(rest: string[]) {
    let ci = true;
    let dir = ".";
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      if (arg === "--no-ci") ci = false;
      else if (arg.split("=")[0] === "--dir") [dir, index] = optionValue(rest, index, "--dir");
      else return null;
    }
    return { ci, dir: resolve(dir) };
  },

  async run(options) {
    let steps;
    try {
      steps = await initStoryMap(options.dir, { ci: options.ci });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    for (const step of steps) {
      console.log(`${step.action.padEnd(8)} ${step.path}${step.reason ? ` (${step.reason})` : ""}`);
    }
    console.log(`
Next, ask an agent in this repository to populate the map:

  Populate product/story-map.yaml for this product using the first-run workflow
  in docs/story-map.md. Start with the primary user journey and cite the
  evidence for each story. Validate the map and flag any uncertain release or
  status decisions for review.`);
  },
});
