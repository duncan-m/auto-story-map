// Writes the JSON Schema that editors use to autocomplete and check story map YAML.
// Runs after `tsc`, so it reads the compiled schema.
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { storyMapSchema } from "../dist/schema.js";

const schema = {
  ...z.toJSONSchema(storyMapSchema, { io: "input" }),
  $id: "https://raw.githubusercontent.com/duncan-m/auto-story-map/main/story-map.schema.json",
};
await writeFile(new URL("../story-map.schema.json", import.meta.url), JSON.stringify(schema, null, 2) + "\n");
