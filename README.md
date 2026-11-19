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

Open [the local story map](http://127.0.0.1:4173/story-map). Choose **Engineer**, expand **Look up prices in the material catalogue**, and follow its **Engineering overview** link. Switch to **Regular user** to see the customer-facing activity and release labels. The demo also offers **Super admin** and **Guest** views. It listens on loopback and serves sample JSON at `/api/story-map`.

## Embed it in a product

Run `npm ci` and `npm pack` in the source checkout. From your host product, install the resulting tarball with `npm install /path/to/embedded-story-map-0.2.0.tgz`. You can also publish the tarball to your organisation’s registry. The core can run in a TypeScript or JavaScript backend. A React host can also use the board and stylesheet.

| Import | Use |
| --- | --- |
| `embedded-story-map` | Parse the YAML and select the view on the server. |
| `embedded-story-map/react` | Render a view with `<StoryMapBoard map={view} />`. |
| `embedded-story-map/styles.css` | Style the board using namespaced CSS. |

[The host integration][host] shows how a product can serve the board and JSON with the same audience rules. [The example delivery plan][delivery-plan] shows how plans reference stories by ID.

The map lives in the product repo. The deployed product renders the file included in that revision. Use the host app’s verified session to resolve the viewer on the server and supply the projected view to the board.

## Upgrade an existing install

Install the 0.2.0 tarball from your host repo, keep your existing `product/story-map.yaml`, and rebuild the app with the updated stylesheet. Follow the [upgrade steps][upgrade] to validate the map and add Markdown section links where you have engineering docs.

## Populate the first map

In the host repo, copy [the story map guide][guide] to `docs/story-map.md` and add [the story map agent instructions][agents] to `AGENTS.md`, preserving any existing instructions. Use [the example map][example-map] as a template for the YAML structure.

Start an agent in the host repo and give it this task.

> Populate `product/story-map.yaml` for this product using the [first-run workflow][first-run]. Start with the primary user journey and cite the evidence for each story. Use a [Markdown heading link][engineering-overview] where an engineering overview exists. Validate the map, check the expanded cards if the host renders the board, and flag any uncertain release or status decisions for review.

[source]: https://github.com/duncan-m/embedable-story-map
[example-map]: https://github.com/duncan-m/embedable-story-map/blob/ca4e4bf75388932f1c3cc79c489df3d14f7c4df2/product/story-map.yaml
[guide]: https://github.com/duncan-m/embedable-story-map/blob/e68adb6d8186c464d9b71d54375c7fc2ac35e9f9/docs/story-map.md
[agents]: https://github.com/duncan-m/embedable-story-map/blob/e68adb6d8186c464d9b71d54375c7fc2ac35e9f9/AGENTS.md
[first-run]: https://github.com/duncan-m/embedable-story-map/blob/e68adb6d8186c464d9b71d54375c7fc2ac35e9f9/docs/story-map.md#populate-the-first-map
[upgrade]: https://github.com/duncan-m/embedable-story-map/blob/e68adb6d8186c464d9b71d54375c7fc2ac35e9f9/docs/story-map.md#upgrade-from-010
[engineering-overview]: https://github.com/duncan-m/embedable-story-map/blob/e68adb6d8186c464d9b71d54375c7fc2ac35e9f9/docs/story-map.md#link-an-engineering-overview
[delivery-plan]: https://github.com/duncan-m/embedable-story-map/blob/db4194d4e7fbc23498b6d5e0c1e66f3d0dcc2d47/docs/example-builder-estimate-plan.md
[host]: https://github.com/duncan-m/embedable-story-map/blob/ca4e4bf75388932f1c3cc79c489df3d14f7c4df2/example/host.mjs
