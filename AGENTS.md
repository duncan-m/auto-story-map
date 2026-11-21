# Story map instructions

Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. Follow [the story map guide](docs/story-map.md) for audience rules, examples and validation.

## Populate the first map

When setting up Auto Story Map in a host product, or when asked to initialise the map, check whether `product/story-map.yaml` is missing, still contains the builder estimates demo, or is the starter map from `story-map init`. Follow the [first-run workflow](docs/story-map.md#populate-the-first-map) to inspect the host product, draft its initial internal map, and validate it. If the product already has a map, keep its story IDs and update only the requested scope.

Use an existing Markdown heading for each engineering overview you can verify. If you are updating a host that already uses the library, follow the [upgrade steps](docs/story-map.md#upgrade-to-070).

## Maintain an existing map

When a change affects a user journey, story scope, release assignment or delivery status, update the map in the same PR. Find existing IDs before creating stories and reference those IDs in the delivery plan. Make the smallest map change that matches the agreed work. The status history credits the commit author with each edit, or whoever merged it when the author is a bot. Set `updatedBy` only when neither is the person to credit, such as when you make an edit on someone else’s behalf, and use their display name.

Keep new stories internal by default. Add customer-facing copy only when the story is approved for that audience. Mark a story as `merged` when its work reaches the default branch, and as `shipped` when it is available to its intended users. If the product deploys every merge straight away, go straight to `shipped`. When work stops or is dropped, set the status to `blocked` or `cut` instead of deleting the story, and explain why in `statusReason`. If release assignment or availability is unclear, keep the existing value and flag the question in the PR.

Record each release’s notes and expected impact in its `notes` and `impact`, following [Release notes and impact](docs/story-map.md#release-notes-and-impact). Mark impact items you draft with `draft: true`. Only a person removes `draft`, so never remove it yourself. The board cannot edit these fields, so update them in a PR like any other map change.

When you add or change a test that covers a story, put the story ID at the start of the test's name, followed by a colon, such as `test("ESM-702: exports a valid Visio package", …)`. See [Link tests to stories](docs/story-map.md#link-tests-to-stories).

Run `npm run validate` in this source repo. It also checks sources and the story IDs in `docs/`. In a product that installs the package, run `npx --no-install story-map validate product/story-map.yaml`. Add `--check-sources` to check that sources and `#heading` links exist, and `--tests <folder>` to check the story IDs in test names. Use the same validation in CI, adding `--format github` so problems appear on the PR diff. In the PR description, include the summary from `story-map diff origin/<base branch>` and call out any customer-facing changes.

## Branch names

Give each branch a short, descriptive name that says what the work is, such as `fix/history-name-length` or `docs/review-fixes-plan`. Include the story ID when there is one, such as `fix/esm-601-history-name-length`. Do not use random or generated names, such as `claude/zealous-fermat-srf6a2`, because nobody can tell from the name what the branch holds.
