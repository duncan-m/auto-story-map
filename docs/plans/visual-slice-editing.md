# Plan: Edit and review release slices visually

Status: proposed. The work is ESM-188 to ESM-195 in **0.9.0: Edit release slices visually**, ESM-196 to ESM-199 in **0.9.1: Review proposed maps in the browser**, and ESM-200, ESM-203 and ESM-204 in **Icebox: Hosted review ideas**. None has an agreed estimate yet. No customer-facing copy is approved.

0.9.0: Edit release slices visually

1. [Add, rename and move releases from the command line](#1-add-rename-and-move-releases-from-the-command-line) (ESM-188)
2. [Warn when a move puts a prerequisite later](#2-warn-when-a-move-puts-a-prerequisite-later) (ESM-189)
3. [Collect board edits and review their diff](#3-collect-board-edits-and-review-their-diff) (ESM-190)
4. [Create a slice and set its outcome](#4-create-a-slice-and-set-its-outcome) (ESM-191)
5. [Move a release up or down](#5-move-a-release-up-or-down) (ESM-192)
6. [Move several stories to another release](#6-move-several-stories-to-another-release) (ESM-193)
7. [Bring a prerequisite forward](#7-bring-a-prerequisite-forward) (ESM-194)
8. [Offer to renumber release titles](#8-offer-to-renumber-release-titles) (ESM-195)

0.9.1: Review proposed maps in the browser

9. [Compare the current and proposed release order](#9-compare-the-current-and-proposed-release-order) (ESM-196)
10. [Share a proposal as a private link](#10-share-a-proposal-as-a-private-link) (ESM-197)
11. [Open a draft pull request from the board](#11-open-a-draft-pull-request-from-the-board) (ESM-198)
12. [Propose slice changes from the hosted board](#12-propose-slice-changes-from-the-hosted-board) (ESM-199)

[Icebox](#icebox): Hosted review ideas, not agreed

13. [Comment on a release slice in a proposal](#13-comment-on-a-release-slice-in-a-proposal) (ESM-200)
14. [Open the draft pull request through a GitHub App](#14-open-the-draft-pull-request-through-a-github-app) (ESM-203)
15. [Open a live proposal from its pull request](#15-open-a-live-proposal-from-its-pull-request) (ESM-204)

## Why and customer outcome

Changing the plan is the Solo Builder's `triage-backlog` job: *"I can move a slice in the board, see affected prerequisites, and review a focused Git patch."* Today that means editing release IDs in the YAML or running `story-map edit` story by story, and tracing `dependsOn` links by hand to see what a move breaks. There is no command at all to create, rename or reorder a release.

The PM inheriting a project has the same need at a different moment, `agree-first-release-plan`: they propose a new release order and need the team to see what moved and what it affects before agreeing it. Often they have no local checkout, so they depend on an engineer to make the change.

Success: a signed-in founder or PM rearranges slices on the board, sees each prerequisite a move puts later and can bring it forward, reviews the Git diff, and either saves it locally or shares a link and opens a draft pull request, without a checkout. A reviewer opens that link and sees the current and proposed order side by side.

The reviewer is served through the founder's `share-roadmap` job and the PM's `agree-first-release-plan`. No reviewer persona is added, to keep enterprise roles out of scope.

## What it builds on

- **ESM-744** (shipped), `story-map edit` and `add`: named edits applied as line splices, with a dry-run diff and validation. ESM-188 adds release operations to the same engine, and `edit --from` gains them, so every board edit has a command behind it. See [the native CLI plan](native-cli.md#5-propose-edits).
- **ESM-112** (shipped) and **ESM-181** (merged): the local preview saves the story panel's status and release changes, with an Origin check, a start-up token and a refusal when the file changed since the page loaded. Elsewhere, the Actions menu copies the edit command. ESM-190's tray uses the same save route and the same copy fallback. See [the local triage plan](local-triage.md#3-save-changes-from-the-local-preview).
- **ESM-156** (shipped): the pattern for a host's own board to edit on the builder's machine, with editing off in production.
- **ESM-304** (shipped), `story-map diff`: the PR summary that the tray, the Compare view and the draft pull request reuse.
- **ESM-129** (shipped) and **ESM-139** (shipped): `dependsOn` links and readiness.
- **ESM-142** (planned, 0.8.1): a release's order and its cut, blocked and later-release risks. ESM-189 runs the same risk check on a proposed map, so it depends on ESM-142. See [the visual dependency map plan](visual-dependency-map.md#2-suggest-a-delivery-order-for-a-release).
- **ESM-144** (shipped): the board opens an agent brief in Claude Code on the web. ESM-198 hands the proposal over the same way.
- **ESM-114** and **ESM-115** (planned, 0.8.2): list and compare map versions, and switch the board to one. They are related to the Compare view but not a prerequisite: ESM-196 compares the current map with a proposal of edits, not two commits. If they land first, the Compare view can reuse their layout. See [the map versions plan](map-versions.md).
- **ESM-404** (cut): editing release notes and impact on the board. It was cut because saving needs the map on a hosted service. This plan keeps that decision on the hosted board: it never saves there. Release notes and impact stay PR-only.

## UI mockup

![Mockup of the internal board after 0.9.0 is dragged above 0.8.1, with a Pending changes tray warning that ESM-189 now waits on ESM-142 in a later release and offering Bring forward, two selected cards with a Move to bar, a New release form, and a Compare view of the current and proposed release order](visual-slice-editing-mockup.png)

The mockup is [visual-slice-editing-mockup.html](visual-slice-editing-mockup.html), built on the real `styles.css` and the board's real markup, rendered from this map with the 0.9.0, 0.8.1 and 0.8.2 lanes kept, in the proposed order. Every story, release and dependency in it is from this map. The tray, the drag handle, the selection bar, the New release form and the Compare view are proposed. To refresh the image, serve the repository root, open the file at 1360 px wide and take a full-page screenshot.

What it shows:

1. **0.9.0 dragged above 0.8.1** (ESM-192), with a drag handle on the release heading. Move up and Move down are in the release panel, not shown.
2. **The Pending changes tray** (ESM-190): each pending edit, the prerequisites they put later, and the line diff, with **Save to file** on the local preview, **Copy link**, **Open draft PR** and **Copy patch**.
3. **A move warning** (ESM-189): ESM-189 depends on ESM-142, which the move leaves in 0.8.1, now after 0.9.0. **Bring forward** (ESM-194) moves ESM-142 into 0.9.0 as another pending edit.
4. **Two selected cards**, ESM-113 and ESM-114, with a **Move to** bar (ESM-193).
5. **A New release form** between rows (ESM-191), with a title and an outcome, saved as the release's `summary`.
6. **The Compare view** (ESM-196): current and proposed order side by side, with moved releases and stories marked and the dependency the proposal breaks.

## Product decisions

Agreed with the repository owner while planning:

- **A release's outcome is its `summary`.** No new field.
- **Moving a release changes only its place in the list.** Release IDs never change, because stories, the history file and links refer to them. Renumbering version prefixes in titles is offered, never automatic (ESM-195).
- **Warn, don't block.** A move that puts a prerequisite later is allowed, with a warning and a **Bring forward** option.
- **Signed-in internal viewers only.** Founders, PMs and admins who can already see the internal board. Customers never see the controls, the tray or a proposal.
- **GitHub only.** The hand-off and the icebox ideas target GitHub.
- **Comments and writing to GitHub from the board go to the Icebox,** because each changes the hosted board's boundaries.
- **Personas:** the founder and the PM inheriting a project. No reviewer or stakeholder persona.

Proposed in this plan:

- **One tray for every board edit.** Edits from the release controls, the selection bar and the story panel's Actions menu all join the tray. Nothing saves until **Save to file**, so a reorder and its fixes land as one change with one diff.
- **The edits file is the proposal.** The tray holds an `edit --from` edits file. The same JSON is saved locally, copied, put in the link and handed to the agent, so every route produces the same diff.
- **The hosted board never saves.** On a deployed board, the tray's only ways out are **Copy link**, **Open draft PR** and **Copy patch**.
- **Edits need JavaScript.** The release controls, drag, multi-select and the tray need `board.js`. Without it the board stays as it is today, read-only. No link or GET request ever changes the map, and saving stays a POST to ESM-112's save route, with its Origin and token checks.

## 1. Add, rename and move releases from the command line

**Story:** ESM-188 · depends on ESM-744 · activity `plan` · jobs `update-the-map`, `triage-backlog`.

There is no command to change a release. Add `story-map release add`, `release edit` and `release move`, built on the edit engine, so the board's controls and agents share one tested path.

```bash
npx --no-install story-map release add v0-9-2 --title "0.9.2: Slice templates" --summary "…" --after v0-9-1
npx --no-install story-map release edit v0-9-0 --summary "Create, move and review slices on the board"
npx --no-install story-map release move v0-9-0 --before v0-8-1
```

**Acceptance:**
- A dry run by default, printing the line diff, the `story-map diff` summary and any problems, as `edit` does. `--write` saves.
- `add` refuses an existing ID. `move` takes `--before` or `--after` a release. `edit` sets `--title` and `--summary`. None of them changes a release ID, deletes a release, or edits `notes`, `impact` or customer copy.
- `edit --from` accepts the same operations as `{ "release": "v0-9-0", "move": { "before": "v0-8-1" } }`, so a batch can mix release and story edits.
- `story-map diff` reports a release added, renamed or moved, and the summary's release order change.
- Tests named `ESM-188:` cover each operation, comments kept, refusals and a mixed batch.

## 2. Warn when a move puts a prerequisite later

**Story:** ESM-189 · depends on ESM-142, ESM-188 · activity `plan` · jobs `triage-backlog`, `agree-first-release-plan`.

Compare the risks of the map before and after an edit, and report the new ones: each planned or in-progress story whose prerequisite now sits in a later release, or is blocked or cut. Reuse ESM-142's risk check, so the board, the CLI and briefs agree.

**Acceptance:**
- Every edit dry run, `edit`, `add` and `release`, lists new risks with the story, the prerequisite and both releases, such as "ESM-189 depends on ESM-142, which would be in 0.8.1, after 0.9.0". It also lists risks the edit resolves.
- Risks that were already there are counted, not listed, as validation warnings are today.
- It is a warning: it never stops `--write`.
- JSON output carries `newRisks` and `resolvedRisks`.
- Tests named `ESM-189:` cover a release move, a story move, a move that fixes a risk, and chains across three releases.

## 3. Collect board edits and review their diff

**Story:** ESM-190 · depends on ESM-112, ESM-189 · activity `review` · jobs `triage-backlog`.

A **Pending changes** tray at the foot of the internal board holds unsaved edits as an edits file. It shows each edit in words, ESM-189's risks, and the line diff.

**Acceptance:**
- The tray opens when there is a pending edit, lists each with an Undo, and shows a count in the toolbar.
- The diff is the same line diff and `story-map diff` summary the CLI prints for the same edits file.
- On the local preview, **Save to file** writes through ESM-112's save route, with its Origin, token and changed-file checks. Elsewhere, **Copy patch** copies the edits as an `edit --from` file and the command to apply it.
- Pending edits survive a reload in the same browser, and the tray says when the map has changed since they were made.
- The story panel's Actions menu (ESM-181) adds to the tray instead of saving at once.
- Tests named `ESM-190:` cover adding, undoing, saving, a stale map and a customer view with no tray.

## 4. Create a slice and set its outcome

**Story:** ESM-191 · depends on ESM-188, ESM-190 · activity `plan` · jobs `triage-backlog`, `agree-first-release-plan`.

A **New release** control between release rows asks for a title and an outcome, and adds `release add` to the tray. The release's ID is suggested from its title and can be changed before it joins the tray.

**Acceptance:**
- The outcome is saved as the release `summary`, with the schema's length limit shown as you type.
- The new release appears as an empty lane in place, marked as pending.
- An ID that already exists is refused in the form.
- Tests named `ESM-191:` cover adding at the top, between and at the end, and a clashing ID.

## 5. Move a release up or down

**Story:** ESM-192 · depends on ESM-188, ESM-190 · activity `plan` · jobs `triage-backlog`.

Drag a release row by its handle, or use **Move up** and **Move down** in its release panel, to change the delivery order.

**Acceptance:**
- The board shows the proposed order at once, with the moved lane marked, and adds `release move` to the tray.
- ESM-189's warnings for the move appear in the tray as soon as it is dropped.
- Keyboard users can move a release from its panel. The drag handle has an accessible name.
- Collapsed lanes can move.
- Tests named `ESM-192:` cover drag, the panel buttons, the first and last lanes, and a collapsed lane.

## 6. Move several stories to another release

**Story:** ESM-193 · depends on ESM-190 · activity `plan` · jobs `triage-backlog`.

Select cards with a checkbox that appears on hover and focus, or with Shift-click, and choose **Move to** on the selection bar.

**Acceptance:**
- Selection works across activities and releases, and is cleared by Escape.
- **Move to** lists every release and adds one batch of `--release` edits to the tray.
- The tray shows the batch as one item with its stories, and Undo removes it whole.
- Tests named `ESM-193:` cover a mixed selection, an empty selection, and undo.

## 7. Bring a prerequisite forward

**Story:** ESM-194 · depends on ESM-189, ESM-190 · activity `plan` · jobs `triage-backlog`, `agree-first-release-plan`.

Each ESM-189 warning in the tray offers **Bring forward**. It moves the prerequisite into the dependent story's release, with any of its own unfinished prerequisites that would still be later.

**Acceptance:**
- The tray lists the stories it will move before adding them, such as "Move ESM-142 to 0.9.0".
- Merged and shipped prerequisites are never moved. A blocked or cut prerequisite is not moved, and the warning says why.
- The CLI offers the same with `--with-prerequisites` on `edit --release` and `release move`.
- Tests named `ESM-194:` cover a direct prerequisite, a chain, a merged prerequisite left alone, and a cut one.

## 8. Offer to renumber release titles

**Story:** ESM-195 · depends on ESM-192 · activity `plan` · jobs `triage-backlog`.

Many maps, including this one, start release titles with a version, such as "0.8.1: Dependency planning and graph". After a move puts them out of order, the tray offers **Renumber titles**.

**Acceptance:**
- Offered only when every affected title starts with a version and a colon, and a move has put them out of order.
- The offer says how many titles it would change. Before it joins the tray, it lists each title's old and new prefix, and it changes nothing else: never a release ID, a summary or a story.
- It is one item in the tray, with its own Undo.
- Tests named `ESM-195:` cover a simple swap, a map with no version prefixes, and mixed prefixes.

## 9. Compare the current and proposed release order

**Story:** ESM-196 · depends on ESM-189, ESM-190 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

A **Compare** view shows the current map and the proposed one side by side: the release order, each release's stories, and what moved.

**Acceptance:**
- Moved releases and stories, new releases and renamed titles are marked in both columns.
- A **Dependencies** list shows the risks the proposal adds and resolves, from ESM-189.
- A **Changes** list is the `story-map diff` summary.
- Opening a story shows its panel from the proposed map.
- It is read-only, and works for a proposal from the tray or from a link.
- Tests named `ESM-196:` cover moved releases, moved stories, a new release, and no changes.

## 10. Share a proposal as a private link

**Story:** ESM-197 · depends on ESM-196 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

**Copy link** puts the tray's edits file in the link's fragment, `#proposal=…`. The browser never sends the fragment to the server, so the link itself stays out of request logs. If ESM-199 works out a hosted proposal's diff with a host route rather than in the browser, the edits go to that route in a POST body, which the route must not log. Opening the link on the internal board applies the edits to the current map and opens the Compare view.

**Acceptance:**
- The link carries a format version and the map version it was made from. When the map has changed since, the view says so, and says which edits no longer apply.
- Only signed-in internal viewers see a proposal. For anyone else the link opens the board as if it had no fragment, and says nothing about a proposal.
- The edits are untrusted input: they are applied with the same checks as `edit --from`, and the link refuses customer copy, `draft` changes, notes and impact.
- A link longer than the board's limit says so and offers **Copy patch** instead.
- Tests named `ESM-197:` cover a round trip, a stale link, a malformed link, a customer viewer and the size limit.

## 11. Open a draft pull request from the board

**Story:** ESM-198 · depends on ESM-144, ESM-190 · activity `review` · jobs `triage-backlog`, `agree-first-release-plan`.

**Open draft PR** hands the proposal to Claude Code on the web, as ESM-144 does for agent briefs. The brief tells the agent to make a branch, apply the edits file with `story-map edit --from`, run validation and `story-map diff`, and open a draft pull request with the PR template filled in and the proposal link.

**Acceptance:**
- It uses the host's configured `webAgents`, and falls back to copying the brief when the link is too long, as ESM-144 does.
- The brief names the target repository, a descriptive branch name and the PR title, following this repository's rules.
- The board never holds a GitHub token.
- Tests named `ESM-198:` cover the brief's contents, the fallback, and a board with no `webAgents`.

## 12. Propose slice changes from the hosted board

**Story:** ESM-199 · depends on ESM-191 to ESM-194, ESM-197, ESM-198 · activity `plan` · jobs `agree-first-release-plan`, `triage-backlog`.

Turn on the 0.9.0 controls and the tray for signed-in internal viewers on a deployed board, so a founder or PM with no checkout can propose a change.

**Acceptance:**
- The host turns it on with one board option. It is off by default, and never on for customer viewers.
- On a deployed board the tray has no **Save to file**. Its only ways out are **Copy link**, **Open draft PR** and **Copy patch**.
- The diff and risks for a proposal are worked out without writing anything on the server.
- The guide's host set-up section shows how to turn it on.
- Tests named `ESM-199:` cover the option off, on, a customer viewer, and the absence of any save route.

## Icebox

These ideas are kept so their trade-offs are not lost. None is agreed, so each story is `blocked` with that reason, which keeps it out of ready lists and agent briefs. Each needs a consequential architecture decision that a person agrees before it moves out of the Icebox.

## 13. Comment on a release slice in a proposal

**Story:** ESM-200 · depends on ESM-197 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

Reviewers add a comment to a release in the Compare view and see earlier ones there.

Where comments live is the decision. On the draft pull request, anchored to the release's line in the YAML, they stay in GitHub with no new store, but the board must post them with a GitHub identity, which needs ESM-203. On the board, they need a data store the package does not have.

## 14. Open the draft pull request through a GitHub App

**Story:** ESM-203 · depends on ESM-198 · activity `review` · jobs `agree-first-release-plan`, `triage-backlog`.

Replace ESM-198's agent hand-off with a direct write, so **Open draft PR** creates the pull request in one step.

How it would work:

1. **Set-up, once per product.** A repository admin creates a GitHub App and installs it on the product's repository only, with two permissions: Contents (read and write) and Pull requests (read and write).
2. **The secret.** The host's server keeps the app's private key as a production secret. The board never sees it.
3. **On "Open draft PR".** After the host's own sign-in and authorize check, the server asks GitHub for an installation token that lasts an hour and works only on that repository. It uses the token to create a branch from the default branch, commit the changed `product/story-map.yaml` after applying the edits file with the same checks as `edit --from`, and open a draft pull request with the `story-map diff` summary.
4. **Credit.** The commit is authored by the app's bot, such as `yourapp-story-map[bot]`, with the founder or PM named as co-author. The history file already credits whoever merges when the author is a bot.

What it costs: every host creates the app and keeps a secret, and every signed-in internal viewer can create branches and pull requests through it, though branch protection still stops them merging. It reverses the agreed decision that the board is read-only.

## 15. Open a live proposal from its pull request

**Story:** ESM-204 · depends on ESM-196, ESM-203 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

A link such as `?proposal=<PR number>` reads the map from the pull request's branch, so the Compare view follows later commits to the proposal, not only the edits that were in a link. It needs the host's server to read the repository, with ESM-203's app or a read-only token.

## Architecture decisions

Following [Record architecture decisions](../ENGINEERING-OVERVIEW.md#record-architecture-decisions). Every story here is planned or in the Icebox, and none is agreed.

- **Where it runs.** 0.9.0 and 0.9.1 run inside the existing package: a new `story-map release` command and release operations in the edit engine (`src/edit.ts`), a risk comparison beside ESM-142's projection, the tray, controls and Compare view in `src/react.tsx` and `board.js`, and the existing local-preview save route. No service or data store. The Icebox stories would add a host-side GitHub integration.
- **Data and contracts.**
  - The map format and its JSON Schema do not change. A release's outcome is its existing `summary`.
  - The `edit --from` edits file gains release operations. This is additive, and agents, the tray, links and the hand-off all read it.
  - `story-map diff` and its JSON gain release added, renamed and moved lines, and edit dry runs gain `newRisks` and `resolvedRisks`. Both are additive. Hosts that parse the diff's JSON should ignore unknown change kinds.
  - The board gains a tray, release controls, a selection bar, a Compare view and a `hostedProposals` option (ESM-199), off by default.
  - The history file, the MCP tools and the files hosts receive from `init` do not change in 0.9.0. The guide gains sections for the new command and the board edits.
- **Boundaries.**
  - [The board is read-only](../ENGINEERING-OVERVIEW.md#agreed-architecture-decisions) is kept for deployed boards: 0.9.x never saves on the server. The local preview saves as ESM-112 does, with its Origin, token and changed-file checks.
  - [Project, then filter, then render](../ENGINEERING-OVERVIEW.md#security-boundaries-to-preserve) and the customer allow-list: customers never see the controls, the tray, a proposal or its risks, including in client-side payloads.
  - **Permalinks reveal nothing new:** a proposal link opened by a customer, or by someone not signed in, gives the same board as no link.
  - **Edits are untrusted input:** a link's edits pass the same checks as `edit --from`, and can never add customer copy, remove `draft`, or change notes and impact.
  - **React escapes all text:** titles and summaries from a link are rendered as text.
- **Reversibility.** The command, the board controls and the tray can each be removed in a release with a changelog note. The proposal link is the hard part: links pasted into pull requests and chats outlive the code. Each link carries a format version, and an old or unknown version must say it cannot be opened rather than show a wrong proposal.

Consequential decisions, each a proposal for a person to agree:

| Decision | Affected consumers | Alternative considered | Agreed | Revisit when |
| --- | --- | --- | --- | --- |
| The proposal link format: a versioned edits file in the fragment (ESM-197) | Anyone holding a link; the board, which must read every version it has issued | A proposal saved on the server and linked by ID, which needs a data store; or a pull request link only, which needs ESM-204 | Not yet | Links grow past the length limit for real proposals, or ESM-204 lands |
| Working out a hosted proposal's diff and risks (ESM-199): in the browser, which ships the YAML splicing and checks in `board.js`, or with a read-only host route that applies the edits in memory and returns the view | Hosts, which add a route for the second option; `board.js` size for the first | Saving drafts on the server, which reverses the read-only decision | Not yet | Measure `board.js` with the edit engine before choosing |
| Comments on a slice (ESM-200) | Hosts; GitHub, if comments go on the pull request | A comment store in the package | Not yet | ESM-203 is agreed, or reviewers ask for comments the pull request cannot hold |
| A GitHub App that writes branches and pull requests (ESM-203) | Every host, which creates the app and keeps a secret; the read-only board decision, which it reverses; the history file's credit, which already handles bot authors | Each person's own GitHub sign-in (OAuth), which commits as them but needs an OAuth app and a GitHub account with write access; ESM-198's agent hand-off, which needs no new set-up | Not yet | The hand-off proves too slow, or founders and PMs without Claude Code need to propose changes |
| Reading a pull request's branch from the host (ESM-204) | Hosts, which keep a read token | Proposal links only, as ESM-197 | Not yet | ESM-203 is agreed |

## Delivery sequence

**0.9.0:** ESM-188, then ESM-189 once ESM-142 has landed in 0.8.1. Then ESM-190, after which ESM-191, ESM-192 and ESM-193 can run in parallel. ESM-194 follows ESM-190, and ESM-195 follows ESM-192.

**0.9.1:** ESM-196, then ESM-197 and ESM-198 in parallel, then ESM-199.

**Icebox:** nothing until each decision above is agreed.

Implementation should use focused PRs per story, include the story IDs in test names and commit messages, and run `npm run validate`, the relevant tests and `story-map diff origin/main`.

## Decisions to make

| Question | Proposal |
| --- | --- |
| Should the story panel's Actions menu join the tray, or keep saving at once on the local preview? | Join the tray, so every board edit has one diff and one save. |
| Does Bring forward move the whole chain of unfinished prerequisites, or only the direct one? | The whole chain that would still be later, listed before it is added. |
| Where is a hosted proposal's diff worked out? | Decide after measuring `board.js` with the edit engine (see Architecture decisions). |
| Is ESM-195, renumbering titles, a could-have? | Yes, and it can move to a later release without affecting the rest. |
| Should the tray remember pending edits across reloads? | Yes, in the browser only, with a note when the map has changed since. |

## Not now

- **A reviewer or stakeholder persona.** Kept out to avoid enterprise scope. The founder's and PM's jobs cover the review.
- **Links for people without a sign-in,** such as per-link tokens or expiry. Reviewers are signed-in internal viewers.
- **GitLab, Bitbucket or other hosts.** GitHub only.
- **Changing release IDs,** merging two releases, or deleting one. A move changes only the order.
- **Editing release notes and impact on the board.** They stay PR-only, as ESM-404's cut decided and `AGENTS.md` says.
- **Reordering stories within a release.** Story order in a release is not a planning signal today.

## Effort and release fit

| Story | Points |
| --- | --- |
| ESM-188 Add, rename and move releases from the command line | not agreed |
| ESM-189 Warn when a move puts a prerequisite in a later release | not agreed |
| ESM-190 Collect board edits and review their Git diff before saving | not agreed |
| ESM-191 Create a release slice and set its outcome on the board | not agreed |
| ESM-192 Move a release row up or down on the board | not agreed |
| ESM-193 Move several stories to another release on the board | not agreed |
| ESM-194 Bring a prerequisite forward from a move warning | not agreed |
| ESM-195 Offer to renumber release titles after a move | not agreed |
| ESM-196 Compare the current and proposed release order | not agreed |
| ESM-197 Share a proposal as a private link | not agreed |
| ESM-198 Open a draft pull request from the board | not agreed |
| ESM-199 Propose slice changes from the hosted board without a checkout | not agreed |
| ESM-200, ESM-203, ESM-204 (Icebox) | not sized |
| **Total** | not agreed |

ESM-195 can move to a later release on its own. ESM-188 and ESM-189 are useful to agents before any board work, so they could ship first in a smaller release if 0.9.0 is too large.

## Draft release impact

0.9.0:

- **Time to reorder a release slice and see what it affects:** one move on the board, with the affected prerequisites and the Git diff shown before saving; solves editing release IDs by hand and tracing dependencies story by story.
- **Release moves that put a prerequisite after the story that needs it:** caught on the board before saving, with an option to bring the prerequisite forward; solves plans that cannot be built in the order they show.

0.9.1:

- **Steps for a reviewer to see what a proposed release order changes:** open one link and see current and proposed side by side; solves reading YAML diffs or checking out a branch.
- **Release changes a PM can propose without a local checkout:** every slice edit from 0.9.0, ending in a draft pull request; solves depending on an engineer or a local set-up.

Icebox:

- **Hosted review ideas with an agreed architecture decision:** each idea agreed, changed or cut by a person before it is planned; solves building ideas that change the hosted board's boundaries before anyone agrees them.

All five are hypotheses awaiting review (`draft: true` in the map). No baseline or actual improvement is claimed.
