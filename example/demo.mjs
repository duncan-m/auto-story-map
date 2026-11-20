import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createElement as h } from "react";
import { parseStoryMap } from "embedded-story-map";
import { buildStoryMapHistory } from "../dist/history-git.js";
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
const scripts = new Map([
  ["/story-map-board.js", await readFile(new URL("../dist/board.js", import.meta.url), "utf8")],
]);
const mapFile = new URL("../product/story-map.yaml", import.meta.url);
const sourceBaseUrl = "https://github.com/duncan-m/embedable-story-map/blob/main/";
// This product also gives product managers the internal view.
const internalRoles = new Set(["engineer", "super-admin", "product-manager"]);
const canViewInternal = viewer => viewer.roles.some(role => internalRoles.has(role));

// A product would run `story-map history --out <file>` in its build. The demo reads its own Git history at startup.
let history = null;
try {
  // This repository's map edits were authored by a coding agent as "Claude", so credit whoever merged them.
  history = await buildStoryMapHistory({ cwd: new URL("..", import.meta.url).pathname, allowShallow: true, botNames: ["Claude"] });
} catch (error) {
  console.warn(`Status history is unavailable: ${error.message}`);
}

// Set STORY_MAP_DEMO_NOW to a later date, such as 2027-01-15, to see in-progress stories flagged as stalled.
const now = process.env.STORY_MAP_DEMO_NOW ? new Date(process.env.STORY_MAP_DEMO_NOW) : undefined;
if (now && Number.isNaN(now.getTime())) throw new Error("STORY_MAP_DEMO_NOW must be a date, such as 2027-01-15.");

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/story-map" }).end();
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
    const roles = demoRoles.get(selected);
    const viewer = roles ? { roles } : null;
    const views = [["user", "Regular user"], ["product", "Product manager"], ["engineer", "Engineer"], ["super-admin", "Super admin"], ["guest", "Guest"]];
    const navigation = h("nav", { "aria-label": "Demo roles" },
      views.map(([role, label]) => h("a", {
        key: role,
        href: `/story-map?as=${role}`,
        "aria-current": selected === role ? "page" : undefined,
      }, label)),
    );

    const map = parseStoryMap(await readFile(mapFile, "utf8"));
    const result = makeStoryMapResponse(url, map, viewer, {
      navigation,
      sourceBaseUrl,
      canViewInternal,
      history,
      now,
      preservedParams: { as: selected },
    });
    response.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text());
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
