import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStoryMapForViewer, getStoryMapPage, storyMapExportResponse, storyMapResponseHeaders } from "auto-story-map";
import { StoryMapBoard } from "auto-story-map/react";

// The enclosing app supplies a viewer from its verified session.
// `target` is the request URL or path, including any `q` and `status` filter parameters.
export function makeStoryMapResponse(target, document, viewer, options = {}) {
  const { navigation = null, sourceBaseUrl, preservedParams, canViewInternal, history, tests, stalledAfterWeeks, now } = options;
  const url = new URL(target, "http://localhost");
  const headers = storyMapResponseHeaders;
  const isApi = url.pathname === "/api/story-map";

  if (url.pathname === "/story-map/export") {
    // An export is the whole map, so build the view without filters.
    const view = getStoryMapForViewer(document, viewer, { canViewInternal, history, tests });
    if (view?.audience !== "internal") {
      return new Response("Only the product team can export the story map.", { status: viewer ? 403 : 401, headers });
    }
    try {
      const file = storyMapExportResponse(view, { format: url.searchParams.get("format"), collapsed: url.searchParams.get("collapsed"), now });
      return new Response(file.body, { headers: file.headers });
    } catch (error) {
      if (error instanceof RangeError) return new Response("Choose format=vsdx, format=csv or format=json.", { status: 400, headers });
      throw error;
    }
  }

  if (!isApi && url.pathname !== "/story-map") {
    return new Response("Page not found.", { status: 404, headers });
  }

  // Projects for this viewer, then filters, so a search only ever sees what this viewer may see.
  const map = getStoryMapPage(document, viewer, { canViewInternal, history, tests, stalledAfterWeeks, now, searchParams: url.searchParams });
  const status = map ? 200 : viewer ? 403 : 401;
  const message = viewer ? "This story map is only available to the product team." : "Sign in to view the story map.";

  if (isApi) {
    return Response.json(map ?? { error: message }, { status, headers });
  }

  // Keep the host's own parameters, such as the demo's role, on the export links.
  const exportHref = `/story-map/export${preservedParams ? `?${new URLSearchParams(preservedParams)}` : ""}`;
  const page = h("html", { lang: "en-GB" },
    h("head", null,
      h("meta", { charSet: "UTF-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("title", null, map?.title ?? "Story map"),
      h("link", { rel: "stylesheet", href: "/story-map.css" }),
      h("link", { rel: "stylesheet", href: "/example-host.css" }),
      // Optional: applies the filters as soon as they change, and keeps collapsed lanes in the export links. The board works without it.
      h("script", { type: "module", src: "/story-map-board.js" }),
    ),
    h("body", null,
      h("header", { className: "product-header" },
        h("h1", null, "Auto Story Map"),
        navigation,
      ),
      h("main", null,
        map ? h(StoryMapBoard, { map, sourceBaseUrl, preservedParams, now, exportHref }) : h("p", null, message),
      ),
    ),
  );
  return new Response("<!doctype html>" + renderToStaticMarkup(page), {
    status,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}
