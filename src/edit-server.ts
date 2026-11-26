import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { personaEditOperations, proposeStoryMapEdit, StoryMapEditError } from "./edit.js";
import { parseStoryMap, type StoryMapDocument } from "./schema.js";

/** The route the board's edit forms post to. */
export const storyMapEditPath = "/api/story-map/edit";

/** The header that carries the page's start-up token. */
export const storyMapEditTokenHeader = "x-story-map-token";

/** A short hash of the map's text, so a save can tell whether the file changed since the page loaded. */
export function storyMapRevision(source: string) {
  return createHash("sha256").update(source).digest("hex").slice(0, 32);
}

/** What `StoryMapBoard` needs in `personaEditing` to show the Personas tab's edit controls. */
export interface StoryMapEditingProps {
  endpoint: string;
  token: string;
  revision: string;
}

/** A request to a host's board or save route: a Fetch `Request` or Node's `IncomingMessage`. */
export type StoryMapEditRequest = Request | IncomingMessage;

/** Options for `createStoryMapEditServer`. */
export interface StoryMapEditServerOptions {
  /** Path to the map file the board shows and edits save to. */
  map: string;
  /**
   * Who may edit. Return `true` only for someone who may see the internal board, using the
   * same rule as the board's `canViewInternal`. It gets the request passed to `read`,
   * `handle` or `handleRequest`. Without `true`, `read` gives no edit props and saves get 403.
   */
  authorize(request: StoryMapEditRequest): boolean | Promise<boolean>;
  /**
   * Whether editing can be on at all. Defaults to on unless `NODE_ENV` is `production`, so a
   * production build never edits. Pass `false` to turn editing off.
   */
  enabled?: boolean;
}

/** What `read` returns for a board route. */
export interface StoryMapEditRead {
  /** The map file's text, read just now. */
  source: string;
  /** The parsed map, for `getStoryMapPage`. */
  document: StoryMapDocument;
  /** Pass as `personaEditing`. `undefined` unless editing is on for this request. */
  editing: StoryMapEditingProps | undefined;
}

/** Saves edits from the board's Personas tab to a map file on this machine. */
export interface StoryMapEditServer {
  /**
   * Reads the map file and, when editing is on for `request`, the props for `personaEditing`.
   * Editing is on when the server is enabled, the request's `Host` is a loopback address and
   * `authorize` returns `true`. Call it on each request for the board, so a save shows on the
   * next load and the next save matches the file. Throws if the map is not valid.
   */
  read(request?: StoryMapEditRequest): Promise<StoryMapEditRead>;
  /**
   * The props to pass as `personaEditing` when rendering a page from `source`, with no checks
   * on the request. For servers that already make them, such as `story-map preview`; a host's
   * board uses `read` instead.
   */
  editing(source: string): StoryMapEditingProps;
  /** Answers a Fetch request to `storyMapEditPath`, for App Router, vinext, Remix, Hono or Workers routes. */
  handleRequest(request: Request): Promise<Response>;
  /** Answers a Node request to `storyMapEditPath`, with the same checks as `handleRequest`. */
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

const maxEditBody = 64 * 1024;
const loopbackHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function isFetchRequest(request: StoryMapEditRequest): request is Request {
  return typeof (request.headers as Headers).get === "function";
}

function header(request: StoryMapEditRequest, name: string): string | undefined {
  if (isFetchRequest(request)) return request.headers.get(name) ?? undefined;
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The request's `Host`, from the header or, for a Fetch request without one, its URL. */
function hostOf(request: StoryMapEditRequest) {
  const host = header(request, "host");
  if (host || !isFetchRequest(request)) return host ?? "";
  try {
    return new URL(request.url).host;
  } catch {
    return "";
  }
}

/** Reads a body up to the size limit. `null` means it was too large. */
async function readFetchBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxEditBody) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readNodeBody(request: IncomingMessage) {
  return new Promise<string | null>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxEditBody) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

interface EditReply {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * Builds the handler that saves Personas tab edits to the map file at `map`, for a
 * server on this machine such as `story-map preview` or a host app's dev server.
 * Editing turns itself off in a production build and for any request whose `Host`
 * is not a loopback address, so a deployed app stays read-only. Edits there would
 * not reach Git, because the file is not the repository.
 *
 * Each save must come from a page this server rendered: a loopback `Host`, an
 * `Origin` that matches it, JSON, and the token made when the handler was built.
 * `authorize` must accept the request too. A save from a page older than the file is
 * refused, so an agent's edit or a `git pull` is not overwritten. Only persona edits
 * are accepted, and they go through `proposeStoryMapEdit`, so comments and untouched
 * lines are kept and the file is written only when the map stays valid.
 */
export function createStoryMapEditServer(options: StoryMapEditServerOptions): StoryMapEditServer {
  const { map } = options;
  if (typeof options.authorize !== "function") {
    throw new TypeError("createStoryMapEditServer needs authorize: a function that returns true for someone who may edit the map, using the same rule as the board's canViewInternal, such as authorize: request => canViewInternal(viewerFrom(request)).");
  }
  const enabled = options.enabled ?? process.env.NODE_ENV !== "production";
  // A new token each time the server starts. Only pages it rendered carry it.
  const token = randomBytes(24).toString("base64url");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const json = (status: number, body: unknown): EditReply => ({ status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" }, body });
  const editing = (source: string): StoryMapEditingProps => ({ endpoint: storyMapEditPath, token, revision: storyMapRevision(source) });

  async function allowed(request: StoryMapEditRequest) {
    return enabled && loopbackHost.test(hostOf(request)) && (await options.authorize(request)) === true;
  }

  async function reply(request: StoryMapEditRequest, readBody: () => Promise<string | null>): Promise<EditReply> {
    if (request.method !== "POST") return { status: 405, headers: { ...headers, Allow: "POST" } };
    if (!enabled) return json(403, { error: "Editing is turned off on this server." });
    const host = hostOf(request);
    const origin = header(request, "origin");
    // A loopback Host stops DNS rebinding, and a matching Origin stops other sites posting.
    if (!loopbackHost.test(host) || (origin !== `http://${host}` && origin !== `https://${host}`)) {
      return json(403, { error: "Edits are only accepted from this server's own pages on this machine." });
    }
    if ((await options.authorize(request)) !== true) {
      return json(403, { error: "You do not have permission to edit this map." });
    }
    if (!/^application\/json(;|$)/i.test(header(request, "content-type") ?? "")) {
      return json(415, { error: "Send the edit as application/json." });
    }
    const sent = Buffer.from(header(request, storyMapEditTokenHeader) ?? "");
    const expected = Buffer.from(token);
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
      return json(403, { error: "This page is from before the server restarted. Reload it, then make the edit again." });
    }
    const text = await readBody();
    if (text === null) return json(413, { error: "The edit is too large." });
    let body: { revision?: unknown; operations?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "The edit is not valid JSON." });
    }
    const operations = body?.operations;
    if (!Array.isArray(operations) || !operations.length) return json(400, { error: "Send a list of operations." });
    if (!operations.every(operation => (personaEditOperations as readonly unknown[]).includes((operation as { op?: unknown })?.op))) {
      return json(400, { error: `Only ${personaEditOperations.join(", ")} edits can be saved here.` });
    }
    const source = await readFile(map, "utf8");
    if (body.revision !== storyMapRevision(source)) {
      return json(409, { error: "The map file changed on disk since this page loaded. Reload to see the latest version, then make the edit again. Nothing was saved." });
    }
    let result;
    try {
      result = await proposeStoryMapEdit(source, operations);
    } catch (error) {
      if (!(error instanceof StoryMapEditError)) throw error;
      return json(422, { error: error.message.replace(/^Edit \d+: /, "") });
    }
    if (!result.valid) {
      const errors = result.check.issues.filter(issue => issue.severity === "error");
      return json(422, { error: errors.map(issue => issue.message).join(" ") || "The edit would make the map invalid.", issues: errors });
    }
    if (result.changed) await writeFile(map, result.source, "utf8");
    return json(200, { changed: result.changed, revision: storyMapRevision(result.source), summary: result.summary ?? "", addedPersonaIds: result.addedPersonaIds });
  }

  return {
    async read(request) {
      const source = await readFile(map, "utf8");
      const document = parseStoryMap(source);
      return { source, document, editing: request && await allowed(request) ? editing(source) : undefined };
    },

    editing,

    async handleRequest(request) {
      const { status, headers: replyHeaders, body } = await reply(request, () => readFetchBody(request));
      return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: replyHeaders });
    },

    async handle(request, response) {
      const { status, headers: replyHeaders, body } = await reply(request, () => readNodeBody(request));
      response.writeHead(status, replyHeaders).end(body === undefined ? undefined : JSON.stringify(body));
    },
  };
}
