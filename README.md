# Embedded Story Map

A TypeScript library for displaying a Git-backed user story map inside a product. Activities run left to right. Releases run top to bottom. The host product decides who can see the map using the roles from its existing sign-in.

## Try the builder estimates example

Use Node.js 20 or newer. Run these commands from a checkout of the [source repository][source].

```sh
npm ci
npm run validate
npm test
npm run demo
```

Open [the local story map](http://127.0.0.1:4173/story-map). Switch between **Regular user**, **Engineer**, **Super admin** and **Guest** to compare the views. The demo listens on loopback and uses a sample role selector. The example JSON endpoint is `/api/story-map`.

## Embed it in a product

Run `npm ci` and `npm pack` in the source checkout. From your host product, install the resulting tarball with `npm install /path/to/embedded-story-map-0.1.0.tgz`. You can also publish the tarball to your organisation’s registry. The core can run in a TypeScript or JavaScript backend. A React host can also use the board and stylesheet.

| Import | Use |
| --- | --- |
| `embedded-story-map` | Parse the YAML and select the view on the server. |
| `embedded-story-map/react` | Render a view with `<StoryMapBoard map={view} />`. |
| `embedded-story-map/styles.css` | Style the board using namespaced CSS. |

Copy [the example map][example-map], [the story map guide][guide], and [the AGENTS.md rule][agents] into the host repo. [The example delivery plan][delivery-plan] shows how plans reference stories by ID. [The host integration][host] shows how a product can serve the board and JSON with the same audience rules.

The map lives in the product repo. The deployed product renders the file included in that revision. Use the host app’s verified session to resolve the viewer on the server and supply the projected view to the board.

[source]: https://github.com/duncan-m/embedable-story-map
[example-map]: https://github.com/duncan-m/embedable-story-map/blob/db4194d4e7fbc23498b6d5e0c1e66f3d0dcc2d47/product/story-map.yaml
[guide]: https://github.com/duncan-m/embedable-story-map/blob/db4194d4e7fbc23498b6d5e0c1e66f3d0dcc2d47/docs/story-map.md
[agents]: https://github.com/duncan-m/embedable-story-map/blob/db4194d4e7fbc23498b6d5e0c1e66f3d0dcc2d47/AGENTS.md
[delivery-plan]: https://github.com/duncan-m/embedable-story-map/blob/db4194d4e7fbc23498b6d5e0c1e66f3d0dcc2d47/docs/example-builder-estimate-plan.md
[host]: https://github.com/duncan-m/embedable-story-map/blob/db4194d4e7fbc23498b6d5e0c1e66f3d0dcc2d47/example/host.mjs
