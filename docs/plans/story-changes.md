# Plan: link a story's pull requests and commits from its panel

Status: proposed. The work is ESM-803 and ESM-804, both in the **Next** release of the map.

Internal viewers open a story and can follow its work to the code: each line in its **History** links to the pull request and commit that made the change, and a new **Changes** section lists the pull requests and commits that delivered the story. As with tests, changes point to stories, not the other way round: a commit message, pull request title or branch name names the story ID, and the history build collects them. Nobody edits the map to list them.

Items are numbered in the order they should be built, and each section uses the same number:

1. [Record pull requests in the history](#1-record-pull-requests-in-the-history) (ESM-803)
2. [Link history lines to their commit and pull request](#2-link-history-lines-to-their-commit-and-pull-request) (ESM-803)
3. [Find the changes that name a story](#3-find-the-changes-that-name-a-story) (ESM-804)
4. [Show changes in the story panel](#4-show-changes-in-the-story-panel) (ESM-804)
5. [Document it](#5-document-it) (both)

Changes are internal only. The customer view and customer-facing copy do not change.

## Why this way

The history file already records the commit behind every status change and last edit, but the panel throws it away, and it does not record which pull request the commit came from. That is the cheap half: items 1 and 2 add no new Git reads beyond one more log field.

The commits that edit the map are not the commits that do the work, though. In this repository, “Show a story's tests in its panel (ESM-801)” and its branch `feat/esm-801-story-tests-panel` name the story, while the map edits only change its status. So the second half finds the work by story ID, the same way tests are found.

Three approaches were considered:

| Approach | What it does | Why not now |
| --- | --- | --- |
| List links in the map | Add a `changes` field to each story for agents to fill in | The map has to be kept up to date by hand, and the lists go stale, as `sources` do for tests |
| **Find changes by story ID in Git** (this plan) | Commit messages, pull request titles and branch names carry the story ID, and `story-map history` indexes them | — |
| Ask the GitHub API | Search pull requests, including open ones, for the story ID | Needs a token, network access and a GitHub host at build time. Kept as a follow-up (see [Later: open pull requests](#later-open-pull-requests)) |

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. How a pull request is recognised | From the commit that brought the change onto the branch: a GitHub merge commit, `Merge pull request #70 from owner/branch`, or a squash or rebase commit whose subject ends in `(#67)`. GitLab's `See merge request group/project!12` line in a merge commit body is recognised too. Anything else is a direct commit. |
| B. How a change names its story | The story ID as a whole word in the commit subject or body, or in the merged branch name. IDs in messages must use the map's case, as `storyIdPattern` does. Branch names are matched ignoring case, so `feat/esm-801-story-tests-panel` names ESM-801. A change can name several stories. |
| C. Which commits count | The first-parent history of the history's branch, usually `main`. A pull request counts when its merge or squash commit, its title or any commit on its branch names the story. Commits on unmerged branches are not seen. |
| D. Where the data lives | In the existing history file, as an optional `changes` list, so hosts already running `story-map history` get it with no new command or file. The file stays `version: 1`, and older files still load. |
| E. How links are built | A new `repositoryUrl` prop on `StoryMapBoard`, such as `https://github.com/your-org/your-product`. Commits link to `<repositoryUrl>/commit/<sha>` and pull requests to `<repositoryUrl>/pull/<number>`. For GitLab and other hosts, `repositoryLinks` takes templates instead, such as `{ commit: "https://gitlab.com/g/p/-/commit/{commit}", pullRequest: "https://gitlab.com/g/p/-/merge_requests/{number}" }`. |
| F. Without a repository URL | Commit hashes and pull request numbers are left out, so existing boards look the same until the host opts in. `sourceBaseUrl` is not reused, because it points at files on a branch, not at the repository. |
| G. Where the panel shows changes | A **Changes** section between **History** and **Tests**, newest first. The card face does not change. |
| H. What a change shows | A pull request shows its number and title, when it was merged and by whom, and how many of its commits name the story, such as “#68 Export the map as JSON for agents · merged 21 Nov by Duncan Malcolm · 2 commits”. A direct commit shows its short hash and subject. Branch commits are not listed one by one; the pull request link has them. |
| I. Empty state | When the history has a `changes` list and a story has none, the panel says “No pull requests or commits name ESM-803 yet” and shows how to name one. With an older history file, the section is left out. |
| J. Search | Change titles are not searched. The board's search stays on IDs, titles and summaries. |

### Assumptions to confirm

- **Merged work only.** The history is built from Git on the main branch, so it sees a pull request once it is merged. Open pull requests are a follow-up.
- **The default merge messages are kept.** A host that rewrites GitHub's merge commit message, or squashes without the `(#n)` suffix, gets direct commits instead of pull requests. That is still a working link, just without the number.
- **Short hashes are 7 characters.** The full hash is kept in the file and used in the link.
- **Messages are untrusted text.** Anyone who can push can write a commit message, so titles are trimmed, cut to length and rendered as text, like history names and reasons.

## Suggested order

| Item | Name | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Record pull requests in the history | S | — |
| 2 | Link history lines to their commit and pull request | S | 1 |
| 3 | Find the changes that name a story | M | 1 |
| 4 | Show changes in the story panel | M | 2, 3 |
| 5 | Document it | S | 2, 4 |

Items 1 and 2 can ship in one PR, which sets ESM-803 to `merged`. Items 3 to 5 can follow in a second PR, with ESM-804 going to `in-progress` and then `merged`.

Every PR follows the repository's rules: update `product/story-map.yaml` in the same PR, run `npm run validate` and `npm test`, name new tests with their story ID, add a `## Unreleased` entry to `CHANGELOG.md`, and include the `story-map diff origin/main` summary in the PR description.

---

## 1. Record pull requests in the history

**Change.** In `src/history-git.ts`, add the commit subject and body to the `git log` format and read the pull request number from them, following decision A. Add an optional `pullRequest` (a positive integer) to each `StoryHistoryEvent` and `StoryLastEdit`.

- Put the parsing in one exported function, `pullRequestNumber(subject, body)`, so item 3 reuses it.
- Extend `storyMapHistorySchema` in `src/history.ts` with the optional field, keeping the compile-time check that the schema and interfaces agree.
- History files written before this change have no `pullRequest`, and still load.
- Add the field to the JSON export's history entries, which already spread each entry.

**Tests.** ESM-803: on a fixture repository, a merge commit, a squash commit, a rebase commit with `(#n)`, a GitLab merge commit and a direct commit each give the right number or none. A subject with `(#12)` in the middle is not a pull request. An old history file without the field still parses.

## 2. Link history lines to their commit and pull request

**Change.**

- `StoryMapBoard` takes `repositoryUrl` and `repositoryLinks` (decision E). Build each link with `new URL` and keep it only when it is `http:` or `https:`, as `resolveSources` does. Encode the number and hash before putting them in a template.
- `HistoryList` in `src/react.tsx` adds the pull request and commit to each line's meta, after the people: “12 Nov 2026, 15:30 · by Sam Patel · merged by Duncan Malcolm · #70 · 8078905”. Both open in a new tab with the existing `NewTabHint`, and have labels such as “Pull request 70” and “Commit 8078905”.
- The “Last updated 3 days ago by …” line links its time to the pull request, or to the commit when there is none.
- Without a repository URL, nothing new is shown (decision F).
- New classes `esm-history-link` and `esm-commit-hash`, using the existing `--esm-*` colours in both copies of the dark palette.
- The example host in `example/demo.mjs` passes `repositoryUrl="https://github.com/duncan-m/auto-story-map"`.

**Tests.** ESM-803: links appear with `repositoryUrl` and with templates, use the full hash, and are absent without either. A `javascript:` template makes no link. Customer boards show no hashes or numbers. The smoke test still passes with React 18 and 19.

## 3. Find the changes that name a story

**Change.** In `story-map history`, after the existing pass over the map's versions, read the branch's commits once more, this time across every path, and record each change that names a story:

```json
{
  "changes": [
    {
      "storyIds": ["ESM-706"],
      "pullRequest": 68,
      "title": "Export the map as JSON for agents",
      "branch": "feat/esm-706-json-export",
      "commit": "e036076…",
      "at": "2026-11-21T18:02:00.000Z",
      "by": "Duncan Malcolm",
      "mergedBy": "Duncan Malcolm",
      "commitCount": 2
    }
  ],
  "moreChanges": [{ "storyId": "ESM-101", "count": 4 }]
}
```

- One `git log <ref> --format=…` over all commits, with parents, rather than one call per merge. Walk the first-parent chain in memory and give each merge the branch commits reachable from its second parent and not from its first, so a long history stays a single Git call.
- For a merge commit, the title is the first line of its body, which GitHub sets to the pull request title. For a squash commit, it is the subject without the `(#n)` suffix. For a direct commit, it is the subject.
- Match story IDs with `storyIdPattern` from `src/references.ts`, built from the current map, and with a case-insensitive copy for branch names (decision B). IDs for stories no longer in the map are dropped.
- Credit people with the same rules as status events: the commit author, or the merger when the author is a bot, using `--bot-names`.
- Limits: titles and branch names cut to 200 code points with `fitHistoryText`, at most 30 changes listed per story with the rest counted in `moreChanges`, and at most 20,000 changes in the file. Check them in `storyMapHistorySchema`.
- A shallow clone gives only the changes it can see, and the file already says `complete: false`.

**Tests.** ESM-804: on a fixture repository with merge, squash and direct commits: an ID in a subject, a body and a branch name; an ID in lower case in a message (not matched) and in a branch (matched); an ID that is part of a longer word (not matched); a pull request whose only mention is on a branch commit; two stories in one pull request; an unknown ID; the per-story limit; a bot author credited to the merger.

## 4. Show changes in the story panel

**Change.**

- `getStoryMapForViewer` attaches each story's entries to internal stories as `changes`, with `moreChanges` when the limit cut the list, and records `changesIndexed: true` when the history had a `changes` list, so the panel can tell “none” from “not built”. The customer projection is an allow-list, so it never includes them. Add a test that customer HTML and JSON contain no titles, branch names or hashes.
- `StoryDetail` adds the **Changes** section from decisions G to I, with a pull request icon or a commit icon on each line. Titles link to the pull request or commit when the board has a repository URL, and are plain text without one.
- “+N more” at the end when the list was cut, linking to a search for the story ID in the repository's pull requests when the host is GitHub.
- New classes `esm-changes`, `esm-change`, `esm-change-meta` and `esm-changes-empty`.
- The JSON export adds each story's `changes`, and a note in `provenance` that changes come from commit messages and branch names on the main branch, so open work is missing.

**Tests.** ESM-804: the panel lists changes newest first, links them with a repository URL, shows the empty state only with a `changes` list, and is absent on customer boards. The JSON export includes changes and the note.

## 5. Document it

- `docs/story-map.md`: extend **Show status history** with the commit and pull request links and the `repositoryUrl` prop, and add a section, **Link pull requests and commits to stories**, on naming the story ID in branch names, pull request titles and commit messages, and on the panel.
- `docs/ENGINEERING-OVERVIEW.md`: describe the second Git pass and the `changes` format under **Status history**, and add a line under **Security boundaries to preserve**: commit messages and branch names are untrusted and internal only.
- `AGENTS.md` and `templates/AGENTS.md`: name the story ID in the branch, pull request title and commit messages. The branch rule already asks for this.
- `CHANGELOG.md`: the new props, history fields and view fields. Nothing breaks.

## Security

- **Changes stay internal.** They are attached to internal views only, and the customer projection drops them by its allow-list. Titles can name unreleased work, so they are never served as a static asset, like the history file today.
- **Messages render as text.** React escapes them, lengths are capped when the file is written and checked when it is parsed, and only `http:` and `https:` links are made.
- **No new network access.** Everything comes from the local Git history, as status history does now.

## Later: open pull requests

A follow-up could add `story-map history --github-pulls`, reading open pull requests that name a story through the GitHub API with a token from CI, so in-progress stories show their draft or open pull request and its review state. It would sit alongside the Git data with a `state` of `open` or `draft`, and the panel would mark them. It is left out here because it ties the build to one host and needs a secret.

## Open questions

1. Should a merged story with no linked change be a validate warning, as an `in-progress` story with no tests is? It would catch work merged without the ID, but needs the history at validate time.
2. Should the card face show a pull request count, as it shows tests?
3. Should commits that only edit the map, such as “Mark the 0.7.0 stories as shipped (#67)”, appear under **Changes** as well as **History**? This plan lists them in both when they name the story, and only in **History** otherwise.
