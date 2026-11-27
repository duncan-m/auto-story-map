# Plan: turn agent rules into checks

Status: proposed. The work is split across three releases of the map: ESM-175, ESM-159 and ESM-160 in **0.7.7: Delivery plans and test tags**, ESM-162, ESM-163 and ESM-164 in **0.8.0: Map versions, steps and audit**, and ESM-161 and ESM-165 in **0.8.5: Mockup and claim checks**. None has an agreed estimate yet.

Most of what keeps agent work on this map correct is written in `AGENTS.md`: about 20 rules, read in every session. Some are already enforced by code, such as the branch name check and the story IDs in test names. The rest depend on an agent reading the rule and following it, and on a reviewer noticing when it did not. Two kinds of drift show what that costs:

- **A workaround written as a rule.** `AGENTS.md` tells agents not to let `story-map add` choose an ID, because its next number follows ESM-912. The tool does the wrong thing, and the rule patches over it in every session.
- **Prose that goes stale.** Plan status lines are written by hand. Today [edit-personas.md](edit-personas.md) says "in progress" while ESM-147 has shipped, and [effort-estimates.md](effort-estimates.md) names a release title, "0.7.6: PM improvements", that no longer exists, and says it waits for ESM-741, which shipped in 0.7.2.

The approach comes from Lauren Tan's talk *All Code Is Slop (Except Mine)*, on keeping quality up while agents write most of the code. Her rule is that every correction to an agent becomes a deterministic check, or a change to the API that makes the mistake impossible, rather than another line of prose. Prose is kept for what needs judgement. Each item below removes or shortens a rule in `AGENTS.md`, and the host template where it has the same rule, once its check lands.

Items are numbered in the order they should be built:

1. [Choose the lowest free story ID in add](#1-choose-the-lowest-free-story-id-in-add) (ESM-175)
2. [Give each issue a rule and a link](#2-give-each-issue-a-rule-and-a-link) (ESM-159)
3. [Check plan status lines against the map](#3-check-plan-status-lines-against-the-map) (ESM-160)
4. [Check plan mockups](#4-check-plan-mockups) (ESM-161)
5. [Show the changes only a person should make](#5-show-the-changes-only-a-person-should-make) (ESM-162)
6. [Check pull requests in CI](#6-check-pull-requests-in-ci) (ESM-163)
7. [Property-test the audience filter and edit safeguards](#7-property-test-the-audience-filter-and-edit-safeguards) (ESM-164)
8. [Model-test concurrent claims](#8-model-test-concurrent-claims) (ESM-165)

ESM-175 is the quickest win and depends on nothing. ESM-159 comes before the new checks so they carry rule IDs from the start. ESM-163 needs ESM-162. ESM-164 and ESM-165 are tests only and can be built at any point.

Most of this plan helps build auto-story-map itself, because agents build every later release in this repository, and each check protects all the work after it. So the stories that do that most are pulled into the next two releases, built before the rest of each, as [decision D](#decisions-to-make) explains.

## Her suggestions and what we do today

| Her suggestion | What we do today | Gap | In this plan |
| --- | --- | --- | --- |
| Fix the mistake in the code or the API first | `edit` has no delete and no way to remove `draft` or set an estimate, and refuses customer copy without `--customer`. `claim` exits 3 when someone holds the story | `add` picks the wrong next ID here, so a rule works around it | ESM-175 |
| Turn every correction into a lint rule or check | `validate` checks the schema, references, customer copy, sources, story IDs in plans and test names. `pr-naming.yml` checks branch names and titles. The JSON Schema checks the map in the editor | About seven `AGENTS.md` rules have no check: see [the rules table](#agentsmd-rules-and-what-enforces-them) | ESM-160 to ESM-163 |
| Ban what takes nuance to use well | Nothing banned. `updatedBy` and hand edits to the YAML rely on judgement | Some of this is real judgement and stays prose | [Not now](#not-now) |
| Error messages that point to the root cause | Some messages say what to do, such as "Confirm the drafted job… and remove draft: true" | No stable rule ID and no link to the guide, so an agent reads 1,100 lines to find the rule | ESM-159 |
| Comments and Markdown become escape hatches, or over-rotate on one correction | The ESM-912 workaround in `AGENTS.md`. Hand-written plan status lines | Two plans disagree with the map today | ESM-175, ESM-160 |
| The codebase is a garden: agents copy what is there | Warnings for blocked or cut stories with no reason, releases with no impact, stories with no jobs, and stalled stories | Stale plans are the main weed, and nothing reports them | ESM-160. Wider hygiene is in [Not now](#not-now) |
| A feature map gives agents shared vocabulary for runtime verification | The map is a user's-eye view of the product. JSON export for agents (ESM-706), briefs (ESM-123) | No link from a story to where it lives in the UI | [Not now](#not-now): a separate plan |
| Review verification artifacts instead of the diff | Mockups in `sources`, tests (ESM-801), Changes (ESM-121) and evidence (ESM-105) on the story panel | The panel shows intent and tests, but not the result: a screenshot or recording of what was built | [Not now](#not-now): a separate plan |
| Custom CLIs inside skills cut tokens | The CLI and its JSON formats. The skill (ESM-117) and MCP server (ESM-116) are planned | None. Shorter `AGENTS.md` rules make the skill shorter too | Builds on |
| Formal verification of the main flows | None | Claims are a concurrency protocol with no model | ESM-165, as a first step |
| Property-based testing | fast-check for the heading scanners (ESM-610) | The audience filter, edit safeguards and diff have only example tests | ESM-164 |
| Statecharts to review behaviour | The status lifecycle is prose in the guide | Small | [Not now](#not-now) |
| Most tokens go to verification | Tokens recorded per story (ESM-145) | Not split by building and verifying | [Not now](#not-now) |
| Let agents merge their own PRs once nothing is left to review | A person reviews every PR, with the map diff in the job summary (ESM-304) | No way to tell a safe map change from one a person must see | ESM-162 and ESM-163 make the gate possible. Auto-merge itself is not proposed |
| Measure quality beside volume, such as the revert rate | Delivery metrics are planned for 0.8.2 and 0.8.3, with no reverts | No quality counterweight to throughput | [Not now](#not-now): belongs in the delivery metrics plan |
| Drive-by contributors with little context | Briefs (ESM-123, ESM-125) and the first-run workflow | None | No change |

## AGENTS.md rules and what enforces them

| Rule | Enforced today by | After this plan |
| --- | --- | --- |
| New IDs take the lowest free number from ESM-123 | Nothing. `add` picks the wrong number | `add` with `settings.storyIds` (ESM-175). The sentence is deleted |
| Never remove `draft` yourself | `edit` has no way to. Hand edits are not checked | `pr-check` fails an agent's PR that confirms a draft (ESM-162, ESM-163) |
| Set an estimate only when the team agreed it | `edit` has no estimate option. Hand edits are not checked | Same as above |
| Never delete a story, set `blocked` or `cut` | `edit` has no delete. Hand edits are not checked | Same as above |
| Never renumber a story | Nothing | Same as above, where a removed and an added story share a title |
| Customer copy only when approved | `edit` needs `--customer`. `diff` lists customer-facing changes first | Listed under **Needs a person** (ESM-162). Whether it is approved stays judgement |
| A plan's status line matches the map | Nothing. A habit of the plans, not a rule | `validate --plans` warns (ESM-160) |
| UI plans include an HTML mockup and a PNG, linked from the stories' `sources` | `--check-sources` checks that the links resolve | `validate --plans` checks the section and its files (ESM-161) |
| Record tokens in the PR that marks a story merged | Nothing | `pr-check` checks the PR body (ESM-163) |
| Test names start with the story ID | `validate --tests` | No change |
| Branch names and PR titles are descriptive | `pr-naming.yml` | No change |
| Claim a story before you start | `claim` exits 3 | No change. ESM-165 tests it |
| Blocked and cut stories say why | A `validate` warning | No change |
| Tag stories with the jobs they serve | A `validate` warning | No change |
| Run validate and paste the diff summary | CI runs both | No change |
| Prefer `edit` and `add` to hand edits | Nothing | Stays prose. Once ESM-163 checks the outcome, how the edit was made matters less |
| Set `updatedBy` only on someone else's behalf | Nothing | Stays prose: it is judgement |

## What it builds on

Shipped:

- **ESM-401**, [Warn about map problems without failing CI](../story-map.md#validate-a-change): the warning severity the new plan checks use.
- **ESM-303** and **ESM-742**: validation problems as GitHub annotations and as JSON. ESM-159 adds a rule and a link to both.
- **ESM-304**, [Summarise map changes in pull requests](../story-map.md#review-a-map-change): the diff that ESM-162 extends. It already reports confirmed drafts and estimate changes in its JSON.
- **ESM-744**, [Propose map edits from the command line](../story-map.md#change-the-map-from-the-command-line): `add` and the edit safeguards that ESM-175 and ESM-164 build on.
- **ESM-307**, [Show status history from Git](../story-map.md#show-status-history): its `--bot-names` option, which ESM-163 reuses to tell agent commits apart.
- **ESM-145**, [Record the tokens used on a story](../story-map.md#record-the-tokens-used-on-a-story): the **Tokens used** section ESM-163 checks for.
- **ESM-106**, [Coordinate several agents](../story-map.md#coordinate-several-agents): the claims that ESM-165 tests.
- **ESM-103**: the internal and customer views that ESM-164 tests.
- **ESM-610**: the first property-based tests, in `test/references.property.test.js`, whose style ESM-164 follows.

Planned, and overlapping:

- **ESM-148** and **ESM-151**, [Write a delivery plan](host-planning-guidance.md#1-write-a-delivery-plan-section-in-the-guide) and [Scaffold a plan from the map](host-planning-guidance.md#5-scaffold-a-plan-from-the-map): they document the status line for hosts and write it. ESM-160 now comes first and defines the format, so ESM-148 depends on it and documents what it checks, and the scaffold's output must pass it.
- **ESM-110**, [Confirm drafts from the command line](local-triage.md): the way a person confirms a draft. ESM-163 does not block a confirmation a person made.
- **ESM-128**, [Show outstanding actions on an Actions tab](actions-tab.md): lists validate warnings on the board. With ESM-159 each one can link to its section of the guide. No board change is made here.
- **ESM-116** and **ESM-117**, [the MCP server and the skill](0.8.0-agents-and-adoption.md): `validate_map` returns the rule IDs from ESM-159, and every rule this plan turns into a check makes the skill shorter.

## How hosts get these changes

Hosts that install the package get the rule IDs (ESM-159), the **Needs a person** section of the diff (ESM-162) and the fixes the new tests find (ESM-164, ESM-165) when they upgrade. The rest needs a change to the host's own files or settings:

- the story ID policy (ESM-175), a choice in the map's settings
- the plan checks (ESM-160, ESM-161), which run with `--plans`, and on the folder in `settings.plans` without the flag once ESM-153 lands, so a host that has said yes to delivery plans needs no new flag
- the `pr-check` step (ESM-163), in the CI workflow
- the shorter rules, in the `AGENTS.md` section

`init` never changes those files once they exist, so an existing host would keep its old set-up. The [upgrade review](upgrade-review.md) in 0.8.4 offers each of these changes, explains them in plain words and applies the ones the person accepts. Until then, the guide's upgrade section for each release gives the workflow step and the `AGENTS.md` changes to make by hand, and new installs get them from `init`. Each item here adds a "what changes for you" line for its part, as [Explain the changes in plain words](upgrade-review.md#3-explain-the-changes-in-plain-words) requires.

## 1. Choose the lowest free story ID in add

`settings.storyIds: lowest-free` in the map makes `add` take the lowest unused number in the map's main prefix, counting cut stories, instead of one after the highest. Left out, `add` behaves as it does today, so hosts see no change.

- The main prefix is the one most stories use. An `--id` is still accepted and checked as now.
- This repository sets it. ESM-912 and the other 9xx stories stay where they are, because nothing renumbers.
- **Removes from `AGENTS.md`:** the sentences on choosing the number and on ESM-912. What remains is "Never renumber an existing story."

## 2. Give each issue a rule and a link

Every issue from `validate`, and later from `pr-check`, gets a stable `rule`, such as `blocked-without-reason`, and a `help` link to the section of the guide that explains it.

- **Text:** the rule follows the message in brackets, with the link on the next line.
- **GitHub:** the annotation title is the rule, and the message ends with the link.
- **JSON:** each issue gains `rule` and `help`, and the format's `version` stays 1, since the fields are additions.
- Links go to the host's own copy of the guide, or to the guide at the installed version's tag when that copy lacks the heading, as in [host planning guidance](host-planning-guidance.md#2-ask-whether-to-use-delivery-plans).
- A test checks that every rule has a link and that every link's heading exists in `docs/story-map.md`.
- The messages are reviewed so each says what to change, not only what is wrong.

## 3. Check plan status lines against the map

`validate --plans` reads the first `Status:` line of each Markdown file under the folder and warns when it disagrees with the map:

- **Status.** The line starts with the map's words, `planned`, `in progress`, `merged` or `shipped`, or with `proposed` for a plan not yet agreed. The check warns when the line is behind every story it names, such as `in progress` when all of them are merged or shipped, or `proposed` when any has shipped. It does not warn when the line is ahead, since a plan can be agreed before the map changes.
- **Other words.** Words such as `built` or `done` are reported once per plan, so the plan can be reworded.
- **Release.** The release title in bold must be the title in the map of the release that holds the stories.
- **Files without a status line** are skipped, so notes and retros under the folder are not reported.

The plans in this repository that use other words, are behind the map, or name a release that has moved are fixed in the same PR. The line keeps its free text after the first sentence, for notes such as "Its estimate is agreed: 8 points."

## 4. Check plan mockups

For each plan under `--plans` with a `## UI mockup` section:

- The section links an `.html` file and embeds a `.png` file, and both exist.
- At least one story in the map lists the section, `plan.md#ui-mockup`, in its `sources`.

Whether a plan changes UI, and so needs a mockup, is judgement and stays in `AGENTS.md`. This item checks the mockup once it is there.

## 5. Show the changes only a person should make

`story-map diff` gains a **Needs a person** section after **Customer-facing changes**, and a `needsPerson` list in its JSON, for the changes `AGENTS.md` keeps for people:

- drafts confirmed, for impact items, jobs and persona context
- estimates set, changed or removed
- stories removed rather than cut, and a removed story whose title matches an added one, shown as a possible renumber
- customer copy added or changed, and visibility switched to `all-users`
- map settings changed

The section is empty for most PRs. It lists the change and the story, with no judgement about who made it. That is the next item.

## 6. Check pull requests in CI

`story-map pr-check <base-ref>` fails a pull request that breaks the map rules a check can see:

- **Needs a person.** When any commit in the range that changes the map was written with an agent, every item under **Needs a person** is an error, unless `--approved` is passed. A commit counts as an agent's when its author is in `--bot-names` or it has a `Co-Authored-By` trailer naming a known agent, such as Claude or Codex. See [decision B](#decisions-to-make).
- **Tokens used.** With `--body-file`, for each story that moves to `merged`, the PR body has a **Tokens used** section that names the story, or says why the tokens could not be counted.
- Problems are reported in the same formats as `validate`, with the rules from ESM-159.

This repository's CI runs it on every PR, passing the PR body and `--approved` when a person has added the `map-approved` label. The workflow from `story-map init` gains the same step, since the host `AGENTS.md` template has the same draft, estimate and token rules.

This is a guardrail for agents that follow their own attribution rules, not a security boundary: an agent can leave out the trailer, and a person still reviews the PR. What it removes is the need to read the YAML diff for these changes.

**Shortens in `AGENTS.md`:** the draft, estimate and token paragraphs keep the rule in a sentence each and say that CI checks it. The how-to stays in the guide.

## 7. Property-test the audience filter and edit safeguards

fast-check tests with maps generated from the schema, following `test/references.property.test.js`. Each test name starts with `ESM-164:`.

- **The customer view never shows internal work.** For any map, the customer page and its JSON contain no story, activity, release, persona or job that lacks approved customer copy, and no internal title or ID. This is the one bug here that would reach customers.
- **Edits keep what they should.** `edit` and `add` change only the stories named, keep every ID, never remove `draft`, and keep the YAML comments.
- **The diff is exact.** Comparing a map with itself finds nothing, and comparing two maps lists every story that differs.

CI runs the default number of cases. `FC_NUM_RUNS` runs more locally, as today.

## 8. Model-test concurrent claims

A model-based fast-check test runs random sequences of `claim`, `renew`, `take-over`, `unclaim` and expiry by several agents against a real temporary Git remote, and against `--store`, and compares the result with a simple model after each step:

- at most one live claim per story
- only the holder renews or releases a claim, unless it has expired or is taken over
- a claim on a held story exits 3 and names the holder

fast-check's scheduler interleaves the calls, so two agents claiming at once are tested too. If it finds a race, or the protocol grows, a TLA+ model is the next step. Test names start with `ESM-165:`.

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. Fix `add` for everyone, or behind a setting | A setting, `settings.storyIds: lowest-free`. Changing the default would change the IDs that hosts' agents choose with no warning. Lowest-free fills gaps, which some teams leave on purpose |
| B. How CI tells agent commits from a person's | `--bot-names`, as in history, plus `Co-Authored-By` trailers naming known agents. Most agent commits here are authored as a person, with a trailer, so the author alone misses them. A label from a person overrides. The alternative, failing every PR with a **Needs a person** change until it is labelled, is simpler but noisy |
| C. Warning or error for a stale plan status | A warning. A stale plan misleads, but should not block an unrelated PR |
| D. The releases | Three, by how much each story helps build the releases after it. **0.7.7:** ESM-175 first, since every session reads its workaround. ESM-159 before more checks and tools are built on validation messages. The Actions tab, MCP server and skill (ESM-128, ESM-116, ESM-117) shipped in 0.7.6 without rule IDs, so ESM-159 adds them there too. ESM-160, because plan status lines are being fixed by hand as releases are replanned. **0.8.0:** ESM-162 to ESM-164 first, to guard the draft confirmation and local editing from 0.7.6 and the Version picker in 0.8.0. ESM-162 shares diff code with ESM-114. **0.8.5:** ESM-161 and ESM-165, which help least now. This adds three unestimated stories to each of 0.7.7 and 0.8.0, so the team should size them before agreeing |
| E. Whether `init` adds `pr-check` to hosts' workflows | Yes, since the host template has the same rules. A host that has not adopted token recording sees no token errors, because the check only runs with `--body-file` |

## Not now

- **The story map as a feature map, with verification results on each story.** Her runtime verification depends on a feature map, which a story map already is. A story could say where it lives in the UI, so a verification agent can find it, and the panel could show a screenshot or recording of what was built beside the mockup of what was intended. This would change review from reading the diff to comparing intent with result on the story. It changes the board, so it needs its own plan and mockup. It is the next plan to write.
- **A formatting check for hand edits.** Once ESM-163 checks the outcome, how a change was made matters less, and a formatting check would fail correct hand edits.
- **Checking `updatedBy` and approval of customer copy.** Both are judgement about who a change is for. ESM-162 shows customer copy changes to a person, which is what can be checked.
- **A wider hygiene report**, such as planned stories with no sources, or sources that point to cut work. The Actions tab (ESM-128) is where such warnings would surface. Worth revisiting once it ships and ESM-160 shows how noisy plan checks are.
- **The revert rate as a quality metric.** It belongs beside throughput in the [delivery metrics plan](delivery-metrics.md), for 0.8.3, rather than here.
- **Splitting tokens by building and verifying.** Interesting, but nothing would act on it yet.
- **A statechart of the status lifecycle.** Small, and better done with the guide's next rewrite of [Merged and shipped](../story-map.md#merged-and-shipped).
- **Banning comments, as she does.** The written docs here are part of the product: the schema field descriptions and the guide.
- **Auto-merging map PRs.** ESM-162 and ESM-163 make it possible to tell a safe map change apart, but a person reviews every PR today, and nothing here changes that.

## Effort and release fit

| Story | Release | Points |
| --- | --- | --- |
| ESM-175: Choose the lowest free story ID in add | 0.7.7 | not agreed |
| ESM-159: Give each validation issue a rule and a link to the guide | 0.7.7 | not agreed |
| ESM-160: Warn when a plan's status line disagrees with the map | 0.7.7 | not agreed |
| ESM-162: Show the map changes only a person should make | 0.8.0 | not agreed |
| ESM-163: Check pull requests for map rules in CI | 0.8.0 | not agreed |
| ESM-164: Property-test the audience filter and edit safeguards | 0.8.0 | not agreed |
| ESM-161: Check plan mockups and their links | 0.8.5 | not agreed |
| ESM-165: Model-test concurrent story claims | 0.8.5 | not agreed |
| **Total** | | **not agreed** |

None of these has an agreed estimate. Validation warns about each one in 0.7.7 and 0.8.0, because the other stories there have estimates, so the release totals leave them out until they are sized. The team should size them in review. ESM-163 is the largest: a new command, commit trailer reading, PR body checks and two workflows. ESM-175 and ESM-161 are the smallest. ESM-159 touches every validation message but changes none of the checks.
