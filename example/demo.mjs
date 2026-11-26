import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { createStoryMapEditServer, storyMapEditPath } from "auto-story-map";
import { buildStoryMapHistory } from "../dist/history-git.js";
import { loadStoryMap } from "../dist/schema.js";
import { buildStoryMapTests, findStoryTests } from "../dist/tests.js";
import { makeStoryMapResponse } from "./host.mjs";

// Local-only role switch for checking the example views.
const demoRoles = new Map([
  ["user", []],
  ["product", ["product-manager"]],
  ["engineer", ["engineer"]],
  ["super-admin", ["super-admin"]],
]);
const styles = new Map([
  ["/story-map.css", await readFile(new URL("../styles.css", import.meta.url), "utf8")],
  ["/example-host.css", await readFile(new URL("./host.css", import.meta.url), "utf8")],
]);
const favicon = await readFile(new URL("./favicon.svg", import.meta.url), "utf8");
const scripts = new Map([
  ["/story-map-board.js", await readFile(new URL("../dist/board.js", import.meta.url), "utf8")],
]);
const mapFile = new URL("../product/story-map.yaml", import.meta.url);
// A file path, not URL.pathname, which keeps %20 for spaces and gives /C:/… on Windows.
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceBaseUrl = "https://github.com/duncan-m/auto-story-map/blob/main/";
// Links history lines to the pull request and commit behind each change.
const repositoryUrl = "https://github.com/duncan-m/auto-story-map";
// This product also gives product managers the internal view.
const internalRoles = new Set(["engineer", "super-admin", "product-manager"]);
const canViewInternal = viewer => viewer.roles.some(role => internalRoles.has(role));

// A product would run `story-map history --out <file>` in its build. The demo reads its own Git history at startup.
let history = null;
try {
  // This repository's map edits were authored by a coding agent as "Claude", so credit whoever merged them.
  history = await buildStoryMapHistory({ cwd: repositoryRoot, allowShallow: true, botNames: ["Claude"] });
} catch (error) {
  console.warn(`Status history is unavailable: ${error.message}`);
}

// A product would run `story-map tests --tests test --out <file>` in its build and parse it with
// parseStoryMapTests. The demo scans this repository's own tests at startup.
let tests = null;
try {
  const loaded = loadStoryMap(await readFile(mapFile, "utf8"));
  const found = await findStoryTests(loaded, repositoryRoot, { paths: ["test"] });
  tests = buildStoryMapTests(loaded, found.tests).index;
} catch (error) {
  console.warn(`Tests are unavailable: ${error.message}`);
}

// The demo's viewer comes from ?as= on the page. A save posts from that page, so its Referer carries it.
function viewerFrom(request) {
  const page = new URL(request.url ?? "/", "http://localhost").pathname === storyMapEditPath ? request.headers.referer : request.url;
  const roles = demoRoles.get(new URL(page ?? "/", "http://localhost").searchParams.get("as") ?? "super-admin");
  return roles ? { roles } : null;
}

// Internal viewers can edit personas on the Personas tab, and the edits save to
// product/story-map.yaml. Editing turns itself off in a production build and for any Host
// that is not this machine, so a deployed copy, which is not the repository, stays read-only.
const editor = createStoryMapEditServer({
  map: fileURLToPath(mapFile),
  authorize: request => {
    const viewer = viewerFrom(request);
    return !!viewer && canViewInternal(viewer);
  },
});

// Set STORY_MAP_DEMO_NOW to a later date, such as 2027-01-15, to see in-progress stories flagged as stalled.
const now = process.env.STORY_MAP_DEMO_NOW ? new Date(process.env.STORY_MAP_DEMO_NOW) : undefined;
if (now && Number.isNaN(now.getTime())) throw new Error("STORY_MAP_DEMO_NOW must be a date, such as 2027-01-15.");

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === storyMapEditPath) {
      await editor.handle(request, response);
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/story-map" }).end();
      return;
    }
    if (url.pathname === "/favicon.svg") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" }).end(favicon);
      return;
    }
    if (scripts.has(url.pathname)) {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(scripts.get(url.pathname));
      return;
    }
    if (styles.has(url.pathname)) {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" }).end(styles.get(url.pathname));
      return;
    }

    const selected = url.searchParams.get("as") ?? "super-admin";
    const viewer = viewerFrom(request);
    const views = [["user", "Regular user"], ["product", "Product manager"], ["engineer", "Engineer"], ["super-admin", "Super admin"], ["guest", "Guest"]];
    const navigation = h("nav", { "aria-label": "Demo roles" },
      views.map(([role, label]) => h("a", {
        key: role,
        href: `/story-map?as=${role}`,
        "aria-current": selected === role ? "page" : undefined,
      }, label)),
    );

    // Read the file on each request, so a save shows on the next load and the next save matches it.
    const { document: map, editing } = await editor.read(request);
    const result = makeStoryMapResponse(url, map, viewer, {
      navigation,
      brief: {
        readFirst: [
          { path: "docs/ENGINEERING-OVERVIEW.md", about: "architecture and the behaviour to preserve" },
          { path: "docs/story-map.md", about: "map rules" },
        ],
        validateCommand: "npm run validate",
      },
      // Offers Open in Claude and Open in ChatGPT in each panel's Share menu. They send the brief to those companies.
      webAgents: ["claude", "claude-code", "chatgpt"],
      sourceBaseUrl,
      repositoryUrl,
      canViewInternal,
      history,
      tests,
      now,
      preservedParams: { as: selected },
      personaEditing: editing,
    });
    response.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
      .end("The story map could not be loaded. Check the local server output.");
  }
});

const host = "127.0.0.1";
server.listen(Number(process.env.STORY_MAP_DEMO_PORT ?? 4173), host, () => {
  console.log(`Story map demo at http://${host}:${server.address().port}/story-map`);
});
