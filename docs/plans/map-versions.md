# Plan: see earlier versions of the map

Status: proposed. The work is ESM-113, ESM-114 and ESM-115 in the **0.8.0: Map versions, steps and audit** release of the map. The estimates are agreed.

The map already has a version every time it changes, because it lives in Git. But only an agent or someone at ease with Git can use those versions today: `story-map diff` compares the map with one ref, and the history file records each story's status changes. A product manager can't easily answer "what did the plan look like when we agreed 0.7.0?", "what changed in the map last month?" or "which stories did we drop since the last review?" without checking out an old commit.

This plan uses those Git versions as they are, so there's nothing new to record and no second store to keep in sync. Items are numbered in the order they should be built:

1. [Read the map as it was at a version](#1-read-the-map-as-it-was-at-a-version) (ESM-113)
2. [List the map's versions and compare any two](#2-list-the-maps-versions-and-compare-any-two) (ESM-114)
3. [Switch the board to an earlier version](#3-switch-the-board-to-an-earlier-version) (ESM-115)

## What counts as a version

A **version** is a commit on the branch's first-parent history, usually `main`, that changed the map file. This is the same walk `story-map history` already makes. A **named version** is one with a Git tag pointing at it, such as `v0.7.0`, or the first version after a release lane's stories all reached `shipped`. A version is referred to by any Git ref: a tag, a branch, a commit hash or `HEAD~3`, and also by a date with `--at 2026-10-01`, which picks the last version on or before that day.

Older versions may use an earlier format. They're read leniently, with `loadHistoricalStoryMap`, as `diff` and `history` already do. Anything that leaves out a field or a story from an old version says so.

## 1. Read the map as it was at a version

The read commands take `--at <ref or date>`: `story-map stories`, `story`, `releases`, `export` and `preview`.

```sh
npx --no-install story-map stories --at v0.7.0 --release v0-7-0
npx --no-install story-map story ESM-108 --at 2026-10-01
npx --no-install story-map preview --at v0.7.0
```

- **Same output, older map.** Each command prints what it would have printed then. The first line on stderr names the version, such as "Map as of v0.7.0 (a1b2c3d, 12 Oct 2026)".
- **Preview** shows a banner across the board: "You're viewing the map as of v0.7.0, 12 October 2026. Back to the current map." The board is read-only already, so nothing else changes. With `--history`, events after the version are left out, so "2 days ago" and the **Changed** filter read as they did then.
- **Missing or unreadable.** If the map didn't exist at that version, or wasn't valid YAML, the command exits 1 and names the nearest readable version before it. A shallow clone that lacks the ref fails with the same advice as `history`.
- **Agents** get the same `--at` on the JSON export, so a plan can cite what the map said when a decision was made.

The Git read moves from `src/commands/diff.ts` into a shared `readStoryMapAt(ref, mapPath)`, which `diff` keeps using.

## 2. List the map's versions and compare any two

`story-map versions` lists each version, newest first:

```text
v0.7.1  9f3e2a1  21 Nov 2026  Duncan Malcolm  #68   +1 story, 2 shipped
        4c7d0b8  18 Nov 2026  Sam Patel       #64   3 moved to 0.7.6, 1 cut
v0.7.0  a1b2c3d  12 Oct 2026  Duncan Malcolm  #57   +6 stories, release 0.7.0 added
```

- **Columns:** tags, short commit, date it reached the branch, who to credit (by the same rules as the history), the pull request when the history records one (ESM-801), and a one-line count from `diffStoryMaps` against the previous version.
- **Options:** `--limit <n>` (default 20), `--since <date>`, `--named` for tagged versions only, `--story <ID>` for versions that changed one story, and `--format json`.
- **Compare any two.** `story-map diff` takes an optional second ref: `story-map diff v0.7.0 v0.7.1` compares two versions with each other, rather than one with the working copy. Both sides are read leniently, and the existing note says what was left out of each.

Most of the walk already exists in `src/history-git.ts`. Versions reuse its commit list and the per-version maps it reads, so a repository with a long history isn't read twice.

## 3. Switch the board to an earlier version

The internal board gets a **Version** picker in the toolbar: "Current" and then the named versions, newest first. Choosing one shows the board as it was then, with the same banner as the preview and a **What changed since** link.

- **Data:** `story-map history --snapshots named` adds `snapshots` to the history file: each named version's commit, tags, date, and its map. `--snapshots none` is the default, so existing builds and file sizes don't change. The file keeps at most 30 snapshots, the newest, and the command warns when it skips older ones.
- **No JavaScript needed.** The picker sets `?version=v0.7.0`, and `getStoryMapPage` projects that snapshot on the server, as it does for filters. Links to an earlier version can be shared with the team.
- **What changed since:** opens a panel with the `formatStoryMapDiff` summary between that version and the current map, with each story linking to its panel.
- **Internal only.** Customers never see the picker, the snapshots or `?version`, which the customer view ignores. Snapshots can contain names in `updatedBy`, so the history file stays outside the static asset directory, as the guide already says.
- **Story panel:** "Last updated" gets a link, "See this story in earlier versions", that filters the picker's list to the versions that changed it.

This item needs items 1 and 2: it shows the same read through the same projection.

## Decisions to make

- **Which versions the board offers.** Proposed: named versions only, because a list of every commit is noise for most viewers and makes the history file large. Every version stays available from the CLI.
- **Release-shipped versions.** Proposed: count the first version after every story in a release lane is shipped as a named version, even without a tag, so products that don't tag releases still get useful entries.

## Not planned

**Storing versions in the YAML.** A `versions:` list in the map would repeat what Git already records, and would go stale whenever someone forgot to update it.

**Restoring an old version from the board.** Rolling the map back is a normal change: check out the old file, review the `diff`, and merge it in a PR. The hosted board stays read-only (ESM-404).

## Effort and release fit

They were first planned for 0.7.6, because ESM-112's local preview work and item 1's preview banner touch the same code. When 0.7.6 was split, they moved to 0.8.0 together, after ESM-112, so item 1 builds on its preview changes. If 0.8.0 is full, item 3 can move to the next release on its own.

| Story | Points |
| --- | --- |
| ESM-113: Read the map as it was at a version | 3 |
| ESM-114: List the map's versions and compare any two | 3 |
| ESM-115: Switch the board to an earlier version | 8 |
| **Total** | **14** |
