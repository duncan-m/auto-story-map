# Plan: code review, architecture decisions and review points

Status: proposed. The work is ESM-176 to ESM-179 and ESM-182 to ESM-187 in the **0.7.11: Code review and architecture checks** release of the map. None has an agreed estimate yet.

Agents write almost every change in this repository, and nobody else reads most of them before they merge. Of the last 30 merged PRs, none had an independent review. CodeQL is the only reviewer, and it runs after the push: it found escaping or sanitising problems in #162, #169, #178 and #179, and ReDoS in #169 and #186. One of those alerts, in `fileSlug` in `src/export-response.ts`, shipped to hosts in 0.7.6 and is being fixed as ESM-175. Nothing asks whether a change kept the promise of its story, which saved input it could break, or whether it made an architecture decision that nobody recorded. The plans in `docs/plans/` say what to build, but none of the 5 open ones says where it runs, who consumes it, or how to undo it.

This plan adds review in layers. Cheap deterministic checks come first: lint, a coverage floor, CodeQL's quality queries and one shared escape helper. Then a review step that starts from the story, piloted on ten PRs. Then architecture decisions in plans, with a check, and guidance on when to review the architecture and refactor. Last, once the pilot shows it works, the review step and architecture decisions are offered to hosts. It follows the rule from [Turn agent rules into checks](rules-as-checks.md): a correction becomes a check or an API change, and prose is kept for what needs judgement.

Items are numbered by topic. The [build order](#build-order) differs:

1. [Lint the code with Biome in CI](#1-lint-the-code-with-biome-in-ci) (ESM-176)
2. [Measure test coverage with a floor](#2-measure-test-coverage-with-a-floor) (ESM-177)
3. [Run CodeQL's quality queries](#3-run-codeqls-quality-queries) (ESM-178)
4. [Review against the story first, then the repo checklist](#4-review-against-the-story-first-then-the-repo-checklist) (ESM-179)
5. [Review each PR's diff before it is ready, and pilot the step](#5-review-each-prs-diff-before-it-is-ready-and-pilot-the-step) (ESM-182)
6. [Record architecture decisions in plans and PRs](#6-record-architecture-decisions-in-plans-and-prs) (ESM-183)
7. [Check the architecture section in plans](#7-check-the-architecture-section-in-plans) (ESM-184)
8. [Say when to review the architecture and refactor](#8-say-when-to-review-the-architecture-and-refactor) (ESM-185)
9. [Offer the review step and architecture decisions to hosts](#9-offer-the-review-step-and-architecture-decisions-to-hosts) (ESM-186)
10. [Share one regular-expression escape helper](#10-share-one-regular-expression-escape-helper) (ESM-187)

ESM-180 and ESM-181 were already taken, so the IDs skip them. ESM-175, the ReDoS fix, is its own story in 0.7.9 and the first PR in the pilot.

## Where we are today

From a check against `main` at `575aa60`:

| Area | Today | Gap | In this plan |
| --- | --- | --- | --- |
| Independent review | 0 of the last 30 merged PRs. A person merges each one | Nobody but the author reads most diffs before they merge | ESM-179, ESM-182 |
| Static analysis | CodeQL's default security queries, after the push. 5 of the last 30 merged PRs had findings: escaping or sanitising in #162, #169, #178 and #179, ReDoS in #169 and #186 | Findings arrive after the PR is open, and quality queries are off | ESM-178, ESM-182 |
| Lint | None. `tsc` checks types | No check for unused code, suspicious patterns or complexity | ESM-176 |
| Coverage | Not measured in CI. A local run gives 94.29% of lines, 90.73% of branches and 96.08% of functions, with 536 of 536 tests passing. Weakest: `preview.js` 53%, `board.js` 57%, `mcp.js` 70%. The report includes `example/host.mjs` and has no source maps, so it points at `dist/` | No floor, so coverage can fall unnoticed, and the report is hard to act on | ESM-177 |
| Repeated code | `escapeRegExp` is copied in 5 places | A fix to one copy misses the others | ESM-187 |
| Architecture decisions | None of the 5 open plans has an architecture section | Where work runs, who consumes it and how to undo it are not recorded | ESM-183, ESM-184 |
| When to refactor | `src/react.tsx` is 2,967 lines and was changed by 34 stories in the last 300 commits | No rule for when size or churn should prompt a look | ESM-185 |
| Hosts | The host templates have no review or architecture rules. They have the rule markers, the [upgrade review](upgrade-review.md) and `known-versions.json` that would carry them | Hosts get nothing from this until it is offered | ESM-186 |

## 1. Lint the code with Biome in CI

Repository only.

- Biome is a devDependency at an exact version.
- `biome.json` turns on the recommended rules and turns the formatter and assist off, so no file is reformatted. `noExcessiveCognitiveComplexity` is a warning.
- It covers `src/`, `test/`, `scripts/` and `example/`.
- `npm run lint` runs `biome ci`, and CI runs the same script with `--reporter=github`, so findings appear on the PR diff.
- Measure the baseline when this is built. Fix the findings, or turn a rule off in `biome.json` with a reason. No bulk ignore comments.

## 2. Measure test coverage with a floor

Repository only.

- Turn on `sourceMap` in `tsconfig.json`, so the report points at `src/*.ts` rather than `dist/`.
- Exclude `example/` and the generated `version` module.
- Check that a module nothing imports shows up at 0%. If it does not, use `c8 --all` or a test that imports every module.
- The floors are set from the baseline, rounded down, about 94% of lines, 90% of branches and 96% of functions today. They only go up.
- Only the Node 26 cell of the CI matrix runs it. `npm run coverage` runs it locally.

## 3. Run CodeQL's quality queries

Repository only. Add `queries: security-and-quality` to the CodeQL workflow and triage the new alerts: fix them, or dismiss them with a reason. ESM-175 has already cleared the open ReDoS alert.

## 4. Review against the story first, then the repo checklist

A **Review a code change** section in the [engineering overview](../ENGINEERING-OVERVIEW.md), linked from `AGENTS.md`, asks in this order:

1. What did the story promise? Read its summary, `sources` and plan section.
2. What evidence shows it works? Tests named with the story ID, a screenshot, a run of the command.
3. Which existing caller or saved input could break? Maps, plans and `AGENTS.md` files that hosts already have, and every caller of a changed function.
4. Did it make an architecture decision that wasn't recorded? See [item 6](#6-record-architecture-decisions-in-plans-and-prs).
5. Then the repository's own checks, such as escaping, the audience filter and the [security boundaries](../ENGINEERING-OVERVIEW.md#security-boundaries-to-preserve).

A serious defect gets a regression test the first time it is found. A lower-impact problem that recurs gets a lint rule, a test or an API change the second time, as [item 10](#10-share-one-regular-expression-escape-helper) does for escaping.

Until item 6 lands, the review asks questions 1 to 3 and 5 only.

## 5. Review each PR's diff before it is ready, and pilot the step

- Run `/code-review <PR number>`, or review `origin/main...HEAD` before a PR exists. Review again after any material change.
- A **Review** section in the PR template records the target, the commit SHA reviewed, the level, the findings fixed and the findings declined, with a reason for each. A person's review of the same diff also counts.
- An agent that cannot run a review leaves the PR as a draft and says so.
- `pr-check --body-file` warns when a ready PR has an empty Review section, with a rule ID from ESM-159.
- The [pilot](#pilot) covers ten PRs and records the findings before ready, the defects found later, and the time and token cost of each review.

## 6. Record architecture decisions in plans and PRs

Repository first. A `## Architecture decisions` section in a plan answers four questions:

1. **Where it runs:** inside the app, or as its own service, worker or package.
2. **Data and contracts:** the consumers upstream and downstream, such as the map format, the CLI's output formats, the board and hosts' files.
3. **Boundaries:** what the change may touch and what stays out of it.
4. **Reversibility:** how to undo it, including for hosts that have already upgraded.

Routine work answers in one line with a real reason, such as "Inside the CLI, no new consumers: it adds a flag to an existing command." A consequential decision records each affected consumer and the consequence for it, the alternative considered, who agreed it, and what would justify revisiting it. A person agrees it before its stories go `in-progress`.

Work without a plan puts an **Architecture** line in the PR description, which `pr-check` reads. Agreed decisions move into the engineering overview's [Runtime and architecture](../ENGINEERING-OVERVIEW.md#runtime-and-architecture) section, so the overview stays the one place to look.

## 7. Check the architecture section in plans

`validate --plans` reports an open plan with no `## Architecture decisions` section, an empty one, the scaffold's placeholder hints left in it, or a "None:" line with no reason. The rule is `plan-architecture-section`.

It is a **notice** by default, and a **warning** once `settings.architectureDecisions: required` is set. This repository sets it, and the 5 open plans gain the section in the same PR.

## 8. Say when to review the architecture and refactor

The guide names four points to review the architecture:

1. **Planning**, through the section in [item 6](#6-record-architecture-decisions-in-plans-and-prs).
2. **Review**, through question 4 in [item 4](#4-review-against-the-story-first-then-the-repo-checklist).
3. **Release planning**, when a release groups work that shares a module or a contract.
4. **The scheduled audit** (ESM-109), unchanged.

Size and complexity prompt a look, not a refactor. A refactor story needs evidence of its cost from Git and review history, such as how many stories changed a file and how often reviews found problems there. It names that cost, and says how the team will tell that it improved. The first case to assess is `src/react.tsx`: 2,967 lines, changed by 34 stories in the last 300 commits.

## 9. Offer the review step and architecture decisions to hosts

Built after the pilot, and after item 6 has been used on a real change that affects hosts.

- Rule markers `review-before-ready` and `architecture-decisions` in `templates/AGENTS.md`, with matching short rules in `AGENTS-skill.md` and `SKILL.md`.
- Guide sections, the section in the [`story-map plan` scaffold](../story-map.md#scaffold-a-plan), and the example plan.
- Entries in `known-versions.json`, so the [upgrade review](upgrade-review.md) offers both and sets `settings.architectureDecisions`. A changelog entry and an upgrade section in the guide.
- Host tests cover an old host with an edited `AGENTS.md` that upgrades, an open plan under `--strict` without adoption, plans turned off, `init --skill` and a fresh install.

This is the only item that changes what hosts receive.

## 10. Share one regular-expression escape helper

Repository only.

- Export one `escapeRegExp` from an existing shared `src/` module.
- Replace the copies in `src/tokens.ts`, `src/pr-check.ts`, `test/upgrade-overview.test.mjs`, `test/story-map.test.mjs` and `test/cli-edit.test.mjs`. Tests import it from `dist/`.
- Add a property test that escaped text always matches itself literally.
- Behaviour does not change.

It is the first case of the "found twice, fix it in the API" rule in item 4.

## Build order

1. ESM-187, ESM-178, ESM-176 and ESM-177, alongside the pilot in ESM-182, with ESM-179's review asking questions 1 to 3 and 5 only.
2. ESM-183, then question 4 in ESM-179.
3. ESM-184 and ESM-185.
4. ESM-186.

The cheap checks come first because every later PR in the pilot benefits from them. Architecture decisions come before their check, and the hosts item waits for the pilot's results.

## Architecture decisions

This plan's own answers, as a worked example of item 6:

- **Where it runs.** Inside the existing tools: CI workflows, `npm` scripts, and the `validate` and `pr-check` commands. No new service, worker or package. Biome, and any coverage tool item 2 needs, such as c8, are devDependencies, so hosts never install them.
- **Data and contracts.** Upstream, `pr-check` reads the PR description, which gains a **Review** section and an **Architecture** line, and `validate --plans` reads plans, which gain a section. Downstream, the new issues use ESM-159's rule IDs and appear in the text, GitHub and JSON formats without a format version change. `settings.architectureDecisions` is a new optional map setting. Item 9 changes `templates/AGENTS.md`, the skill files and `known-versions.json`, which hosts receive.
- **Boundaries.** Items 1 to 3 and 10 touch only this repository's tooling and code. Items 4 to 8 change this repository's docs, the template for PRs and the two commands. No board change, and no change to the map format beyond the setting.
- **Reversibility.** Items 1 to 3 revert by removing a config file or a line. The check in item 5 is a warning, and the check in item 7 is a notice, which never fails. Item 7 only blocks a PR for a host that has both set `settings.architectureDecisions: required` and runs `validate --strict`, and removing the setting undoes it. Item 9 is the hard one to undo: rule text copied into a host's `AGENTS.md` stays there. That is why it is last, after the pilot. Existing hosts get it only through the upgrade review, when a person accepts it, and new installs get it from `init`.

Consequential decision: offering the review step to hosts (item 9). Consumers: every host that upgrades, through its `AGENTS.md` and settings. Alternative considered: ship it straight away with item 5. Agreed by: not yet, see [decision B](#decisions-to-make). Revisit if the pilot finds that reviews before ready catch little that CodeQL and the tests would not.

## The #179 retrospective

#179 (ESM-168) built regular expressions in `test/upgrade-overview.test.mjs` from text escaped by hand, without escaping backslashes. CodeQL flagged it as incomplete string escaping after the push, and a follow-up commit fixed it.

- **Biome** would probably not have caught it. Its recommended rules check patterns, not whether an escape is complete.
- **CodeQL** caught it, but only after the push.
- **`/code-review` on the PR before ready**, with item 4's questions, would probably have caught it. Question 3 asks which input could break the change, and question 5's escaping check asks whether every metacharacter, backslash included, is escaped.
- **Item 10** removes this kind of bug for regular-expression escaping, because there is one tested helper to call.

## Pilot

Ten PRs run the review step from item 5 before ready. Each row records the review and what happened afterwards.

| # | PR | Story | Reviewed before ready | Findings fixed | Findings declined | Defects found later | Time and tokens | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Not yet open | ESM-175: Keep export file names fast on crafted titles | | | | | | in progress |
| 2 to 10 | | | | | | | | |

After the tenth PR, the team decides whether the step is worth its cost, and so whether item 9 goes ahead.

## What it builds on

Shipped or merged:

- **ESM-159**, [Give each validation issue a rule and a link](rules-as-checks.md#2-give-each-issue-a-rule-and-a-link): the rule IDs the new checks in items 5 and 7 use.
- **ESM-161**, [Check plan mockups](rules-as-checks.md#4-check-plan-mockups): the pattern item 7 follows, a check of one plan section.
- **ESM-163**, [Check pull requests in CI](rules-as-checks.md#6-check-pull-requests-in-ci): `pr-check`, which items 5 and 6 extend to read the Review section and the Architecture line.
- **ESM-148** to **ESM-153**, [Offer the planning approach to hosts](host-planning-guidance.md): delivery plans and `story-map plan`, which gain the architecture section in item 9.
- **ESM-173**, [Review edited rules one at a time](upgrade-review.md#8-review-edited-rules-one-at-a-time): the upgrade review that offers item 9 to hosts.
- **ESM-303**, [Report validation problems by line on the PR diff](../story-map.md#validate-a-change): the annotations that lint and the new checks appear as.
- **ESM-610**, [Keep source checks fast on crafted headings](0.6.0-review-fixes.md#11-source-checks-that-stay-fast): earlier ReDoS work, whose example ESM-175 follows.

Planned, and overlapping:

- **ESM-109**, [Audit the map against the code on a schedule](0.4.0-enhancements.md#7-scheduled-map-audit): the fourth review point in item 8, unchanged.
- **ESM-175**, the ReDoS fix in `fileSlug`: the first PR in the pilot.

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. Releases | The ReDoS fix, ESM-175, goes in 0.7.9, which has merged but not shipped, so it goes out with the next tag. The review stories go in a new release, 0.7.11. It sits after 0.7.9 until #188 adds 0.7.10, then moves after it |
| B. When hosts get the review rule | After the pilot, and after item 6 has been used on a real change that affects hosts. Copied rule text is hard to take back |
| C. Where agreed architecture decisions live | In the engineering overview's Runtime and architecture section. No ADR files, so there is one place to look |
| D. How hosts adopt the architecture check | Through `settings.architectureDecisions: required`, set by the upgrade review when the person accepts it. Without it the check is a notice |
| E. The coverage floor | A ratchet: set from the baseline, rounded down, and raised as coverage rises. Never lowered without a reason in the PR |
| F. Claude review in CI | Not now. See [Not now](#not-now) |

## Not now

- **Claude review in CI.** A review on every push costs tokens on PRs nobody is ready to review, and the pilot has not yet shown what a review finds. Revisit after the pilot.
- **Formatting with Biome.** Reformatting every file would bury real changes in the diff and conflict with open PRs. Lint only.
- **ADR files.** One more place to look. Decisions go in the plan and then the engineering overview, as decision C says.
- **Refactoring `src/react.tsx` now.** Item 8 assesses it first. A refactor needs evidence of its cost, not only its size.
- **Failing CI on an empty Review section.** A warning first, while the pilot shows how often it is empty for a good reason.
- **A coverage floor per file.** The weakest files, such as `preview.js` and `board.js`, need tests written first, and a global floor is enough to stop a fall.

## Effort and release fit

| Story | Release | Points |
| --- | --- | --- |
| ESM-176: Lint the code with Biome in CI | 0.7.11 | not agreed |
| ESM-177: Measure test coverage with a floor | 0.7.11 | not agreed |
| ESM-178: Run CodeQL's quality queries | 0.7.11 | not agreed |
| ESM-179: Review against the story first, then the repo checklist | 0.7.11 | not agreed |
| ESM-182: Review each PR's diff before it is ready, and pilot the step | 0.7.11 | not agreed |
| ESM-183: Record architecture decisions in plans and PRs | 0.7.11 | not agreed |
| ESM-184: Check the architecture section in plans | 0.7.11 | not agreed |
| ESM-185: Say when to review the architecture and refactor | 0.7.11 | not agreed |
| ESM-186: Offer the review step and architecture decisions to hosts | 0.7.11 | not agreed |
| ESM-187: Share one regular-expression escape helper | 0.7.11 | not agreed |
| **Total** | | **not agreed** |

None of these has an agreed estimate, so the team should size them in review. ESM-186 is the largest: templates, the skill, the scaffold, the upgrade review and host tests. ESM-178 and ESM-187 are the smallest. ESM-186 could move to a later release if the pilot runs long, since nothing else depends on it.
