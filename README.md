# Embedded Story Map

A TypeScript library for displaying a Git-backed user story map inside a product. Activities run left to right. Releases run top to bottom. The host product decides who can see the map using its existing sign-in. By default, viewers with the `engineer` or `super-admin` role see the full internal map, and the host can change that rule.

## Screenshot

![This library's own story map in the demo, as a super admin sees it: activities from setting up to tracking delivery across the top, a lane for each release with its expected impact, and story cards showing each story's ID, title, status and when it last changed. The Active filter hides one cut story and offers a link to show it.](https://raw.githubusercontent.com/duncan-m/embedable-story-map/main/story-map-screenshot.png)

## Try the demo

Use Node.js 20 or newer. Run these commands from a checkout of the [source repository][source].

```sh
npm ci
npm run validate
npm test
npm run demo
```

The demo shows this library’s own story map, `product/story-map.yaml`: what each release delivered, what is merged for the next one, and what is planned. Open [the local story map](http://127.0.0.1:4173/story-map). It starts as **Super admin**, who sees the full internal map. Select **Link stories to their engineering overview** to open its details, and follow the **Engineering overview** link into these docs. Select the **0.4.0: Delivery tracking** release title to see its notes, expected impact and progress. Search for “history”, filter by status, or use **Changed** to see recent changes. One story is cut, so it is hidden by default: choose **All, including blocked and cut** to see it and its reason. The demo reads this repository’s Git history to show when each story changed and who changed it. Switch to **Regular user** to see the customer roadmap, where merged stories read as in progress. The demo also offers **Engineer**, **Product manager** and **Guest** views. Product managers see the internal map because the demo host passes its own `canViewInternal` rule. It listens on loopback and serves the same view as JSON at `/api/story-map`.

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

[The host integration][host] shows how a product can serve the board and JSON with the same audience rules. [The example delivery plan][delivery-plan] shows how plans reference stories by ID, using the builder estimates sample map in `test/fixtures/builder-estimates.yaml`.

The map lives in the product repo. The deployed product renders the file included in that revision. Use the host app’s verified session to resolve the viewer on the server and supply the projected view to the board.

## Upgrade an existing install

Run `npm install embedded-story-map@0.4.0` in your host repo, keep your existing `product/story-map.yaml`, and rebuild the app with the updated stylesheet. 0.4.0 adds the `merged`, `blocked` and `cut` statuses, so host code that handles every status needs updating. It also adds release notes and impact, stalled stories and “last updated” from Git. Follow the [upgrade steps][upgrade]. If you are upgrading from 0.2.0 or earlier, follow the [0.3.0 upgrade steps](https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#upgrade-to-030) first.

## Populate the first map

Run `npx story-map init` in the host repo. It creates:

- a starter `product/story-map.yaml` that points editors at the JSON Schema,
- [the story map guide][guide] in `docs/story-map.md`,
- a story map section at the end of `AGENTS.md`, keeping any existing instructions,
- a GitHub Actions workflow in `.github/workflows/story-map.yml` that validates the map and its sources on each PR and adds a summary of the story changes, starting with what customers will see. Pass `--no-ci` to skip it. The workflow is written only when the repo uses npm.

It never overwrites an existing file, so it is safe to run again. [This library’s own map][example-map] shows a fuller map.

Start an agent in the host repo and give it this task.

> Populate `product/story-map.yaml` for this product using the [first-run workflow][first-run]. Start with the primary user journey and cite the evidence for each story. Use a [Markdown heading link][engineering-overview] where an engineering overview exists. Validate the map, open a few story cards if the host renders the board, and flag any uncertain release or status decisions for review.

## Limitations

The board is read-only. Every change to the map, including release notes and expected impact, is made in `product/story-map.yaml` through a PR, usually by an agent working in the host repo, and appears once that PR is merged and deployed.

You can’t edit the map in the app. The map ships with each deployment, so an edit saved from the board would only appear after a merge and redeploy, and could overwrite newer changes on the default branch. Editing in the app would need the map stored on a separate hosted service instead of in the product repo. That isn’t part of this library.

## Changes and releases

See [the changelog][changelog] for what changed in each version and [the release steps][releasing] for publishing a new one. To work on the library itself, start with [the engineering overview][overview].

[source]: https://github.com/duncan-m/embedable-story-map
[example-map]: https://github.com/duncan-m/embedable-story-map/blob/main/product/story-map.yaml
[guide]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md
[first-run]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#populate-the-first-map
[upgrade]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#upgrade-to-040
[engineering-overview]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#link-an-engineering-overview
[delivery-plan]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/example-builder-estimate-plan.md
[host]: https://github.com/duncan-m/embedable-story-map/blob/main/example/host.mjs
[changelog]: https://github.com/duncan-m/embedable-story-map/blob/main/CHANGELOG.md
[releasing]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/releasing.md
[overview]: https://github.com/duncan-m/embedable-story-map/blob/main/docs/ENGINEERING-OVERVIEW.md
