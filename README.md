# Embedded Story Map

A TypeScript library for displaying a Git-backed user story map inside a product. Activities run left to right. Releases run top to bottom. The host product decides who can see the map using the roles from its existing sign-in.

## Try the builder estimates example

Use Node.js 20 or newer. From this directory, run:

```sh
npm ci
npm run validate
npm test
npm run demo
```

Open [the local story map](http://127.0.0.1:4173/story-map). Switch between **Regular user**, **Engineer**, **Super admin** and **Guest** to compare the views. The demo listens on loopback and uses a sample role selector. The example JSON endpoint is `/api/story-map`.

## Embed it in a product

Run `npm pack` in this directory and install the resulting `.tgz` in a host product, or publish the package to your organisation’s package registry. The core can run in a TypeScript or JavaScript backend. A React host can also use the board and stylesheet.

| Import | Use |
| --- | --- |
| `embedded-story-map` | Parse the YAML and select the view on the server. |
| `embedded-story-map/react` | Render a view with `<StoryMapBoard map={view} />`. |
| `embedded-story-map/styles.css` | Style the board using namespaced CSS. |

Copy [the example map](product/story-map.yaml), [the engineer and AI guide](docs/story-map.md), and [the AGENTS.md rule](AGENTS.md) into the host repo. [The example delivery plan](docs/example-builder-estimate-plan.md) shows how plans reference stories by ID. [The host integration](example/host.mjs) shows how a product can serve the board and JSON with the same audience rules.

The map lives in the product repo. The deployed product renders the file included in that revision. Use the host app’s verified session to resolve the viewer on the server and supply the projected view to the board.
