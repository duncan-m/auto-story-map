import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filterStoryMapView, getStoryMapForViewer, readStoryMapFilters } from "embedded-story-map";
import { StoryMapBoard } from "embedded-story-map/react";

// The enclosing app supplies a viewer from its verified session.
// `target` is the request URL or path, including any `q` and `status` filter parameters.
export function makeStoryMapResponse(target, document, viewer, options = {}) {
  const { navigation = null, sourceBaseUrl, preservedParams, canViewInternal, history, stalledAfterWeeks, now } = options;
  const url = new URL(target, "http://localhost");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const isApi = url.pathname === "/api/story-map";

  if (!isApi && url.pathname !== "/story-map") {
    return new Response("Page not found.", { status: 404, headers });
  }

  // Project first, then filter, so a search only ever sees what this viewer may see.
  const view = getStoryMapForViewer(document, viewer, { canViewInternal, history, stalledAfterWeeks, now });
  const map = view && filterStoryMapView(view, readStoryMapFilters(url.searchParams), { now });
  const status = map ? 200 : viewer ? 403 : 401;
  const message = viewer ? "This story map is only available to the product team." : "Sign in to view the story map.";

  if (isApi) {
    return Response.json(map ?? { error: message }, { status, headers });
  }

  const page = h("html", { lang: "en-GB" },
    h("head", null,
      h("meta", { charSet: "UTF-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("title", null, "Story map"),
      h("link", { rel: "stylesheet", href: "/story-map.css" }),
      h("link", { rel: "stylesheet", href: "/example-host.css" }),
    ),
    h("body", null,
      h("header", { className: "product-header" },
        h("h1", null, "Purchasing"),
        navigation,
      ),
      h("main", null,
        map ? h(StoryMapBoard, { map, sourceBaseUrl, preservedParams, now }) : h("p", null, message),
      ),
    ),
  );
  return new Response("<!doctype html>" + renderToStaticMarkup(page), {
    status,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}
