#!/usr/bin/env bash
set -euo pipefail

react_major="${1:?Usage: bash scripts/smoke-package.sh <react-major>}"
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
consumer_dir="$(mktemp -d)"
trap 'rm -rf -- "$consumer_dir"' EXIT

cd "$repo_dir"
archive="$(npm pack --silent --pack-destination "$consumer_dir")"
# The build writes source maps for coverage (ESM-177), but the package leaves them out.
if tar -tzf "$consumer_dir/$archive" | grep -q '\.map$'; then
  echo "The package includes source maps; package.json files should exclude dist/**/*.map." >&2
  exit 1
fi

cd "$consumer_dir"
npm init --yes >/dev/null
npm install --no-audit --no-fund "./$archive" "react@$react_major" "react-dom@$react_major"
./node_modules/.bin/story-map validate "$repo_dir/product/story-map.yaml"
./node_modules/.bin/story-map init
./node_modules/.bin/story-map validate product/story-map.yaml
test -s docs/story-map.md && test -s AGENTS.md && test -s .github/workflows/story-map.yml
# init records the version each part came from, and the package ships the hashes of earlier templates.
head -n 1 docs/story-map.md | grep -Eq '^<!-- auto-story-map [^ ]+ sha256:[0-9a-f]{64} -->$'
test -s node_modules/auto-story-map/templates/known-versions.json

node --input-type=module - "$repo_dir/product/story-map.yaml" "$react_major" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, version } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filterStoryMapView, getStoryMapForViewer, parseStoryMap } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

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
const css = readFileSync(resolve("auto-story-map/styles.css"), "utf8");
assert.match(readFileSync(resolve("auto-story-map/board.js"), "utf8"), /export function enhanceStoryMapFilters/);
assert.match(css, /\.esm-board\s*\{/);
const schema = JSON.parse(readFileSync(resolve("auto-story-map/schema.json"), "utf8"));
assert.equal(schema.properties.version.const, 1);
assert.equal(version.split(".")[0], reactMajor);
console.log(`Packed imports, board, board script, stylesheet and JSON Schema work with React ${version}.`);
NODE
