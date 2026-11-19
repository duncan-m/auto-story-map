# Using the story map

The product shows the map at `/story-map`. The source is `product/story-map.yaml`. Change the file in the same PR as a feature or delivery decision that affects the map. Reviewers can see exactly which stories moved, which changed status and which became visible to other users.

## Populate the first map

Run this workflow in the host product repository when `product/story-map.yaml` is missing or still contains the builder estimates demo. Use the sample YAML for its structure and replace the demo content with evidence from the host product. If the host product already has its own map, follow the editing rules below.

1. **Find the primary user journey.** Read the product README, user documentation, key screens or routes, and end-to-end tests. Check available delivery plans, release notes, and agreed issues for scope and status. Identify who uses the product, what they are trying to accomplish, and where that journey starts and ends. If the journey is unclear, ask the product owner which workflow to map first.
2. **Draft the map structure.** Create `product/story-map.yaml` with `version: 1`, a product-specific `id` and `title`, `visibility: internal`, and the `activities`, `releases`, and `stories` lists. Give each activity and release a stable `id` and a short `title`. Order activities by the steps the user takes and releases by the documented delivery order. If a story has no confirmed release, group it under an internal release such as `unassigned` with the title “Release unassigned” and flag it for review.
3. **Write the first set of stories.** Start with the outcomes needed to cover the primary journey. Give each story a stable `id`, an outcome-focused `title`, and the `activity` and `release` IDs it belongs to. Use `planned` for agreed work awaiting implementation, `in-progress` when there is evidence work has started, and `shipped` when the intended users can use it. Flag uncertain statuses for review. Cite supporting docs or tests in `sources`. Record `updatedBy` when you know the editor’s display name. Add customer-facing copy only after approval.
4. **Validate and hand off.** From the host repo, run `npx --no-install story-map validate product/story-map.yaml` with the package installed. Resolve validation errors and review the activity and release order against the evidence. In the PR or handoff, list the journey covered, the main sources, and any unresolved scope, release, or status decisions.

## Where an edit belongs

| If you are changing | Update |
| --- | --- |
| The order of the user journey | Reorder the `activities` list. |
| The order of delivery slices | Reorder the `releases` list. |
| Where one story sits | Change its `activity` or `release` to an existing ID. |
| The order within a cell | Reorder the affected stories in the `stories` list. |
| Implementation details | Update the delivery plan, then add the relevant Markdown section to `sources`. |
| Progress | Set `status` to `planned`, `in-progress` or `shipped`. Shipped means the intended audience can use it. |

Use stable, unique IDs such as `BUILDER-102`. Keep the same ID when renaming or moving a story. A plan can refer to it as `BUILDER-102` and explain the implementation or acceptance criteria in its own words. Ordinary maintenance changes can leave the map alone.

When you add or edit a story, record the editor’s display name in `updatedBy`. This field is optional, so stories with no recorded editor can omit it.

## Example

When price catalogue lookup is agreed for the builder workflow, put the story under the estimate activity and the builder release. Its YAML can look like this:

```yaml
- id: BUILDER-102
  title: Look up prices in the material catalogue
  activity: prepare
  release: builder-mvp
  status: planned
  sources:
    - docs/example-builder-estimate-plan.md#builder-workflow
  updatedBy: Sam Patel
```

If the agreed release changes, edit `release` on this story. If implementation starts, set its status to `in-progress`. Once deployed and available to builders, set it to `shipped`.

## Link an engineering overview

Add the URL of the relevant Markdown heading to the story’s `sources`, including the fragment after `#`. For a repository-relative reference such as `ENGINEERING-OVERVIEW.md#payment-controls`, pass the repository file URL prefix to `StoryMapBoard` as `sourceBaseUrl`. Include the trailing slash, for example `https://github.com/your-org/your-product/blob/main/`. Absolute Markdown URLs work without this prop.

Open a card to see its activity and release. In the internal view, the card also shows engineering notes and uses the first Markdown section that resolves to a web URL as its **Engineering overview** link. Other sources stay in the internal JSON view for reference. Stories without a section link show their existing references under **Engineering details**.

## Audience settings

| Viewer | Internal map | All-users map |
| --- | --- | --- |
| Guest | Sign-in required | Sign-in required |
| Signed-in user | Access denied | Customer-facing view |
| Engineer or super admin | Full map | Full map |

Set the map’s `visibility` to `internal` or `all-users`. The default is `internal`. To show a story to signed-in users, add its `customer.title` and optional `customer.summary`. Add customer-facing copy to its activity and release, and to the map itself. Review the wording and verify that the story’s displayed status is suitable for this audience before merging.

The customer view includes the approved copy and story status. It excludes engineering notes, source paths, editor names, internal IDs and activities or releases with no published stories. Story records without a `customer` section stay internal. Engineers and super admins can see the recorded editor on the card and in the JSON view.

## Validate a change

In the library source repo, run `npm run build && npm run validate` or `npm test`. In a product that installs the library, run:

```sh
npx --no-install story-map validate product/story-map.yaml
```

Run the validator in CI for story map changes. The checks cover YAML syntax, duplicate IDs, unknown fields, broken references and missing customer-facing labels.

## Integrate with a product

1. Package or install the library and commit the product’s map under `product/`. Include that directory in the server deployment, outside the static asset directory.
2. In the product’s authenticated server route, read the YAML as UTF-8 and pass the text to `parseStoryMap`. Call `getStoryMapForViewer(document, viewer)` with roles from the verified session. Map the product’s role names to `engineer` and `super-admin`. Pass `null` for a guest. A null result indicates denied access.
3. Render `StoryMapBoard` using only the returned view. Import `embedded-story-map/styles.css` through the host’s CSS pipeline. Use the same server-side projection if adding a JSON endpoint.
4. Set `Cache-Control: private, no-store` for the page and endpoint. Keep the raw YAML and parsed document on the server. The localhost demo’s role selector is for testing sample data.

The map is edited through a PR and ships with the product. The example JSON endpoint is read-only. An app that needs in-app authoring can submit a PR against the same YAML file.
