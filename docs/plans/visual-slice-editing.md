# Plan: Edit and review release slices visually

Status: proposed. The work is ESM-209 to ESM-216 in **0.9.0: Edit release slices visually**, ESM-217 to ESM-220 in **0.9.1: Review proposed maps in the browser**, and ESM-221, ESM-222 and ESM-223 in **Icebox: Hosted review ideas**. None has an agreed estimate yet. No customer-facing copy is approved.

0.9.0: Edit release slices visually

1. [Add, rename and move releases from the command line](#1-add-rename-and-move-releases-from-the-command-line) (ESM-209)
2. [Warn when a move puts a prerequisite later](#2-warn-when-a-move-puts-a-prerequisite-later) (ESM-210)
3. [Collect board edits and review their diff](#3-collect-board-edits-and-review-their-diff) (ESM-211)
4. [Create a slice and set its outcome](#4-create-a-slice-and-set-its-outcome) (ESM-212)
5. [Move a release up or down](#5-move-a-release-up-or-down) (ESM-213)
6. [Move several stories to another release](#6-move-several-stories-to-another-release) (ESM-214)
7. [Bring a prerequisite forward](#7-bring-a-prerequisite-forward) (ESM-215)
8. [Offer to renumber release titles](#8-offer-to-renumber-release-titles) (ESM-216)

0.9.1: Review proposed maps in the browser

9. [Compare the current and proposed release order](#9-compare-the-current-and-proposed-release-order) (ESM-217)
10. [Share a proposal as a private link](#10-share-a-proposal-as-a-private-link) (ESM-218)
11. [Open a draft pull request from the board](#11-open-a-draft-pull-request-from-the-board) (ESM-219)
12. [Propose slice changes from the hosted board](#12-propose-slice-changes-from-the-hosted-board) (ESM-220)

[Icebox](#icebox): Hosted review ideas, not agreed

13. [Comment on a release slice in a proposal](#13-comment-on-a-release-slice-in-a-proposal) (ESM-221)
14. [Open the draft pull request through a GitHub App](#14-open-the-draft-pull-request-through-a-github-app) (ESM-222)
15. [Open a live proposal from its pull request](#15-open-a-live-proposal-from-its-pull-request) (ESM-223)

## Why and customer outcome

Changing the plan is the Solo Builder's `triage-backlog` job: *"I can move a slice in the board, see affected prerequisites, and review a focused Git patch."* Today that means editing release IDs in the YAML or running `story-map edit` story by story, and tracing `dependsOn` links by hand to see what a move breaks. There is no command at all to create, rename or reorder a release.

The PM inheriting a project has the same need at a different moment, `agree-first-release-plan`: they propose a new release order and need the team to see what moved and what it affects before agreeing it. Often they have no local checkout, so they depend on an engineer to make the change.

Success: a signed-in founder or PM rearranges slices on the board, sees each prerequisite a move puts later and can bring it forward, reviews the Git diff, and either saves it locally or shares a link and opens a draft pull request, without a checkout. A reviewer opens that link and sees the current and proposed order side by side.

The reviewer is served through the founder's `share-roadmap` job and the PM's `agree-first-release-plan`. No reviewer persona is added, to keep enterprise roles out of scope.

## What it builds on

- **ESM-744** (shipped), `story-map edit` and `add`: named edits applied as line splices, with a dry-run diff and validation. ESM-209 adds release operations to the same engine, and `edit --from` gains them, so every board edit has a command behind it. See [the native CLI plan](native-cli.md#5-propose-edits).
- **ESM-112** (shipped) and **ESM-181** (merged): the local preview saves the story panel's status and release changes, with an Origin check, a start-up token and a refusal when the file changed since the page loaded. Elsewhere, the Actions menu copies the edit command. ESM-211's tray uses the same save route and the same copy fallback. See [the local triage plan](local-triage.md#3-save-changes-from-the-local-preview).
- **ESM-156** (shipped): the pattern for a host's own board to edit on the builder's machine, with editing off in production.
- **ESM-304** (shipped), `story-map diff`: the PR summary that the tray, the Compare view and the draft pull request reuse.
- **ESM-129** (shipped) and **ESM-139** (shipped): `dependsOn` links and readiness.
- **ESM-142** (planned, 0.8.1): a release's order and its cut, blocked and later-release risks. ESM-210 runs the same risk check on a proposed map, so it depends on ESM-142. See [the visual dependency map plan](visual-dependency-map.md#2-suggest-a-delivery-order-for-a-release).
- **ESM-144** (shipped): the board opens an agent brief in Claude Code on the web. ESM-219 hands the proposal over the same way.
- **ESM-114** and **ESM-115** (planned, 0.8.2): list and compare map versions, and switch the board to one. They are related to the Compare view but not a prerequisite: ESM-217 compares the current map with a proposal of edits, not two commits. If they land first, the Compare view can reuse their layout. See [the map versions plan](map-versions.md).
- **ESM-404** (cut): editing release notes and impact on the board. It was cut because saving needs the map on a hosted service. This plan keeps that decision on the hosted board: it never saves there. Release notes and impact stay PR-only.

## UI mockup

![Mockup of the internal board after 0.9.0 is dragged above 0.8.1, with a Pending changes tray warning that ESM-210 now waits on ESM-142 in a later release and offering Bring forward, two selected cards with a Move to bar, a New release form, and a Compare view of the current and proposed release order](visual-slice-editing-mockup.png)

The mockup is [visual-slice-editing-mockup.html](visual-slice-editing-mockup.html), built on the real `styles.css` and the board's real markup, rendered from this map with the 0.9.0, 0.8.1 and 0.8.2 lanes kept, in the proposed order. Every story, release and dependency in it is from this map. The tray, the drag handle, the selection bar, the New release form and the Compare view are proposed. To refresh the image, serve the repository root, open the file at 1360 px wide and take a full-page screenshot.

What it shows:

1. **0.9.0 dragged above 0.8.1** (ESM-213), with a drag handle on the release heading. Move up and Move down are in the release panel, not shown.
2. **The Pending changes tray** (ESM-211): each pending edit, the prerequisites they put later, and the line diff, with **Save to file** on the local preview, **Copy link**, **Open draft PR** and **Copy patch**.
3. **A move warning** (ESM-210): ESM-210 depends on ESM-142, which the move leaves in 0.8.1, now after 0.9.0. **Bring forward** (ESM-215) moves ESM-142 into 0.9.0 as another pending edit.
4. **Two selected cards**, ESM-113 and ESM-114, with a **Move to** bar (ESM-214).
5. **A New release form** between rows (ESM-212), with a title and an outcome, saved as the release's `summary`.
6. **The Compare view** (ESM-217): current and proposed order side by side, with moved releases and stories marked and the dependency the proposal breaks.

## Product decisions

Agreed with the repository owner while planning:

- **A release's outcome is its `summary`.** No new field.
- **Moving a release changes only its place in the list.** Release IDs never change, because stories, the history file and links refer to them. Renumbering version prefixes in titles is offered, never automatic (ESM-216).
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

**Story:** ESM-209 · depends on ESM-744 · activity `plan` · jobs `update-the-map`, `triage-backlog`.

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
- Tests named `ESM-209:` cover each operation, comments kept, refusals and a mixed batch.

## 2. Warn when a move puts a prerequisite later

**Story:** ESM-210 · depends on ESM-142, ESM-209 · activity `plan` · jobs `triage-backlog`, `agree-first-release-plan`.

Compare the risks of the map before and after an edit, and report the new ones: each planned or in-progress story whose prerequisite now sits in a later release, or is blocked or cut. Reuse ESM-142's risk check, so the board, the CLI and briefs agree.

**Acceptance:**
- Every edit dry run, `edit`, `add` and `release`, lists new risks with the story, the prerequisite and both releases, such as "ESM-210 depends on ESM-142, which would be in 0.8.1, after 0.9.0". It also lists risks the edit resolves.
- Risks that were already there are counted, not listed, as validation warnings are today.
- It is a warning: it never stops `--write`.
- JSON output carries `newRisks` and `resolvedRisks`.
- Tests named `ESM-210:` cover a release move, a story move, a move that fixes a risk, and chains across three releases.

## 3. Collect board edits and review their diff

**Story:** ESM-211 · depends on ESM-112, ESM-210 · activity `review` · jobs `triage-backlog`.

A **Pending changes** tray at the foot of the internal board holds unsaved edits as an edits file. It shows each edit in words, ESM-210's risks, and the line diff.

**Acceptance:**
- The tray opens when there is a pending edit, lists each with an Undo, and shows a count in the toolbar.
- The diff is the same line diff and `story-map diff` summary the CLI prints for the same edits file.
- On the local preview, **Save to file** writes through ESM-112's save route, with its Origin, token and changed-file checks. Elsewhere, **Copy patch** copies the edits as an `edit --from` file and the command to apply it.
- Pending edits survive a reload in the same browser, and the tray says when the map has changed since they were made.
- The story panel's Actions menu (ESM-181) adds to the tray instead of saving at once.
- Tests named `ESM-211:` cover adding, undoing, saving, a stale map and a customer view with no tray.

## 4. Create a slice and set its outcome

**Story:** ESM-212 · depends on ESM-209, ESM-211 · activity `plan` · jobs `triage-backlog`, `agree-first-release-plan`.

A **New release** control between release rows asks for a title and an outcome, and adds `release add` to the tray. The release's ID is suggested from its title and can be changed before it joins the tray.

**Acceptance:**
- The outcome is saved as the release `summary`, with the schema's length limit shown as you type.
- The new release appears as an empty lane in place, marked as pending.
- An ID that already exists is refused in the form.
- Tests named `ESM-212:` cover adding at the top, between and at the end, and a clashing ID.

## 5. Move a release up or down

**Story:** ESM-213 · depends on ESM-209, ESM-211 · activity `plan` · jobs `triage-backlog`.

Drag a release row by its handle, or use **Move up** and **Move down** in its release panel, to change the delivery order.

**Acceptance:**
- The board shows the proposed order at once, with the moved lane marked, and adds `release move` to the tray.
- ESM-210's warnings for the move appear in the tray as soon as it is dropped.
- Keyboard users can move a release from its panel. The drag handle has an accessible name.
- Collapsed lanes can move.
- Tests named `ESM-213:` cover drag, the panel buttons, the first and last lanes, and a collapsed lane.

## 6. Move several stories to another release

**Story:** ESM-214 · depends on ESM-211 · activity `plan` · jobs `triage-backlog`.

Select cards with a checkbox that appears on hover and focus, or with Shift-click, and choose **Move to** on the selection bar.

**Acceptance:**
- Selection works across activities and releases, and is cleared by Escape.
- **Move to** lists every release and adds one batch of `--release` edits to the tray.
- The tray shows the batch as one item with its stories, and Undo removes it whole.
- Tests named `ESM-214:` cover a mixed selection, an empty selection, and undo.

## 7. Bring a prerequisite forward

**Story:** ESM-215 · depends on ESM-210, ESM-211 · activity `plan` · jobs `triage-backlog`, `agree-first-release-plan`.

Each ESM-210 warning in the tray offers **Bring forward**. It moves the prerequisite into the dependent story's release, with any of its own unfinished prerequisites that would still be later.

**Acceptance:**
- The tray lists the stories it will move before adding them, such as "Move ESM-142 to 0.9.0".
- Merged and shipped prerequisites are never moved. A blocked or cut prerequisite is not moved, and the warning says why.
- The CLI offers the same with `--with-prerequisites` on `edit --release` and `release move`.
- Tests named `ESM-215:` cover a direct prerequisite, a chain, a merged prerequisite left alone, and a cut one.

## 8. Offer to renumber release titles

**Story:** ESM-216 · depends on ESM-213 · activity `plan` · jobs `triage-backlog`.

Many maps, including this one, start release titles with a version, such as "0.8.1: Dependency planning and graph". After a move puts them out of order, the tray offers **Renumber titles**.

**Acceptance:**
- Offered only when every affected title starts with a version and a colon, and a move has put them out of order.
- The offer says how many titles it would change. Before it joins the tray, it lists each title's old and new prefix, and it changes nothing else: never a release ID, a summary or a story.
- It is one item in the tray, with its own Undo.
- Tests named `ESM-216:` cover a simple swap, a map with no version prefixes, and mixed prefixes.

## 9. Compare the current and proposed release order

**Story:** ESM-217 · depends on ESM-210, ESM-211 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

A **Compare** view shows the current map and the proposed one side by side: the release order, each release's stories, and what moved.

**Acceptance:**
- Moved releases and stories, new releases and renamed titles are marked in both columns.
- A **Dependencies** list shows the risks the proposal adds and resolves, from ESM-210.
- A **Changes** list is the `story-map diff` summary.
- Opening a story shows its panel from the proposed map.
- It is read-only, and works for a proposal from the tray or from a link.
- Tests named `ESM-217:` cover moved releases, moved stories, a new release, and no changes.

## 10. Share a proposal as a private link

**Story:** ESM-218 · depends on ESM-217 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

**Copy link** puts the tray's edits file in the link's fragment, `#proposal=…`. The browser never sends the fragment to the server, so the link itself stays out of request logs. If ESM-220 works out a hosted proposal's diff with a host route rather than in the browser, the edits go to that route in a POST body, which the route must not log. Opening the link on the internal board applies the edits to the current map and opens the Compare view.

**Acceptance:**
- The link carries a format version and the map version it was made from. When the map has changed since, the view says so, and says which edits no longer apply.
- Only signed-in internal viewers see a proposal. For anyone else the link opens the board as if it had no fragment, and says nothing about a proposal.
- The edits are untrusted input: they are applied with the same checks as `edit --from`, and the link refuses customer copy, `draft` changes, notes and impact.
- A link longer than the board's limit says so and offers **Copy patch** instead.
- Tests named `ESM-218:` cover a round trip, a stale link, a malformed link, a customer viewer and the size limit.

## 11. Open a draft pull request from the board

**Story:** ESM-219 · depends on ESM-144, ESM-211 · activity `review` · jobs `triage-backlog`, `agree-first-release-plan`.

**Open draft PR** hands the proposal to Claude Code on the web, as ESM-144 does for agent briefs. The brief tells the agent to make a branch, apply the edits file with `story-map edit --from`, run validation and `story-map diff`, and open a draft pull request with the PR template filled in and the proposal link.

**Acceptance:**
- It uses the host's configured `webAgents`, and falls back to copying the brief when the link is too long, as ESM-144 does.
- The brief names the target repository, a descriptive branch name and the PR title, following this repository's rules.
- The board never holds a GitHub token.
- Tests named `ESM-219:` cover the brief's contents, the fallback, and a board with no `webAgents`.

## 12. Propose slice changes from the hosted board

**Story:** ESM-220 · depends on ESM-212 to ESM-215, ESM-218, ESM-219 · activity `plan` · jobs `agree-first-release-plan`, `triage-backlog`.

Turn on the 0.9.0 controls and the tray for signed-in internal viewers on a deployed board, so a founder or PM with no checkout can propose a change.

**Acceptance:**
- The host turns it on with one board option. It is off by default, and never on for customer viewers.
- On a deployed board the tray has no **Save to file**. Its only ways out are **Copy link**, **Open draft PR** and **Copy patch**.
- The diff and risks for a proposal are worked out without writing anything on the server.
- The guide's host set-up section shows how to turn it on.
- Tests named `ESM-220:` cover the option off, on, a customer viewer, and the absence of any save route.

## Icebox

These ideas are kept so their trade-offs are not lost. None is agreed, so each story is `blocked` with that reason, which keeps it out of ready lists and agent briefs. Each needs a consequential architecture decision that a person agrees before it moves out of the Icebox.

## 13. Comment on a release slice in a proposal

**Story:** ESM-221 · depends on ESM-218 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

Reviewers add a comment to a release in the Compare view and see earlier ones there.

Where comments live is the decision. On the draft pull request, anchored to the release's line in the YAML, they stay in GitHub with no new store, but the board must post them with a GitHub identity, which needs ESM-222. On the board, they need a data store the package does not have.

## 14. Open the draft pull request through a GitHub App

**Story:** ESM-222 · depends on ESM-219 · activity `review` · jobs `agree-first-release-plan`, `triage-backlog`.

Replace ESM-219's agent hand-off with a direct write, so **Open draft PR** creates the pull request in one step.

How it would work:

1. **Set-up, once per product.** A repository admin creates a GitHub App and installs it on the product's repository only, with two permissions: Contents (read and write) and Pull requests (read and write).
2. **The secret.** The host's server keeps the app's private key as a production secret. The board never sees it.
3. **On "Open draft PR".** After the host's own sign-in and authorize check, the server asks GitHub for an installation token that lasts an hour and works only on that repository. It uses the token to create a branch from the default branch, commit the changed `product/story-map.yaml` after applying the edits file with the same checks as `edit --from`, and open a draft pull request with the `story-map diff` summary.
4. **Credit.** The commit is authored by the app's bot, such as `yourapp-story-map[bot]`, with the founder or PM named as co-author. The history file already credits whoever merges when the author is a bot.

What it costs: every host creates the app and keeps a secret, and every signed-in internal viewer can create branches and pull requests through it, though branch protection still stops them merging. It reverses the agreed decision that the board is read-only.

## 15. Open a live proposal from its pull request

**Story:** ESM-223 · depends on ESM-217, ESM-222 · activity `review` · jobs `share-roadmap`, `agree-first-release-plan`.

A link such as `?proposal=<PR number>` reads the map from the pull request's branch, so the Compare view follows later commits to the proposal, not only the edits that were in a link. It needs the host's server to read the repository, with ESM-222's app or a read-only token.

## Architecture decisions

Following [Record architecture decisions](../ENGINEERING-OVERVIEW.md#record-architecture-decisions). Every story here is planned or in the Icebox, and none is agreed.

- **Where it runs.** 0.9.0 and 0.9.1 run inside the existing package: a new `story-map release` command and release operations in the edit engine (`src/edit.ts`), a risk comparison beside ESM-142's projection, the tray, controls and Compare view in `src/react.tsx` and `board.js`, and the existing local-preview save route. No service or data store. The Icebox stories would add a host-side GitHub integration.
- **Data and contracts.**
  - The map format and its JSON Schema do not change. A release's outcome is its existing `summary`.
  - The `edit --from` edits file gains release operations. This is additive, and agents, the tray, links and the hand-off all read it.
  - `story-map diff` and its JSON gain release added, renamed and moved lines, and edit dry runs gain `newRisks` and `resolvedRisks`. Both are additive. Hosts that parse the diff's JSON should ignore unknown change kinds.
  - The board gains a tray, release controls, a selection bar, a Compare view and a `hostedProposals` option (ESM-220), off by default.
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
| The proposal link format: a versioned edits file in the fragment (ESM-218) | Anyone holding a link; the board, which must read every version it has issued | A proposal saved on the server and linked by ID, which needs a data store; or a pull request link only, which needs ESM-223 | Not yet | Links grow past the length limit for real proposals, or ESM-223 lands |
| Working out a hosted proposal's diff and risks (ESM-220): in the browser, which ships the YAML splicing and checks in `board.js`, or with a read-only host route that applies the edits in memory and returns the view | Hosts, which add a route for the second option; `board.js` size for the first | Saving drafts on the server, which reverses the read-only decision | Not yet | Measure `board.js` with the edit engine before choosing |
| Comments on a slice (ESM-221) | Hosts; GitHub, if comments go on the pull request | A comment store in the package | Not yet | ESM-222 is agreed, or reviewers ask for comments the pull request cannot hold |
| A GitHub App that writes branches and pull requests (ESM-222) | Every host, which creates the app and keeps a secret; the read-only board decision, which it reverses; the history file's credit, which already handles bot authors | Each person's own GitHub sign-in (OAuth), which commits as them but needs an OAuth app and a GitHub account with write access; ESM-219's agent hand-off, which needs no new set-up | Not yet | The hand-off proves too slow, or founders and PMs without Claude Code need to propose changes |
| Reading a pull request's branch from the host (ESM-223) | Hosts, which keep a read token | Proposal links only, as ESM-218 | Not yet | ESM-222 is agreed |

Each decision in more detail follows: what it means in plain English, what changes technically, the risks, and a recommendation. All five recommendations are proposals.

### Decision 1: the proposal link format

**In plain English.** **Copy link** packs the proposed changes into the link itself, so whoever opens it sees the proposal and nothing is stored anywhere. Links get pasted into pull requests and chats and are kept for years, so the format is a promise to keep.

**How it works.**
- The link looks like `https://product.example/story-map#proposal=<encoded>`.
- The encoded part is the tray's edits, compressed and made safe for a URL.
- The edits are in the same JSON shape `story-map edit --from` reads, such as `{ "release": "v0-9-0", "move": { "before": "v0-8-1" } }`, so the CLI and the link never disagree.
- The payload also carries `v: 1`, the format version, and `base`, a short fingerprint of the map the edits were made against, to tell when the map has changed since.

**What changes technically.**
- A new module, about `src/proposal.ts`, encodes, decodes and checks a link. The board script reads `location.hash` when the page loads.
- Everything after `#` stays in the browser and never reaches the server, so the link stays out of server and proxy logs.
- A link's edits are untrusted input, because anyone can write one by hand. They pass the same checks as `edit --from`, and a link can never add customer-facing copy, remove `draft`, or touch release notes or impact.
- Customers can't use a link to see internal plans: their board never receives the internal map, so there is nothing to apply the edits to, and the board ignores the fragment for them.
- Chat tools cut long links off. Over a size limit, the board offers **Copy patch** instead, as ESM-144 does for long briefs.

**Reversibility.** The hard part. Every `v: 1` link ever shared must keep opening, or clearly say the format is no longer supported. It must never quietly show the wrong proposal.

**Alternatives.** Saving proposals on the server and sharing an ID gives short links that can be updated, but every host then needs a database and rules for who can see and delete drafts. Linking only to the pull request (ESM-223) is always current, but needs GitHub access on the server.

**Recommendation.** Agree it. It is the cheapest option that works without a checkout.

### Decision 2: where a proposal's diff is worked out

**In plain English.** Something has to take the current map and the proposed edits and produce the new map, the Git diff and the dependency warnings. That can happen in the reader's browser, or on the product's server without saving anything.

**Option A: in the browser.**
- `board.js`, small today with no dependencies, would bundle the YAML parser, the schema checks (Zod), the edit engine (`src/edit.ts`) and the diff and risk code. Every host's page would load much more.
- The page would need the raw `story-map.yaml`, not only the internal view it gets today. For internal viewers that leaks nothing, but it is new for the page to carry it.

**Option B: a read-only server route.**
- The board sends the edits to a route such as `POST /story-map/proposal`. The route checks that the viewer is signed in as internal with the host's existing check, loads the map, applies the edits in memory with the same edit engine the CLI uses, and returns the Compare view and the diff.
- It never writes a file. It must not log the request body, and it caps the body's size.
- The local preview needs this route anyway for the tray's diff (ESM-211), so it is built once.
- It follows the pattern ESM-156 set for persona editing in a host: a request handler the package exports and the host mounts.

**What changes for hosts.** With option B, hosts add one route, the package gains one exported handler, which is a new package export, and the host's sign-in check guards a route that accepts input. Option A changes nothing on the server, but every host's page gets heavier.

**Reversibility.** Easy either way: nothing is stored, and the route or the bundle can be removed in a release.

**Note.** With option B the edits reach the server in the request body, not the URL, as ESM-218 says.

**Recommendation.** Option B.

### Decision 3: comments on a slice

**In plain English.** Reviewers want to say "I'm not sure about moving 0.9.0 up" next to the slice. The hard part is where the comment lives and who it is from, because being signed in to the product is not being signed in to GitHub.

**Option A: comments on the draft pull request,** attached to the release's line in `product/story-map.yaml`. They stay in Git with no new store, and people see them in GitHub too. Posting needs a GitHub identity: the GitHub App (decision 4), with comments from the bot and the reviewer's name in the text, or each person's own GitHub sign-in, which needs an OAuth app. Showing earlier comments on the board means the server reading them from GitHub.

**Option B: comments stored by the board.** Every host provides a database or key-value store, and the package defines how it is used. It brings questions about editing, deleting, keeping and protecting comments, and breaks the principle that the plan lives in Git.

**Option C: a stopgap that needs no decision.** A **Copy slice link** in the Compare view: a proposal link that opens on that release. Reviewers paste it into an ordinary pull request comment. It would be a small addition to ESM-218.

**Recommendation.** Option C with 0.9.1, and option A once decision 4 is settled.

### Decision 4: a GitHub App that writes to the repository

**In plain English.** Instead of handing the proposal to an agent, **Open draft PR** creates the pull request in one click. The product gets a robot GitHub account that can make branches and pull requests in its own repository. It is convenient, but the deployed board can then change the repository, which the agreed "the board is read-only" decision rules out today.

**What changes technically.**
- **Set-up for each host.** A repository admin creates a GitHub App and installs it on the one repository, with Contents and Pull requests set to read and write. The host keeps the app ID, the installation ID and the private key as production secrets.
- **A new server route,** such as `POST /story-map/proposals/pull-request`, which:
  1. checks that the viewer is internal and that the request came from the board's own page, with the Origin check ESM-112 uses,
  2. signs a short request with the private key and exchanges it with GitHub for an installation token that lasts an hour and works only on that repository,
  3. applies the edits with the edit engine and validates the result,
  4. reads the default branch through GitHub's API, creates a branch such as `story-map/esm-213-move-0-9-0`, commits the changed `story-map.yaml`, and opens a draft pull request with the `story-map diff` summary.
- **Credit.** The commit's author is the bot, such as `yourapp-story-map[bot]`, with the founder or PM as co-author, which uses their email address and needs agreeing for privacy. The history file already credits whoever merges when the author is a bot.
- **The package** gains a new exported handler, and probably a GitHub client library that every host then installs.
- **The engineering overview** rewords "the board is read-only" to say a deployed board can open pull requests, but never push to the default branch.

**Risks.** Anyone who can sign in as internal can create branches and pull requests. Branch protection still stops them merging, but a mistake in the host's sign-in check becomes write access to the repository. The private key is a valuable secret to look after.

**Reversibility.** Moderate. Hosts uninstall the app and delete the secret, and the pull requests it opened stay as ordinary pull requests.

**Alternatives.** Each person signing in to GitHub with OAuth commits as themselves with no bot, but every PM needs a GitHub account with write access, and the host stores their tokens in sessions. ESM-219's agent hand-off needs no new set-up, at the cost of an agent step.

**Recommendation.** Keep it in the Icebox until ESM-219 has been used for a while. Revisit if the hand-off proves too slow, or founders and PMs without Claude Code need to propose changes.

### Decision 5: opening a live proposal from its pull request

**In plain English.** A link such as `?proposal=203` shows whatever is on that pull request's branch now, so a reviewer sees the latest version rather than a copy from when someone made a link.

**What changes technically.**
- The server needs read access to the repository: the GitHub App from decision 4, or a read-only token.
- It reads the pull request to find its latest commit, reads `product/story-map.yaml` at that commit, and caches it to stay within GitHub's rate limits. Then it shows the same Compare view.

**Risks.** A pull request's branch is untrusted: on a public repository anyone can open one. So only pull requests from the repository itself are read, never from forks, the YAML passes the normal schema checks with its text escaped, and only internal viewers can use it.

**Reversibility.** Easy: it is read-only and stores nothing but the token.

**Recommendation.** Decide it together with decision 4, since they would share the same GitHub access.

### What hosts would notice

| Release | What changes for a host product |
| --- | --- |
| 0.9.0 | Nothing on a deployed board. The local preview gains the tray and its save. |
| 0.9.1 | One option to turn proposals on, and one read-only proposal route if decision 2 chooses option B. No secrets and no writes. |
| Icebox | A GitHub App, its secrets and a route that writes to the repository, only if decisions 3 to 5 are agreed. |

## Delivery sequence

**0.9.0:** ESM-209, then ESM-210 once ESM-142 has landed in 0.8.1. Then ESM-211, after which ESM-212, ESM-213 and ESM-214 can run in parallel. ESM-215 follows ESM-211, and ESM-216 follows ESM-213.

**0.9.1:** ESM-217, then ESM-218 and ESM-219 in parallel, then ESM-220.

**Icebox:** nothing until each decision above is agreed.

Implementation should use focused PRs per story, include the story IDs in test names and commit messages, and run `npm run validate`, the relevant tests and `story-map diff origin/main`.

## Decisions to make

| Question | Proposal |
| --- | --- |
| Should the story panel's Actions menu join the tray, or keep saving at once on the local preview? | Join the tray, so every board edit has one diff and one save. |
| Does Bring forward move the whole chain of unfinished prerequisites, or only the direct one? | The whole chain that would still be later, listed before it is added. |
| Where is a hosted proposal's diff worked out? | Decide after measuring `board.js` with the edit engine (see Architecture decisions). |
| Is ESM-216, renumbering titles, a could-have? | Yes, and it can move to a later release without affecting the rest. |
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
| ESM-209 Add, rename and move releases from the command line | not agreed |
| ESM-210 Warn when a move puts a prerequisite in a later release | not agreed |
| ESM-211 Collect board edits and review their Git diff before saving | not agreed |
| ESM-212 Create a release slice and set its outcome on the board | not agreed |
| ESM-213 Move a release row up or down on the board | not agreed |
| ESM-214 Move several stories to another release on the board | not agreed |
| ESM-215 Bring a prerequisite forward from a move warning | not agreed |
| ESM-216 Offer to renumber release titles after a move | not agreed |
| ESM-217 Compare the current and proposed release order | not agreed |
| ESM-218 Share a proposal as a private link | not agreed |
| ESM-219 Open a draft pull request from the board | not agreed |
| ESM-220 Propose slice changes from the hosted board without a checkout | not agreed |
| ESM-221, ESM-222, ESM-223 (Icebox) | not sized |
| **Total** | not agreed |

ESM-216 can move to a later release on its own. ESM-209 and ESM-210 are useful to agents before any board work, so they could ship first in a smaller release if 0.9.0 is too large.

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
