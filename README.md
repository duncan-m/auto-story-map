# Embedded Story Map

A TypeScript library for displaying a Git-backed user story map inside a product. Activities run left to right. Releases run top to bottom. The host product decides who can see the map using its existing sign-in. By default, viewers with the `engineer` or `super-admin` role see the full internal map, and the host can change that rule.

## Screenshot

![The builder estimates demo map as an engineer sees it: activities across the top, a lane for each release, and story cards showing each story's ID, title, status and when it last changed.](https://raw.githubusercontent.com/duncan-m/embedable-story-map/main/story-map-screenshot.png)

## Try the builder estimates example

Use Node.js 20 or newer. Run these commands from a checkout of the [source repository][source].

```sh
npm ci
npm run validate
npm test
npm run demo
```

Open [the local story map](http://127.0.0.1:4173/story-map). Choose **Engineer**, select **Look up prices in the material catalogue** to open its details, and follow the **Engineering overview** link. Search for “estimate”, filter by status, or use **Changed** to see recent changes. The demo reads this repository’s Git history to show when each story changed and who changed it. Switch to **Regular user** to see the customer-facing activity and release labels. The demo also offers **Product manager**, **Super admin** and **Guest** views. Product managers see the internal map because the demo host passes its own `canViewInternal` rule. It listens on loopback and serves sample JSON at `/api/story-map`.

Cards show the story ID, title and status. Selecting a card opens a panel with its summary, activity and release, and, for internal viewers, engineering notes, sources and the last editor. The panel and the search form work without client-side JavaScript.

## Embed it in a product

Install the package in your host product, then set it up:

```sh
npm install embedded-story-map
npx story-map init
```

The core can run in a TypeScript or JavaScript backend. A React host can also use the board and stylesheet. To try unreleased changes, run `npm ci` and `npm pack` in a source checkout and install the resulting tarball instead.

| Import | Use |
| --- | --- |
| `embedded-story-map` | Parse the YAML, select the viewer’s view and apply search filters on the server. |
| `embedded-story-map/react` | Render a view with `<StoryMapBoard map={view} />`. |
| `embedded-story-map/styles.css` | Style the board using namespaced CSS. |
| `embedded-story-map/schema.json` | Give editors autocomplete and inline checks for the YAML. |

[The host integration][host] shows how a product can serve the board and JSON with the same audience rules. [The example delivery plan][delivery-plan] shows how plans reference stories by ID.

The map lives in the product repo. The deployed product renders the file included in that revision. Use the host app’s verified session to resolve the viewer on the server and supply the projected view to the board.

## Upgrade an existing install

Run `npm install embedded-story-map@0.3.0` in your host repo, keep your existing `product/story-map.yaml`, and rebuild the app with the updated stylesheet. The board markup and class names changed in 0.3.0, so remove any host CSS that targets the old table or `<details>` cards. Follow the [upgrade steps][upgrade] to validate the map, turn on search, and check the story panels.

## Populate the first map

Run `npx story-map init` in the host repo. It creates:

- a starter `product/story-map.yaml` that points editors at the JSON Schema,
- [the story map guide][guide] in `docs/story-map.md`,
- a story map section at the end of `AGENTS.md`, keeping any existing instructions,
- a GitHub Actions workflow in `.github/workflows/story-map.yml` that validates the map and its sources on each PR and adds a summary of the story changes, starting with what customers will see. Pass `--no-ci` to skip it. The workflow is written only when the repo uses npm.

It never overwrites an existing file, so it is safe to run again. [The example map][example-map] shows a fuller map.

Start an agent in the host repo and give it this task.

> Populate `product/story-map.yaml` for this product using the [first-run workflow][first-run]. Start with the primary user journey and cite the evidence for each story. Use a [Markdown heading link][engineering-overview] where an engineering overview exists. Validate the map, open a few story cards if the host renders the board, and flag any uncertain release or status decisions for review.

## Changes and releases

See [the changelog][changelog] for what changed in each version and [the release steps][releasing] for publishing a new one. To work on the library itself, start with [the engineering overview][overview].

[source]: https://github.com/duncan-m/embedable-story-map
[example-map]: https://github.com/duncan-m/embedable-story-map/blob/main/product/story-map.yaml
[guide]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md
[first-run]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#populate-the-first-map
[upgrade]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#upgrade-to-030
[engineering-overview]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#link-an-engineering-overview
[delivery-plan]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/example-builder-estimate-plan.md
[host]: https://github.com/duncan-m/embedable-story-map/blob/main/example/host.mjs
[changelog]: https://github.com/duncan-m/embedable-story-map/blob/main/CHANGELOG.md
[releasing]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/releasing.md
[overview]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/ENGINEERING-OVERVIEW.md
