#!/usr/bin/env node
// Writes the builder estimates sample map as a .vsdx, with one lane collapsed, for
// the LibreOffice check in CI. Run `npm run build` first.
//
//   node scripts/export-sample-vsdx.mjs out.vsdx

import { readFileSync, writeFileSync } from "node:fs";
import { getStoryMapForViewer, parseStoryMap, storyMapToVsdx } from "embedded-story-map";

const out = process.argv[2] ?? "story-map-sample.vsdx";
const map = parseStoryMap(readFileSync(new URL("../test/fixtures/builder-estimates.yaml", import.meta.url), "utf8"));
const view = getStoryMapForViewer(map, { roles: ["engineer"] });
writeFileSync(out, storyMapToVsdx(view, { collapsedReleases: [map.releases.at(-1).id], now: new Date("2026-11-20") }));
console.log(`Wrote ${out}`);
