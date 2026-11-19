#!/usr/bin/env bash
set -euo pipefail

react_major="${1:?Usage: bash scripts/smoke-package.sh <react-major>}"
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
consumer_dir="$(mktemp -d)"
trap 'rm -rf -- "$consumer_dir"' EXIT

cd "$repo_dir"
archive="$(npm pack --silent --pack-destination "$consumer_dir")"

cd "$consumer_dir"
npm init --yes >/dev/null
npm install --no-audit --no-fund "./$archive" "react@$react_major" "react-dom@$react_major"
./node_modules/.bin/story-map validate "$repo_dir/product/story-map.yaml"
./node_modules/.bin/story-map init
./node_modules/.bin/story-map validate product/story-map.yaml
test -s docs/story-map.md && test -s AGENTS.md && test -s .github/workflows/story-map.yml

node --input-type=module - "$repo_dir/product/story-map.yaml" "$react_major" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, version } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filterStoryMapView, getStoryMapForViewer, parseStoryMap } from "embedded-story-map";
import { StoryMapBoard } from "embedded-story-map/react";

const [, , mapPath, reactMajor] = process.argv;
const map = parseStoryMap(readFileSync(mapPath, "utf8"));
const view = getStoryMapForViewer(map, { roles: [] });
assert.equal(view?.audience, "all-users");
assert.ok(view.stories.length > 0);

const reactErrors = [];
const consoleError = console.error;
console.error = (...args) => reactErrors.push(args.join(" "));
const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
const internal = filterStoryMapView(getStoryMapForViewer(map, { roles: ["engineer"] }), { status: "planned" });
const internalHtml = renderToStaticMarkup(createElement(StoryMapBoard, { map: internal, preservedParams: { tab: "map" } }));
console.error = consoleError;
assert.deepEqual(reactErrors, []);
assert.match(html, /class="esm-board"/);
assert.match(html, /class="esm-card"/);
assert.match(internalHtml, /<form class="esm-filters"/);

// Every card must open its panel without client JavaScript, whichever React version renders it.
const targets = [...internalHtml.matchAll(/class="esm-card"[^>]*popovertarget="([^"]+)"/gi)].map(match => match[1]);
assert.ok(targets.length > 0);
for (const target of targets) {
  assert.ok(internalHtml.includes(`id="${target}" popover="auto"`), `missing panel ${target}`);
}
assert.match(internalHtml, /autofocus=""[^>]*popovertargetaction="hide"/i);

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(resolve("embedded-story-map/styles.css"), "utf8");
assert.match(css, /\.esm-board\s*\{/);
const schema = JSON.parse(readFileSync(resolve("embedded-story-map/schema.json"), "utf8"));
assert.equal(schema.properties.version.const, 1);
assert.equal(version.split(".")[0], reactMajor);
console.log(`Packed imports, board, stylesheet and JSON Schema work with React ${version}.`);
NODE
