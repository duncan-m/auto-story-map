<!-- embedded-story-map:start -->
## Story map

Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. Follow [the story map guide](docs/story-map.md) for audience rules, examples and validation.

### Populate the first map

When `product/story-map.yaml` is missing, still contains the builder estimates demo, or is the starter map from `story-map init` (its summary begins “Starter map”), follow the [first-run workflow](docs/story-map.md#populate-the-first-map). Inspect this product, draft its initial internal map, and validate it. Use an existing Markdown heading for each engineering overview you can verify. If the product already has a map, keep its story IDs and update only the requested scope.

### Maintain the map

When a change affects a user journey, story scope, release assignment or delivery status, update the map in the same PR. Find existing IDs before creating stories and reference those IDs in the delivery plan. Make the smallest map change that matches the agreed work. When you add or edit a story, set its `updatedBy` to the editor’s display name. The status history uses it to credit the change.

Keep new stories internal by default. Add customer-facing copy only when the story is approved for that audience. Mark a story as shipped when it is available to its intended users. When work stops or is dropped, set the status to `blocked` or `cut` instead of deleting the story, and explain why in `statusReason`. If release assignment or availability is unclear, keep the existing value and flag the question in the PR.

Record each release’s notes and expected impact in its `notes` and `impact`, following [Release notes and impact](docs/story-map.md#release-notes-and-impact). Mark impact items you draft with `draft: true`. Only a person removes `draft`, so never remove it yourself. The board cannot edit these fields, so update them in a PR like any other map change.

Run `npx --no-install story-map validate --check-sources product/story-map.yaml` after every map change. It also checks that each repository-relative source exists and that each `#heading` matches. Add `--plans <folder>` to check story IDs mentioned in delivery plans. In CI, add `--format github` so problems appear on the PR diff.

In the PR description, include the summary from `npx --no-install story-map diff origin/<base branch>`, and call out anything under **Customer-facing changes**.
<!-- embedded-story-map:end -->
