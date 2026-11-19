# Using the story map

The product shows the map at `/story-map`. The source is `product/story-map.yaml`. Change the file in the same PR as a feature or delivery decision that affects the map. Reviewers can see exactly which stories moved, which changed status and which became visible to other users.

## Populate the first map

Run this workflow in the host product repository when `product/story-map.yaml` is missing or still contains the builder estimates demo. Use the sample YAML for its structure and replace the demo content with evidence from the host product. If the host product already has its own map, follow the editing rules below.

1. **Find the primary user journey.** Read the product README, user documentation, key screens or routes, and end-to-end tests. Check available delivery plans, release notes, and agreed issues for scope and status. Identify who uses the product, what they are trying to accomplish, and where that journey starts and ends. If the journey is unclear, ask the product owner which workflow to map first.
2. **Draft the map structure.** Create `product/story-map.yaml`. Start it with the [schema comment](#check-the-map-as-you-edit), then add `version: 1`, a product-specific `id` and `title`, `visibility: internal`, and the `activities`, `releases`, and `stories` lists. Give each activity and release a stable `id` and a short `title`. Order activities by the steps the user takes and releases by the documented delivery order. If a story has no confirmed release, group it under an internal release such as `unassigned` with the title “Release unassigned” and flag it for review.
3. **Write the first set of stories.** Start with the outcomes needed to cover the primary journey. Give each story a stable `id`, an outcome-focused `title`, and the `activity` and `release` IDs it belongs to. Use `planned` for agreed work awaiting implementation, `in-progress` when there is evidence work has started, and `shipped` when the intended users can use it. Flag uncertain statuses for review. Cite supporting docs or tests in `sources`. When a Markdown section explains the implementation, use its [heading link](#link-an-engineering-overview) as the first Markdown reference with a fragment. Record `updatedBy` when you know the editor’s display name. Add customer-facing copy only after approval.
4. **Validate and hand off.** Run `npx --no-install story-map validate product/story-map.yaml` from the host repo. Resolve validation errors and review the activity and release order against the evidence. If the host renders the React board, start the host app, open a card as an engineer, and follow its overview link where one is configured. Check the signed-in customer view when customer-facing content is enabled. In the PR or handoff, list the journey covered, the main sources, and any unresolved scope, release, or status decisions.

## Upgrade to 0.3.0

These steps work from 0.1.0 or 0.2.0. The YAML format is unchanged.

1. From the 0.3.0 source checkout, run `npm ci` and `npm pack` to create `embedded-story-map-0.3.0.tgz`. From your host repo, run `npm install /path/to/embedded-story-map-0.3.0.tgz`. If your organisation has published the release to a registry you use, run `npm install embedded-story-map@0.3.0` instead. Commit the dependency and lockfile changes together.
2. Keep your existing `version: 1` map, story IDs, and visibility settings. React hosts should load the updated `embedded-story-map/styles.css` and rebuild or restart the app. Refresh the stylesheet from the new package if the host keeps a local copy. The board is now a grid of release lanes, and each card opens a detail panel. Remove any host CSS that targets the old `.esm-table`, `.esm-card-toggle` or `<details>` markup.
3. To turn on search and the status filter, pass the projected view through `filterStoryMapView` with `readStoryMapFilters(url.searchParams)`, as described in [Integrate with a product](#integrate-with-a-product). Without this step the board renders without a toolbar.
4. To add an **Engineering overview** link, append a verified heading fragment such as `#payment-controls` to an existing Markdown source. Use an absolute Markdown URL or configure [`sourceBaseUrl`](#link-an-engineering-overview) for repository-relative paths.
5. If the host mapped its own roles to `engineer` or `super-admin` only to unlock the internal map, consider passing `canViewInternal` instead. See [Integrate with a product](#integrate-with-a-product).
6. Add the [schema comment](#check-the-map-as-you-edit) to the top of the map, and add `--format github` to the CI validation step.
7. If host code catches errors from `parseStoryMap`, it can now read `error.issues`. Each message line now includes the source line and item ID. If host code uses the exported `storyMapSchema` directly, note that it is now a Zod 4 schema.
8. Run `npx --no-install story-map validate product/story-map.yaml`. In React hosts, open a card using an internal account and verify any overview links. Try a search and a status filter. For all-users maps, check that the customer view shows its approved activity and release labels and that its panels show no engineering details.

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

Render the projected view with the repository URL in the board props.

```tsx
<StoryMapBoard
  map={view}
  sourceBaseUrl="https://github.com/your-org/your-product/blob/main/"
/>
```

Cards show only the story ID, title and status. Select a card to open its panel, which shows the summary, activity and release. In the internal view, the panel also has an **Engineering** section. The first Markdown section that resolves to a web URL becomes its **Engineering overview** link, followed by the notes and the remaining sources. Sources that resolve to a web URL are links. Anything else, such as a note about a meeting, is shown as text. The panel ends with the recorded editor.

## Audience settings

| Viewer | Internal map | All-users map |
| --- | --- | --- |
| Guest | Sign-in required | Sign-in required |
| Signed-in user | Access denied | Customer-facing view |
| Internal viewer (engineer or super admin by default) | Full map | Full map |

Set the map’s `visibility` to `internal` or `all-users`. The default is `internal`. To show a story to signed-in users, add its `customer.title` and optional `customer.summary`. Add customer-facing copy to its activity and release, and to the map itself. Review the wording and verify that the story’s displayed status is suitable for this audience before merging.

The customer view includes the approved copy and story status, and its story panels show only that copy with the customer-facing activity and release labels. It excludes engineering notes, source paths, editor names, internal IDs and activities or releases with no published stories. Customer searches match only the approved title and summary. Story records without a `customer` section stay internal. Engineers and super admins can see the recorded editor on the card and in the JSON view.

## Validate a change

In the library source repo, run `npm run build && npm run validate` or `npm test`. In a product that installs the library, run:

```sh
npx --no-install story-map validate product/story-map.yaml
```

Each problem is reported as `file:line:column` with the item it belongs to, for example:

```text
product/story-map.yaml:74:14: stories.3.release (FINANCE-201): Unknown release 'finance-later'.
```

The checks cover YAML syntax, duplicate keys and IDs, missing and unknown fields, invalid statuses, broken references and missing customer-facing labels. All problems are reported in one run.

Run the validator in CI for story map changes. In GitHub Actions, add `--format github` so each problem appears as an annotation on the PR diff:

```yaml
- run: npx --no-install story-map validate --format github product/story-map.yaml
```

In code, `parseStoryMap` throws a `StoryMapValidationError`. Its `issues` list gives each problem’s `path`, `message`, `line`, `column` and the `itemId` of the activity, release or story it belongs to.

### Check the map as you edit

The package includes a JSON Schema with a description for every field. Editors that use the YAML language server, such as VS Code with the Red Hat YAML extension, use it for autocomplete, hover help and inline errors. Add this comment as the first line of `product/story-map.yaml`:

```yaml
# yaml-language-server: $schema=../node_modules/embedded-story-map/story-map.schema.json
```

The schema covers the shape of each field. Run the validator for the checks that span the file, such as duplicate IDs and references to unknown activities or releases.

## Integrate with a product

1. Package or install the library and commit the product’s map under `product/`. Include that directory in the server deployment, outside the static asset directory.
2. In the product’s authenticated server route, read the YAML as UTF-8 and pass the text to `parseStoryMap`. Call `getStoryMapForViewer(document, viewer)` with roles from the verified session. Pass `null` for a guest. A null result indicates denied access. By default, viewers whose roles include `engineer` or `super-admin` see the internal map. To use your own rule, pass `canViewInternal`, for example `getStoryMapForViewer(document, viewer, { canViewInternal: viewer => viewer.roles.includes("product") })`. The rule receives the viewer object you passed, so it can check permissions as well as roles. Only a return value of `true` grants the internal view.
3. To offer search, pass the view to `filterStoryMapView(view, readStoryMapFilters(url.searchParams))`. Always filter after `getStoryMapForViewer`, so a search only sees what the viewer may see. The board then shows a search box and status filter. They submit a GET form with `q` and `status` parameters to the current page, so the host must pass the page’s query string through. Use the `preservedParams` prop to keep any other parameters the page needs.
4. Render `StoryMapBoard` using the returned view and import `embedded-story-map/styles.css` through the host’s CSS pipeline. Pass `sourceBaseUrl` if the map uses [repository-relative Markdown links](#link-an-engineering-overview). The board is light by default. Pass `theme="dark"` for a dark host, or `theme="auto"` to follow the viewer’s system setting. Colours are CSS custom properties on `.esm-board`, such as `--esm-accent`, so a host can override them. Use the same server-side projection and filters if adding a JSON endpoint.
5. Set `Cache-Control: private, no-store` for the page and endpoint. Keep the raw YAML and parsed document on the server. The localhost demo’s role selector is for testing sample data.

The map is edited through a PR and ships with the product. The example JSON endpoint is read-only. An app that needs in-app authoring can submit a PR against the same YAML file.
