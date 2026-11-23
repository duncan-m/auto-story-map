# Plan: an Actions tab for outstanding work on the map

Status: proposed. The work is ESM-128 to ESM-132 in the **0.7.6: PM improvements** release of the map. None of the estimates are agreed yet.

Before this plan, `npm run validate` on this repository printed 44 warnings. Most of them ask a person to do something: confirm a drafted job or impact item, agree an estimate, tag a test. Only people who run the CLI, or read CI logs, ever see them. The people most of them are for, product managers and founders reading the board in the product, never do.

This plan adds a third tab to the internal board, next to **Story map** and **Personas**: **Actions**, a list of what the map is waiting for, grouped by kind, each with a link to the item and a way to fix it.

Items are numbered in the order they should be built:

1. [Give each warning a kind](#1-give-each-warning-a-kind) (ESM-128)
2. [Show outstanding actions on an Actions tab](#2-show-outstanding-actions-on-an-actions-tab) (ESM-129)
3. [Show an item's actions in its panel](#3-show-an-items-actions-in-its-panel) (ESM-130)
4. [Include the file checks](#4-include-the-file-checks) (ESM-131)
5. [List actions from the command line](#5-list-actions-from-the-command-line) (ESM-132)

All stories are internal. The customer view does not change, and actions never appear on it.

## Why

What the 44 warnings on this map ask for today:

| Kind | Count | Who can act |
| --- | --- | --- |
| Confirm a draft: a persona's context, a job or a release's impact | 34 | A person only. Agents must not remove `draft` (ESM-744) |
| Add an estimate | 6 | The team, once it has agreed the size |
| Fill a gap: a job or a job's step with no stories | 3 | A person or an agent |
| Tag a test | 1 | A person or an agent |
| Other kinds, such as a blocked story with no reason or a release with no impact | 0 here | A person or an agent |

Three quarters of them can only be done by a person, and those are the ones nobody sees. A long CLI list also hides what matters: one missing core job reads the same as thirty drafts waiting for a tick.

## Decisions to make

| Question | Recommendation | Alternatives |
| --- | --- | --- |
| A. Where actions live | A third tab, **Actions**, with a count, after **Personas** | A banner on the story map. Too small for 44 items, and pushes the map down. A panel per story only: misses map-wide actions such as untagged stories |
| B. Who sees it | Internal viewers only, like the Personas tab | Also customers. No: every action is about internal fields |
| C. What it lists | Warnings only. An invalid map does not render at all, so its errors can never reach the board. File-check errors (item 4) are the exception, and are listed first | Also suggestions that are not warnings today, such as stories with no summary. Each new suggestion should be a validate warning first, so the CLI and the tab never disagree |
| D. Grouping | By kind, in the order: problems in files, gaps, drafts to confirm, estimates, tests, other. Within a group, by release in map order, then by position | One flat list in file order, like validate. Fine for CI, hard to work through |
| E. How a person fixes one | Each action links to its item (story or release permalink, persona page) and shows the change to make. Where a command exists, it shows it with **Copy**: `story-map confirm` (ESM-110) for drafts, `story-map edit` for the rest. With `sourceBaseUrl`, it also links to the line in the map file | Fix in place from the tab. Only possible in the writable local preview (ESM-112), so it can follow there |
| F. Dismissing | No dismiss. An action goes away when the map changes. A warning that is wrong for a map is a bug in the warning | Dismiss per viewer in browser storage. Hides work from the rest of the team, and the list drifts from validate |
| G. Who does it | Each kind says whether it needs a person, and the tab can be filtered to **Needs a person** | Leave it out. But it is the main reason the tab exists, and agents read the same data (item 5) |
| H. Release | 0.7.6, next to the draft confirmation and triage work it points to | A release of its own after 0.7.6. Cleaner if 0.7.6 needs to stay small |

### Assumptions to confirm

- **The tab shows even when the map has no personas.** Today the tabs only appear when the map has personas. With this plan, the tab row shows for internal viewers when there are personas or at least one action, and the Personas tab only when there are personas.
- **Counts ignore the board's filters**, like the persona counts, so the tab's number does not jump as you filter the map. The tab itself has its own kind and release filters.
- **An empty tab says so.** “Nothing is waiting on the map” with the time the map was checked, so people know it ran.
- **No new rights.** Copying a command changes nothing, as in ESM-111.

## Suggested order

| Item | Name | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Give each warning a kind | S | — |
| 2 | Show outstanding actions on an Actions tab | M | 1 |
| 3 | Show an item's actions in its panel | S | 2 |
| 4 | Include the file checks | S | 2 |
| 5 | List actions from the command line | S | 1 |

Items 1 and 5 can share a PR. Every PR follows the repository's rules: update `product/story-map.yaml` in the same PR, run `npm run validate` and `npm test`, add a `## Unreleased` entry to `CHANGELOG.md`, and include the `story-map diff origin/main` summary in the PR description. Tag new tests with the story ID, such as `test("ESM-128: gives every warning a kind", …)`.

---

## 1. Give each warning a kind

**Change.** Add a `kind` to each `StoryMapIssue` that `storyMapWarnings` and the file checks return, so the tab can group and explain actions without reading the message text.

- Kinds: `confirm-draft-impact`, `confirm-draft-job`, `confirm-draft-context`, `missing-impact`, `missing-estimate`, `missing-status-reason`, `job-without-stories`, `step-without-stories`, `persona-without-stories`, `stories-without-personas`, `persona-without-job`, `story-without-tests`, `missing-source`, `missing-heading`, `unknown-story-id`.
- Add `needsPerson: true` for the confirm kinds and `missing-estimate`, and a short `title` per kind, such as “Confirm a drafted job”, in one table in a new `src/actions.ts`.
- Add `getStoryMapActions(loaded, { checks?, tests? })`, which returns the actions grouped and ordered as in decision D, each with its kind, item ID, item type, map path, line, message and, where one exists, the command that fixes it.
- `validate --format json` includes `kind`. Text and GitHub output do not change.

**Tests.** Every warning `storyMapWarnings` can return has a kind (a test fails when a new warning is added without one). Grouping and order on a fixture map.

## 2. Show outstanding actions on an Actions tab

**Change.**

- `?view=actions` opens the tab. `BoardTabs` in `src/react.tsx` gets a third tab, with the number of actions, and the tab row shows as in the first assumption.
- `getStoryMapForViewer` attaches the actions to internal views only. The customer projection is an allow-list, so it never includes them. Add a test that customer HTML and JSON contain none.
- The tab lists each group with its title, count and a sentence on why it matters. Each action shows the item (linking to its story or release permalink, or its persona page), the message, who can act, the line in the map file, and a **Copy** button for its command.
- Filters at the top: kind, release, and **Needs a person**, as links so they work without JavaScript.
- New classes `esm-actions`, `esm-action-group` and `esm-action`, with colours from the existing `--esm-*` properties, in both copies of the dark palette.

**Tests.** The tab lists the fixture's actions in order. Filters keep the right ones. Links resolve with and without `sourceBaseUrl`. The tab is absent for customers. The smoke test still passes with React 18 and 19.

## 3. Show an item's actions in its panel

**Change.** The story and release panels and the persona page get an **Actions** row listing that item's actions, with the same fix and copy as the tab, and a link to the tab filtered to the item. Cards show nothing new, so the map stays as it is.

**Tests.** A story with a missing estimate shows it in its panel. A story with none shows no row.

## 4. Include the file checks

Missing sources, broken `#heading` links and unknown IDs in plans and tests need the repository's files, which the board does not have.

**Change.**

- `story-map validate --out <file>` writes the JSON result as well as printing the usual output, so CI can build the file in the same step.
- The host passes it to the view as `checks`, on the server, like the history and tests index. The view adds its issues to the actions, marked with the time they were checked.
- The tests index the host already passes is enough for `story-without-tests`, so that kind needs no checks file.
- The example host and `story-map preview` run the checks at start-up.

**Tests.** A checks file adds its issues to the tab, first. A stale checks file for another map version is ignored with a note. `parseStoryMapChecks` rejects files over its limits.

## 5. List actions from the command line

**Change.** `story-map actions [--format text|json] [--kind <kind>] [--release <ID>] [--needs-person] [--map <path>]` prints the same grouped list as the tab, so agents and people at a terminal see what a PM sees on the board. Agents can pick up actions that do not need a person, and leave the rest.

`AGENTS.md`, `templates/AGENTS.md` and the guide say agents may act on actions without `needsPerson`, and must not act on the others.

**Tests.** Output matches the tab's order. `--needs-person` keeps only drafts and estimates.

## Not now

- **Fixing actions in place on the hosted board.** The hosted board stays read-only (ESM-404). Saving from the tab can follow the writable local preview (ESM-112).
- **Assigning actions to people.** That belongs in the team's tracker, and the map has no list of people.
- **Notifications.** A scheduled audit (ESM-109) is the place to tell people that actions are piling up.
