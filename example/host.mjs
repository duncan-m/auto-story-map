import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getStoryMapForViewer } from "embedded-story-map";
import { StoryMapBoard } from "embedded-story-map/react";

// The enclosing app supplies a viewer from its verified session.
export function makeStoryMapResponse(path, document, viewer, navigation = null, sourceBaseUrl) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const isApi = path === "/api/story-map";

  if (!isApi && path !== "/story-map") {
    return new Response("Page not found.", { status: 404, headers });
  }

  const map = getStoryMapForViewer(document, viewer);
  const status = map ? 200 : viewer ? 403 : 401;
  const message = viewer ? "This story map is available to engineers and super admins." : "Sign in to view the story map.";

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
        map ? h(StoryMapBoard, { map, sourceBaseUrl }) : h("p", null, message),
      ),
    ),
  );
  return new Response("<!doctype html>" + renderToStaticMarkup(page), {
    status,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}
