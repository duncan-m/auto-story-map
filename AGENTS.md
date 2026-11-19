# Story map instructions

Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. Follow [the story map guide](docs/story-map.md) for audience rules, examples and validation.

When a change affects a user journey, story scope, release assignment or delivery status, update the map in the same PR. Find existing IDs before creating stories and reference those IDs in the delivery plan. Make the smallest map change that matches the agreed work. When you add or edit a story, set its `updatedBy` to the editor’s display name.

Keep new stories internal by default. Add customer-facing copy only when the story is approved for that audience. Mark a story as shipped when it is available to its intended users. If release assignment or availability is unclear, keep the existing value and flag the question in the PR.

Run `npm run validate` in this source repo. In a product that installs the package, run `npx --no-install story-map validate product/story-map.yaml`. Use the same validation in CI.
