#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseStoryMap } from "./schema.js";

const [command, ...paths] = process.argv.slice(2);
if (command !== "validate" || paths.length === 0) {
  console.error("Usage: story-map validate <map.yaml> [other-map.yaml ...]");
  process.exitCode = 2;
} else {
  for (const path of paths) {
    try {
      const map = parseStoryMap(await readFile(path, "utf8"));
      console.log(`${path}: valid (${map.activities.length} activities, ${map.releases.length} releases, ${map.stories.length} stories)`);
    } catch (error) {
      console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
