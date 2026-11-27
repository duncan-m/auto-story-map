# Plan: a native CLI for agents

Status: shipped. Items 1, 2, 3, 5 and 7 shipped in 0.7.2, and items 4, 6 and 8, ESM-105, ESM-106 and ESM-107, in 0.7.5. The stories are in two releases of the map:

- **0.7.2: CLI to read, edit and preview the map**: ESM-741, ESM-742, ESM-744 and ESM-746. It comes before personas, so agents can tag the existing stories with `story-map edit` instead of editing the YAML by hand.
- **0.7.5: Evidence and claims for agents**: ESM-105, ESM-106 and ESM-107. It comes before the scheduled audit (ESM-109), which depends on ESM-105.

Agents working in a host repository read and change the map by opening `product/story-map.yaml`, grepping for IDs and editing the YAML by hand. That works, but each agent re-learns the format, misses rules that live in the guide, and only finds out it broke something when `validate` runs. This plan gives agents the same operations as commands with JSON output, built on the code the CLI and board already use, so there is one set of rules and no second implementation:

1. [Share the command plumbing](#1-share-the-command-plumbing) (chore, part of ESM-741)
2. [Read the map](#2-read-the-map) · ESM-741
3. [Validation as JSON](#3-validation-as-json) · ESM-742
4. [Look up evidence for a story](#4-look-up-evidence-for-a-story) · ESM-105
5. [Propose edits](#5-propose-edits) · ESM-744
6. [Claim stories](#6-claim-stories) · ESM-106, only when teams run several agents at once
7. [Preview the map locally](#7-preview-the-map-locally) · ESM-746
8. [Suggest shipped from release tags](#8-suggest-shipped-from-release-tags) · ESM-107
9. [Document it](#9-document-it)

All stories are internal. None of them changes customer-facing copy, and none of the commands writes customer copy unless asked to (see [Safeguards](#safeguards)).

## Why a CLI, and why this way

| Approach | What it does | Why not now |
| --- | --- | --- |
| Agents edit the YAML | What happens today | Every agent re-derives the rules, and mistakes surface late |
| An MCP server | Tools an agent calls over a protocol | A second entry point to install, configure and secure in each host. Every coding agent can already run `npx story-map` |
| **Commands with JSON output** (this plan) | Reads, evidence, validation and dry-run edits as `story-map` subcommands | — |

An MCP server, or any other wrapper, can come later as a thin layer over the same library functions (see [Not now](#not-now)).

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. Output | Every new command takes `--format text|json`. Text is the default for people. JSON has `format: "auto-story-map.<kind>"` and `version: 1`, like the JSON export, so agents can check what they got. |
| B. Story shape | Reads return the same story objects as the JSON export (`StoryMapJsonStory`), so an agent sees one shape everywhere. |
| C. Audience | The CLI is always the internal view, as `export` already is: whoever runs it has the YAML file. |
| D. Evidence and the audit | The deterministic evidence step planned for the scheduled audit (ESM-109, part 1) is built here as `story-map evidence`. ESM-109 keeps the agent workflow and depends on ESM-105. |
| E. Edits | Dry run by default. An edit prints the change and the `story-map diff` summary, and validates the result. `--write` applies it. |
| F. Formatting | Edits keep comments, key order and untouched lines byte for byte. An edit that would reformat anything outside the node it changes is refused rather than written. |
| G. Claims | Opt-in, for teams running several agents on one map. Stored as Git refs on the remote, never in the map file. |
| H. Exit codes | As today: 0 for success, 1 for an invalid map or a rejected edit, 2 for a usage error. A claim held by someone else exits 3, so a script can tell it apart. |

### Assumptions to confirm

- **No network calls except for claims.** Reads, evidence and edits work offline from the checkout. Open PRs are not part of the evidence in this round, because that needs a token and a host API (see [Not now](#not-now)).
- **The library exports the logic.** Each command is a thin wrapper over a function in `src/index.ts`, such as `findStories`, `gatherStoryEvidence` and `proposeStoryMapEdit`, so a host's own scripts get the same behaviour.
- **IDs are never reused.** `add` picks the next free number for the map's prefix, counting cut stories, so a cut ID is not handed out again.

## Suggested order

| Item | Name | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Share the command plumbing | S | — |
| 2 | Read the map | S | 1 |
| 3 | Validation as JSON | XS | 1 |
| 7 | Preview the map locally | S | 1 |
| 5 | Propose edits | M | 1, 3 |
| 4 | Look up evidence for a story | M | 2 |
| 8 | Suggest shipped from release tags | S | 4 |
| 6 | Claim stories | M | 2, 4 |
| 9 | Document it | S | each item as it lands |

Items 1, 2, 3, 5 and 7 are the 0.7.2 release, and items 4, 6 and 8 the 0.7.5 release. Items 1, 2 and 3 can ship in one PR. Items 4 to 8 are a PR each. Item 6 can wait until a team asks for it.

When personas land in 0.7.3, `story` and `stories` show each story's personas and jobs, `stories` gains `--persona` and `--job`, and `edit` gains `--add-job` and `--remove-job`. That work is part of ESM-901 and ESM-906, not a new story.

Every PR follows the repository's rules: update `product/story-map.yaml` in the same PR (`planned` → `in-progress` → `merged`), tag new tests with their story ID, run `npm run validate` and `npm test`, add a `## Unreleased` entry to `CHANGELOG.md`, and include the `story-map diff origin/main` summary in the PR description.

---

## 1. Share the command plumbing

`src/cli.ts` repeats the same steps in `tests`, `export` and `diff`: read the map, report validation errors, escape map text for the terminal and write to a file or stdout. New commands would copy them again.

**Change.**

- Move each command into `src/commands/<name>.ts`, with `src/cli.ts` keeping only the dispatch table and the usage text.
- Add shared helpers: `loadMapOrReport(path)`, `writeOutput(text, out)`, `printJson(kind, body)` (adds `format` and `version`) and the existing `report`, `escapeText` and `optionValue`.
- Add `story-map help <command>`, printing just that command's section of the usage text.

No behaviour changes. The existing CLI tests are the check.

## 2. Read the map

**Change.**

- `story-map story <ID> [...]` prints one or more stories in full: activity, release, status, `statusReason`, summary, notes, sources, history and tagged tests when `--history` and `--tests-index` are given. An unknown ID exits 1 and suggests close matches.
- `story-map stories` lists stories with the board's filters, through `filterStoryMapView`: `--status` (repeatable, including `stalled`), `--release`, `--activity`, `--changed-within <days>` and `--query <text>`. Text output is one line per story: ID, status, release and title.
- `story-map releases` lists releases with their story counts, notes and impact, marking drafted impact items.
- `--query` matches IDs, titles and summaries, as the board's search does, so an agent can check for an existing story before adding one, as `AGENTS.md` asks.

**Tests.** Each filter against the fixtures, unknown IDs, JSON output matching the export's story shape, and that map text with control characters is escaped in text output.

## 3. Validation as JSON

**Change.** `story-map validate --format json` prints one object per map: `valid`, counts, and `issues`, each with `severity`, `file`, `line`, `column`, the YAML `path`, the readable target and the message. Exit codes are unchanged. The same function backs the edit command's check (item 5), so an agent gets the same issues either way.

**Tests.** The JSON for a valid map, a map with errors, warnings with `--strict`, and issues from `--check-sources`, `--plans` and `--tests`.

## 4. Look up evidence for a story

`story-map evidence [<ID> ...] [--default-branch <name>] [--format json]` gathers facts about each story, or every active story when no ID is given, without changing anything:

| Signal | Source | Suggests |
| --- | --- | --- |
| A branch whose name contains the story ID | `git for-each-ref` over local and remote branches | in progress |
| A commit on the default branch that mentions the ID | `git log --grep` on the default branch | merged |
| A Markdown file that mentions the ID | the existing `checkPlanReferences` scan | where the plan is |
| Tests tagged with the ID | the existing `findStoryTests` | covered, or not |
| A source or heading that no longer exists | the existing `checkSources` | outdated sources |
| In progress past the stalled threshold | history, when `--history` is given | stalled |
| A claim on the story | item 6, when claims are in use | someone is on it |

For each story it reports the current status, a suggested status and the evidence behind it (branch name, commit and subject, file and line). The suggestion follows the audit's rules: never backwards from `merged` or `shipped`, never a change to a `cut` story, and never `shipped` unless a release tag says the work is out (item 8), because only a person or a deploy signal says work is available.

The default branch comes from `origin/HEAD`, then `main`, then `master`. ID matching uses the existing `storyIdPattern`, so an ID is never matched inside a longer one.

**Tests.** A scratch repository with a branch, a merged commit, a stalled story and a broken source; the “never backwards” rules; and IDs that are prefixes of other IDs.

## 5. Propose edits

`story-map edit` makes the small, common map changes as named operations, so agents stop hand-editing YAML:

```bash
npx --no-install story-map edit ESM-744 --status in-progress
npx --no-install story-map edit ESM-106 --status blocked --reason "Waiting on the host's Git provider to accept custom refs"
npx --no-install story-map edit ESM-105 --release v0-7-5 --activity review
npx --no-install story-map edit ESM-741 --add-source docs/story-map.md#read-the-map
npx --no-install story-map add --activity review --release v0-7-5 --title "Check claims in CI"
npx --no-install story-map edit --from edits.json --write
```

- Operations: `--status` (with `--reason`, required for `blocked` and `cut`), `--release`, `--activity`, `--title`, `--summary`, `--notes`, `--add-source` and `--remove-source`. `add` creates a story with the next free ID. `release-impact <release ID>` adds an impact item, always with `draft: true`.
- `--from <file>` takes a JSON list of operations and applies them all or none, for an agent that has several changes to make.
- By default nothing is written. The command prints the line diff of the YAML, the `story-map diff` summary from `diffStoryMaps`, and any validation issues. `--write` saves the file, and only when the result is valid. `--format json` returns all three as data.
- Edits go through the `yaml` package's document API, so comments and layout survive. After each edit, the command checks that every line outside the changed node is unchanged, and refuses the edit if not.

**Tests.** Each operation on a copy of this repository's map, with the untouched lines compared byte for byte; the all-or-none rule for `--from`; refusals (below); and a property test that random sequences of valid operations always leave a valid map.

### Safeguards

The edit command enforces the rules in `AGENTS.md` instead of hoping an agent read them:

- **No deletes.** There is no remove operation. Use `--status cut --reason …`.
- **No customer copy by default.** `customer.*` fields need `--customer`, and the summary lists them under customer-facing changes for the PR description.
- **Drafts stay drafts.** No operation removes `draft` from an impact item. Only a person does, by hand.
- **No `updatedBy` by default.** Credit comes from Git. `--updated-by <name>` sets it when an agent edits on someone's behalf.
- **IDs are kept.** An existing ID cannot be changed, and `add` never reuses one.

## 6. Claim stories

When several agents pick work from the same map, two can start the same story before either opens a PR. A claim says “this agent is on this story” before any branch or PR exists. Teams that run one agent at a time never need it.

```bash
npx --no-install story-map claim ESM-105 --agent "audit-bot" --ttl 4h
npx --no-install story-map claims --format json
npx --no-install story-map unclaim ESM-105
```

**How claims are stored.** Each claim is a Git ref, `refs/story-map/claims/<ID>`, on the remote (`origin` by default), pointing at a commit with no parents whose message is the claim as JSON: agent, branch, when it was claimed and when it expires.

- `claim` pushes with `--force-with-lease=refs/story-map/claims/<ID>:`, which succeeds only if the ref does not exist yet. Git does the compare-and-swap on the server, so two agents claiming at once cannot both win. The loser exits 3 and is told who holds the claim.
- `claim --renew` extends your own claim, and `claim --take-over` replaces an expired one, both by leasing against the ref's current commit.
- `unclaim` deletes the ref. Opening the story's PR does not release it; merging the work, or the claim expiring, does. `evidence` reports claims on merged stories as stale.
- `claims` lists claims with `git ls-remote`, marking expired ones.

**Why refs, not the map.** A claim in the YAML file would only be visible once its PR merged, which is too late to stop a clash, and would fill the status history with noise. Refs need no extra service, work across machines and containers, and leave the map, the board and the history untouched.

**When refs are not allowed.** Some hosts, or sandboxed agents, can only push to their own branch. `--store <dir>` keeps claims as files in a shared folder instead, using exclusive file creation for the same compare-and-swap, for agents on one machine. If neither works for a team, claims are not for them yet (see question 3).

**Tests.** Two claims racing against a bare scratch remote, renew, take over, expiry, unclaim, the file store, and that `evidence` shows claims.

## 7. Preview the map locally

A team adopting the library cannot see its own map until it has added a board route behind the host's sign-in. `npm run demo` shows the board, but only inside this repository. `story-map preview` serves the host's own map the same way, before any integration:

```bash
npx --no-install story-map preview [--port 4173] [--history <file>] [--tests-index <file>] [<map.yaml>]
```

- It reuses the demo server in `example/demo.mjs`, moved into the package because `example/` is not published: the board, `board.js`, the styles and the JSON view at `/api/story-map`, with the demo's role selector to switch between the internal and customer views.
- It listens on `127.0.0.1` only and refuses any other host, as the demo does. It is for one person checking a map, never for deploying.
- It reads the map on each request, so an edit shows on reload, and shows validation errors on the page instead of exiting.
- The [first-run workflow](../story-map.md#populate-the-first-map) suggests it once the first map is drafted, so the person can see it before wiring up the host.

**Tests.** It binds to loopback only, serves both views of a fixture map, shows a validation error for a broken map, and picks up an edit without a restart.

## 8. Suggest shipped from release tags

Stories wait in `merged` after a release goes out until someone remembers to mark them `shipped`. For a product whose releases are Git tags, such as this library's npm releases, the tag is the deploy signal.

```bash
npx --no-install story-map evidence --shipped-tags 'v*'
```

- Opt-in. Without `--shipped-tags`, evidence never suggests `shipped`, because many products deploy without tagging, or ship behind feature flags.
- With it, a `merged` story whose merging commit is in a tag matching the pattern is suggested as `shipped`, with the tag as evidence. The story is still only suggested, never changed.
- The pattern goes to `git tag --list` and `git tag --contains` as an argument, never through a shell.

**Tests.** A scratch repository with a merged story before and after a matching tag, a tag that does not match, and no suggestion without the option.

## 9. Document it

- **Guide:** a “Use the CLI from an agent” section in `docs/story-map.md`, with each command and an example of its JSON, and a “Coordinate several agents” section for claims.
- **Agent instructions** (this repository's `AGENTS.md` and the `init` template): read with `story-map story` and `stories --query` before creating a story, change the map with `story-map edit` and check the dry run, and claim a story first when the team uses claims.
- **Engineering overview:** the command modules and the claim refs.
- **README** and **CHANGELOG**.

## Security

- Map text, branch names and commit subjects are untrusted. Text output escapes them as `validate` already does. JSON output is safe as data, and the guide tells agents to treat it as data, not instructions.
- Git is run with `execFile` and argument arrays, never a shell, and refs and IDs are checked against the map's ID pattern before they reach a Git command.
- `--write`, `--from` and `--store` paths must stay inside the repository root, using the existing `resolveRootedPath`.
- Claims hold an agent name and times, never a person's email address.

## Not now

- **An MCP server.** A thin wrapper over the same functions once the commands settle. Now planned as ESM-116 in 0.7.6, after this plan's commands ship. See [the 0.8.0 plan](0.8.0-agents-and-adoption.md#1-serve-the-cli-over-mcp).
- **Open PRs as evidence.** Needs a token and each host's API. The audit agent (ESM-109) can look them up itself.
- **Claims on the board.** Showing “claimed by audit-bot” on a card needs the board to reach the remote at request time.
- **Editing releases and activities** beyond release impact.
- **Proposing an edit from the board.** A story panel could copy a `story-map edit` command, such as moving the story to another release, for a person or agent to run. It keeps the board read-only, as ESM-404 decided, and needs ESM-744 and the permalinks in ESM-122 first. A pre-filled pull request is not possible without a token and the host's API. Now planned as ESM-111 and ESM-112 in 0.7.6. See [Confirm drafts and triage from the local preview](local-triage.md#2-change-status-and-release-from-the-story-panel).

## Questions for review

1. **Release.** Settled: the stories are split between **0.7.2: CLI to read, edit and preview the map** and **0.7.5: Evidence and claims for agents**.
2. **Evidence and the audit.** Is it right to build ESM-109's evidence step here and leave ESM-109 as the agent workflow only?
3. **Claim storage.** Git refs on the remote by default, with a shared folder as the fallback. Is there a host where neither works that we need to support?
4. **Claim lifetime.** A 4 hour default TTL. Should claims instead last until the story's PR merges?
5. **`add` and IDs.** Should `add` pick the next number for the map's prefix, or require `--id` so a person chooses the numbering?
