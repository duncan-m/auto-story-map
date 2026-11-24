import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { personaEditOperations, proposeStoryMapEdit, StoryMapEditError } from "./edit.js";

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

/** Saves edits from the board's Personas tab to a map file on this machine. */
export interface StoryMapEditServer {
  /** The props to pass as `personaEditing` when rendering a page from `source`, the map text the page shows. */
  editing(source: string): StoryMapEditingProps;
  /** Answers a request to `storyMapEditPath`. */
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

const maxEditBody = 64 * 1024;
const loopbackHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/**
 * Builds the handler that saves Personas tab edits to the map file at `map`, for a
 * server on this machine such as `story-map preview` or a local development host.
 * Never mount it on a deployed server: the file there is not the repository, so
 * edits would not reach Git.
 *
 * Each save must come from a page this server rendered: a loopback `Host`, an
 * `Origin` that matches it, JSON, and the token made when the handler was built.
 * A save from a page older than the file is refused, so an agent's edit or a
 * `git pull` is not overwritten. Only persona edits are accepted, and they go
 * through `proposeStoryMapEdit`, so comments and untouched lines are kept and the
 * file is written only when the map stays valid.
 */
export function createStoryMapEditServer({ map }: { map: string }): StoryMapEditServer {
  // A new token each time the server starts. Only pages it rendered carry it.
  const token = randomBytes(24).toString("base64url");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  };

  const readBody = (request: IncomingMessage) => new Promise<string | null>((resolve, reject) => {
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

  return {
    editing: source => ({ endpoint: storyMapEditPath, token, revision: storyMapRevision(source) }),

    async handle(request, response) {
      if (request.method !== "POST") {
        response.writeHead(405, { ...headers, Allow: "POST" }).end();
        return;
      }
      const host = request.headers.host ?? "";
      // A loopback Host stops DNS rebinding, and a matching Origin stops other sites posting.
      if (!loopbackHost.test(host) || request.headers.origin !== `http://${host}`) {
        json(response, 403, { error: "Edits are only accepted from this server's own pages on this machine." });
        return;
      }
      if (!/^application\/json(;|$)/i.test(request.headers["content-type"] ?? "")) {
        json(response, 415, { error: "Send the edit as application/json." });
        return;
      }
      const sent = Buffer.from(String(request.headers[storyMapEditTokenHeader] ?? ""));
      const expected = Buffer.from(token);
      if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
        json(response, 403, { error: "This page is from before the server restarted. Reload it, then make the edit again." });
        return;
      }
      const text = await readBody(request);
      if (text === null) {
        json(response, 413, { error: "The edit is too large." });
        return;
      }
      let body: { revision?: unknown; operations?: unknown };
      try {
        body = JSON.parse(text);
      } catch {
        json(response, 400, { error: "The edit is not valid JSON." });
        return;
      }
      const operations = body?.operations;
      if (!Array.isArray(operations) || !operations.length) {
        json(response, 400, { error: "Send a list of operations." });
        return;
      }
      if (!operations.every(operation => (personaEditOperations as readonly unknown[]).includes((operation as { op?: unknown })?.op))) {
        json(response, 400, { error: `Only ${personaEditOperations.join(", ")} edits can be saved here.` });
        return;
      }
      const source = await readFile(map, "utf8");
      if (body.revision !== storyMapRevision(source)) {
        json(response, 409, { error: "The map file changed on disk since this page loaded. Reload to see the latest version, then make the edit again. Nothing was saved." });
        return;
      }
      let result;
      try {
        result = await proposeStoryMapEdit(source, operations);
      } catch (error) {
        if (!(error instanceof StoryMapEditError)) throw error;
        json(response, 422, { error: error.message.replace(/^Edit \d+: /, "") });
        return;
      }
      if (!result.valid) {
        const errors = result.check.issues.filter(issue => issue.severity === "error");
        json(response, 422, { error: errors.map(issue => issue.message).join(" ") || "The edit would make the map invalid.", issues: errors });
        return;
      }
      if (result.changed) await writeFile(map, result.source, "utf8");
      json(response, 200, { changed: result.changed, revision: storyMapRevision(result.source), summary: result.summary ?? "" });
    },
  };
}
