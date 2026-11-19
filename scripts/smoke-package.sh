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

node --input-type=module - "$repo_dir/product/story-map.yaml" "$react_major" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, version } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStoryMapForViewer, parseStoryMap } from "embedded-story-map";
import { StoryMapBoard } from "embedded-story-map/react";

const [, , mapPath, reactMajor] = process.argv;
const map = parseStoryMap(readFileSync(mapPath, "utf8"));
const view = getStoryMapForViewer(map, { roles: [] });
assert.equal(view?.audience, "all-users");
assert.ok(view.stories.length > 0);

const html = renderToStaticMarkup(createElement(StoryMapBoard, { map: view }));
assert.match(html, /class="esm-board"/);
assert.match(html, /class="esm-card"/);

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(resolve("embedded-story-map/styles.css"), "utf8");
assert.match(css, /\.esm-board\s*\{/);
assert.equal(version.split(".")[0], reactMajor);
console.log(`Packed imports, board and stylesheet work with React ${version}.`);
NODE
