import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import type { ReactNode } from "react";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { renderToStaticMarkup } from "react-dom/server";
import { checkStoryMap, type StoryMapCheckIssue } from "./check.js";
import { createStoryMapEditServer, storyMapEditPath } from "./edit-server.js";
import { storyMapExportResponse } from "./export-response.js";
import { parseStoryMapHistory } from "./history.js";
import { StoryMapBoard } from "./react.js";
import { loadStoryMap } from "./schema.js";
import { parseStoryMapTests } from "./tests-index.js";
import { getStoryMapForViewer, getStoryMapPage, storyMapResponseHeaders } from "./view.js";

/** Options for `createStoryMapPreviewServer`. Files are read again on every request, so edits show on reload. */
export interface StoryMapPreviewOptions {
  /** Path to the map. */
  map: string;
  /** History from `story-map history`. */
  history?: string;
  /** Tests index from `story-map tests`. */
  tests?: string;
  /** Base URL that repository-relative sources link to, such as a GitHub `blob/main/` URL. */
  sourceBaseUrl?: string;
  /**
   * Lets the Personas tab save edits to the map file, through `POST /api/story-map/edit`.
   * On by default, because the preview only runs on this machine. Pass `false` for a
   * read-only preview. Saves are checked as `createStoryMapEditServer` describes.
   */
  writable?: boolean;
}

export { storyMapEditTokenHeader as previewTokenHeader, storyMapRevision } from "./edit-server.js";

/** The route the writable preview saves edits to. */
export const previewEditPath = storyMapEditPath;

/** The only addresses the preview answers to. It refuses other `Host` headers, so a web page cannot reach it through DNS rebinding. */
export const previewHost = "127.0.0.1";

const views = [["internal", "Internal"], ["customer", "Signed-in customer"]] as const;
type PreviewView = (typeof views)[number][0];

const pageStyles = `
body { margin: 0; font: 1rem system-ui, -apple-system, "Segoe UI", sans-serif; background: #f5f7fb; color: #19223a; }
.preview-bar { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; justify-content: space-between; padding: .6rem clamp(1rem, 4vw, 3rem); background: #fff; border-bottom: 1px solid #dfe4ed; font-size: .875rem; }
.preview-bar strong { font-weight: 700; }
.preview-bar nav { display: flex; gap: .35rem; }
.preview-bar a { padding: .35rem .65rem; border: 1px solid transparent; border-radius: 8px; color: #52617a; font-weight: 600; text-decoration: none; }
.preview-bar a[aria-current="page"] { border-color: #dfe4ed; color: #4b43a8; }
.preview-bar a:focus-visible { outline: 2px solid #5046d5; outline-offset: 2px; }
main { max-width: 1700px; margin: 0 auto; padding: 28px clamp(1rem, 4vw, 3rem) 40px; }
.preview-issues { margin: 0 0 1.5rem; padding: .9rem 1.1rem; border: 1px solid #e6c36a; border-radius: 10px; background: #fff8e6; }
.preview-issues.error { border-color: #e39a9a; background: #fdeeee; }
.preview-issues h2 { margin: 0 0 .5rem; font-size: 1rem; }
.preview-issues ul { margin: 0; padding-left: 1.2rem; }
.preview-issues code { font-size: .85em; }
@media (prefers-color-scheme: dark) {
  body { background: #11151f; color: #e4e8f1; }
  .preview-bar { background: #181d2a; border-color: #2b3243; }
  .preview-bar a { color: #aab4c8; }
  .preview-bar a[aria-current="page"] { border-color: #2b3243; color: #b9b3ff; }
  .preview-issues { background: #2a2411; border-color: #6b5a24; }
  .preview-issues.error { background: #2c1616; border-color: #7a3434; }
}`;

function Issues({ issues, kind }: { issues: StoryMapCheckIssue[]; kind: "error" | "warning" }) {
  const shown = issues.filter(issue => issue.severity === kind);
  if (!shown.length) return null;
  const title = kind === "error"
    ? `The map is not valid, so it cannot be shown. Fix ${shown.length === 1 ? "this error" : `these ${shown.length} errors`} and reload.`
    : `${shown.length} ${shown.length === 1 ? "warning" : "warnings"}. The map is still valid.`;
  const list = (
    <ul>
      {shown.map((issue, index) => (
        <li key={index}>
          {issue.line ? <code>{`line ${issue.line}${issue.column ? `:${issue.column}` : ""}`}</code> : null}
          {issue.line ? " " : null}
          {issue.target ? <code>{issue.target}</code> : null}
          {issue.target ? ": " : null}
          {issue.message}
        </li>
      ))}
    </ul>
  );
  return (
    <section className={`preview-issues ${kind}`} aria-label={kind === "error" ? "Validation errors" : "Validation warnings"}>
      {kind === "error" ? <><h2>{title}</h2>{list}</> : <details><summary>{title}</summary>{list}</details>}
    </section>
  );
}

function page(title: string, view: PreviewView, mapPath: string, body: ReactNode, writable = false) {
  const html = renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} (preview)`}</title>
        <link rel="stylesheet" href="/story-map.css" />
        <style>{pageStyles}</style>
        <script type="module" src="/story-map-board.js" />
      </head>
      <body>
        <header className="preview-bar">
          <span><strong>Story map preview</strong> of <code>{mapPath}</code>. {writable ? "Local only. Edits on the Personas tab save to this file." : "Local only, for checking the map."}</span>
          <nav aria-label="View">
            {views.map(([id, label]) => (
              <a key={id} href={`/story-map?view=${id}`} aria-current={view === id ? "page" : undefined}>{label}</a>
            ))}
          </nav>
        </header>
        <main>{body}</main>
      </body>
    </html>,
  );
  return `<!doctype html>${html}`;
}

async function readOptional<T>(path: string | undefined, parse: (source: string) => T): Promise<T | undefined> {
  return path ? parse(await readFile(path, "utf8")) : undefined;
}

/** True when the `Host` header names the loopback address or localhost on the port the server is listening on. */
function allowedHost(request: IncomingMessage, port: number) {
  const host = request.headers.host?.toLowerCase();
  return host === `${previewHost}:${port}` || host === `localhost:${port}`;
}

/**
 * Builds the local preview server behind `story-map preview`: the board for the
 * map at `options.map`, with internal and customer views, the JSON view at
 * `/api/story-map` and the export route. It answers only GET requests whose
 * `Host` is the loopback address or localhost. Listen on `previewHost` only.
 * It is for one person checking a map, never for deploying.
 */
export function createStoryMapPreviewServer(options: StoryMapPreviewOptions): Server {
  const assets = new Map<string, Promise<[string, string]>>([
    ["/story-map.css", readFile(new URL("../styles.css", import.meta.url), "utf8").then(text => ["text/css; charset=utf-8", text])],
    ["/story-map-board.js", readFile(new URL("./board.js", import.meta.url), "utf8").then(text => ["text/javascript; charset=utf-8", text])],
  ]);
  // Catch here so a missing asset fails its request, not the process.
  for (const asset of assets.values()) asset.catch(() => {});
  const headers = { ...storyMapResponseHeaders };
  const writable = options.writable !== false;
  // Only this machine can reach the preview, and its Host check runs first, so whoever opens it may edit.
  const editor = writable ? createStoryMapEditServer({ map: options.map, authorize: () => true, enabled: true }) : undefined;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!allowedHost(request, port)) {
      response.writeHead(421, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end("The preview only answers requests to 127.0.0.1 or localhost.");
      return;
    }
    const url = new URL(request.url ?? "/", `http://${previewHost}`);
    if (url.pathname === previewEditPath) {
      if (editor) {
        await editor.handle(request, response);
      } else {
        response.writeHead(403, { ...headers, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "This preview is read-only. Start it without --read-only to save edits." }));
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end();
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(302, { ...headers, Location: "/story-map" }).end();
      return;
    }
    const asset = assets.get(url.pathname);
    if (asset) {
      const [type, text] = await asset;
      response.writeHead(200, { ...headers, "Content-Type": type }).end(text);
      return;
    }
    const isApi = url.pathname === "/api/story-map";
    const isExport = url.pathname === "/story-map/export";
    if (!isApi && !isExport && url.pathname !== "/story-map") {
      response.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end("Page not found.");
      return;
    }

    const view: PreviewView = url.searchParams.get("view") === "customer" ? "customer" : "internal";
    const source = await readFile(options.map, "utf8");
    const checked = await checkStoryMap(source);
    if (!checked.valid) {
      if (isApi || isExport) {
        response.writeHead(422, { ...headers, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "The map is not valid.", issues: checked.issues }));
        return;
      }
      const html = page("Story map", view, options.map, <Issues issues={checked.issues} kind="error" />);
      response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" }).end(html);
      return;
    }

    const document = loadStoryMap(source).map;
    const history = await readOptional(options.history, parseStoryMapHistory);
    const tests = await readOptional(options.tests, parseStoryMapTests);
    const internal = view === "internal";
    const mapPath = relative(process.cwd(), options.map).split(sep).join("/") || options.map;
    // The source gives each action on the Actions tab its line in the map.
    const access = { canViewInternal: () => internal, history, tests, mapFile: { path: mapPath, source } };
    // The customer view is a signed-in customer with no internal role.
    const viewer = { roles: [] as string[] };

    if (isExport) {
      const full = getStoryMapForViewer(document, viewer, access);
      if (full?.audience !== "internal") {
        response.writeHead(403, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end("Customers cannot export the map.");
        return;
      }
      try {
        const file = storyMapExportResponse(full, { format: url.searchParams.get("format"), collapsed: url.searchParams.get("collapsed") });
        response.writeHead(200, { ...headers, ...file.headers }).end(typeof file.body === "string" ? file.body : Buffer.from(file.body));
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        response.writeHead(400, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end("Choose format=vsdx, format=csv or format=json.");
      }
      return;
    }

    // The page writes an agent brief for each open story and release panel, naming the map as it is in the repository.
    const brief = isApi ? undefined : { mapPath };
    const map = getStoryMapPage(document, viewer, { ...access, searchParams: url.searchParams, ...(brief ? { brief } : {}) });
    const message = "This map has visibility: internal, so signed-in customers see nothing. Set visibility: all-users and add customer copy to show it to them.";
    if (isApi) {
      response.writeHead(map ? 200 : 403, { ...headers, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(map ?? { error: message }));
      return;
    }
    const body = (
      <>
        {internal ? <Issues issues={checked.issues} kind="warning" /> : null}
        {map
          ? <StoryMapBoard map={map} sourceBaseUrl={options.sourceBaseUrl} preservedParams={{ view }} exportHref={internal ? "/story-map/export?view=internal" : undefined} personaEditing={internal ? editor?.editing(source) ?? false : undefined} />
          : <p>{message}</p>}
      </>
    );
    response.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" }).end(page(document.title, view, options.map, body, writable));
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      // A file that cannot be read, such as a history file mid-write, fails the request and the server keeps running.
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        response.writeHead(500, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end(`The preview could not load the map: ${message}`);
      } else {
        response.end();
      }
    });
  });
  return server;
}
