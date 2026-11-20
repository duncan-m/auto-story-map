# Changelog

All notable changes to `embedded-story-map` are recorded here. The project follows [semantic versioning](https://semver.org). Before 1.0.0, a minor version can include breaking changes, and each one is listed with its upgrade steps.

## Unreleased

- New `story-map history` reads the map’s Git history and records when each story was added and each status change, who made it and who merged it. Pass the result to `getStoryMapForViewer` as `history`.
- Internal cards show the time since the last change, such as “Shipped · 2 days ago”, and the story panel lists the full history. A new **Changed** filter shows stories added or changed in the last 1, 7, 14 or 30 days (`changed=7d`). The customer view never includes history.
- New `locale`, `timeZone` and `now` props on `StoryMapBoard`, and a `now` option on `filterStoryMapView`.
- Engineering overview and source links in the story panel open in a new tab, with an icon and screen-reader text that say so.

## 0.3.0

Upgrade steps: [Upgrade to 0.3.0](https://github.com/duncan-m/embedable-story-map/blob/main/docs/story-map.md#upgrade-to-030). The YAML format is unchanged.

### Board

- **Breaking:** the board is now a grid of activity tiles and coloured release lanes, with a story count per release. The markup and class names changed, so remove host CSS that targets `.esm-table`, `.esm-card-toggle` or `<details>`.
- Cards show only the story ID, title and status. Selecting a card opens a detail panel with the summary, activity and release. For internal viewers, the panel also shows the engineering overview, notes, linked sources and last editor. The panel uses the popover API and works without client-side JavaScript.
- New `filterStoryMapView` and `readStoryMapFilters` add a search box and status filter, submitted as a GET form. Use `preservedParams` to keep the host page’s own query parameters.
- New `theme` prop: `light` (default), `dark` or `auto`. All colours are `--esm-*` custom properties.
- Phones show each release lane as a stacked section.

### Access and validation

- New `canViewInternal` option on `getStoryMapForViewer` lets the host decide who sees the internal map. The default is unchanged: the `engineer` and `super-admin` roles.
- `parseStoryMap` throws `StoryMapValidationError`. Its `issues` give the path, message, line, column and containing item ID. Every problem is reported in one run, including reference checks when another field is invalid.
- `story-map validate` prints `file:line:column` and supports `--format github` for PR annotations.
- New `--check-sources` validator option checks that repository-relative sources exist and that Markdown `#heading` links match a heading. New `--plans <folder>` checks that story IDs mentioned in delivery plans exist in the map.
- The package ships `story-map.schema.json` (also exported as `embedded-story-map/schema.json`) for editor autocomplete and inline checks.
- **Breaking:** `storyMapSchema` is now a Zod 4 schema.

### Reviewing changes

- New `story-map diff <base-ref>` prints a Markdown summary of a map change for the PR, starting with what signed-in customers will see. `diffStoryMaps` and `formatStoryMapDiff` expose the same comparison in code.

### Setup

- New `story-map init` command creates a starter map, the story map guide, an `AGENTS.md` section and a GitHub Actions workflow that validates the map and its sources and adds the change summary to each PR. It never overwrites existing files.
- The package is published to npm.

## 0.2.0

- Story cards expand to show their activity and release.
- A Markdown source with a heading fragment becomes the card’s **Engineering overview** link. New `sourceBaseUrl` prop resolves repository-relative sources.
- Documented the host upgrade path and the first-run workflow for agents.

## 0.1.0

- First release: the YAML format, validator CLI, audience projection for internal and all-users views, React board and stylesheet.
- Stories can record `updatedBy`, shown to internal viewers.
