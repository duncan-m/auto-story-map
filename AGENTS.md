# Story map instructions

Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. Follow [the story map guide](docs/story-map.md) for audience rules, examples and validation.

## Populate the first map

When setting up Embedded Story Map in a host product, or when asked to initialise the map, check whether `product/story-map.yaml` is missing or still contains the builder estimates demo. Follow the [first-run workflow](docs/story-map.md#populate-the-first-map) to inspect the host product, draft its initial internal map, and validate it. If the product already has a map, keep its story IDs and update only the requested scope.

Use an existing Markdown heading for each engineering overview you can verify. If you are updating a host that already uses the library, follow the [upgrade steps](docs/story-map.md#upgrade-from-010).

## Maintain an existing map

When a change affects a user journey, story scope, release assignment or delivery status, update the map in the same PR. Find existing IDs before creating stories and reference those IDs in the delivery plan. Make the smallest map change that matches the agreed work. When you add or edit a story, set its `updatedBy` to the editor’s display name.

Keep new stories internal by default. Add customer-facing copy only when the story is approved for that audience. Mark a story as shipped when it is available to its intended users. If release assignment or availability is unclear, keep the existing value and flag the question in the PR.

Run `npm run validate` in this source repo. In a product that installs the package, run `npx --no-install story-map validate product/story-map.yaml`. Use the same validation in CI.
