# Plan: review the set-up on install and upgrade

Status: in progress. The work is ESM-166 to ESM-173 in the **0.7.8: Upgrade review** release of the map. ESM-166 to ESM-168 and ESM-172 are merged, and ESM-169 to ESM-171 and ESM-173 are planned. Decisions A to E are made. None has an agreed estimate yet.

`story-map init` sets up a host once and never changes anything after that. That keeps it safe to run again, but it means a host that upgrades the package keeps the set-up it first installed:

| Part | What `init` does when it is already there |
| --- | --- |
| `product/story-map.yaml` | Skips it |
| `docs/story-map.md` | Skips it, and says it differs from this version's guide |
| The story map section of `AGENTS.md` | Skips it, saying it "already has the story map section", even when the section is several versions old |
| `.github/workflows/story-map.yml` | Skips it |

So most of what a release adds for hosts never reaches the hosts that already use the package: new rules in `AGENTS.md`, new CI steps such as `pr-check` from [Rules as checks](rules-as-checks.md#6-check-pull-requests-in-ci), and new choices such as delivery plans. Their agents also keep reading rules that later releases shortened or replaced with checks.

This plan adds one review, used both on install and on upgrade. It lists each part the package sets up, says what state the host's copy is in, explains what would change in plain words, and applies only what the person opts in to. The person chooses how much detail they want:

- **Simple mode** gives a short overview of what changes for the team and applies the recommended changes. It never overwrites the host's own edits, and it still asks any question that is a product choice.
- **Advanced mode** gives the same overview, then a diff for each part, and lets the person accept or keep each one.

Items are numbered in the order they should be built:

1. [Record the version each part was installed from](#1-record-the-version-each-part-was-installed-from) (ESM-166)
2. [Report the state of each part](#2-report-the-state-of-each-part) (ESM-167)
3. [Explain the changes in plain words](#3-explain-the-changes-in-plain-words) (ESM-168)
4. [Apply the recommended changes in simple mode](#4-apply-the-recommended-changes-in-simple-mode) (ESM-169)
5. [Ask for simple or advanced mode once](#5-ask-for-simple-or-advanced-mode-once) (ESM-170)
6. [Choose the parts at install](#6-choose-the-parts-at-install) (ESM-171)
7. [Remind hosts that fall behind](#7-remind-hosts-that-fall-behind) (ESM-172)
8. [Review edited rules one at a time](#8-review-edited-rules-one-at-a-time) (ESM-173)

ESM-166 comes first because every other item needs to know which version a part came from. ESM-167 to ESM-169 are the smallest useful release: a report and simple mode. ESM-170 to ESM-172 make it reach people. ESM-173 is the hard part of advanced mode and can follow later.

## How it works

The same command runs in both cases. On install every part is "not added". On upgrade the report compares each part with this version.

**Simple mode, on upgrade:**

```text
What changes for you since 0.7.5

- CI now blocks an agent's PR that confirms a draft, sets an estimate or deletes a story,
  until a person adds the map-approved label.
- Validation messages link to the guide section that explains the fix.
- Your AGENTS.md section gets 3 rules shorter, because CI checks them now.

Kept as you have them: 2 parts you edited. Run story-map upgrade --mode advanced to review them.
To decide: whether to use delivery plans. See docs/story-map.md#write-a-delivery-plan

Apply these changes? Run again with --write.
```

**Simple mode, on install:**

```text
How Auto Story Map works in this repository

- product/story-map.yaml is the plan: who it is for, what is being built, and when.
- Agents follow the rules in AGENTS.md and update the map in the same PR as the code.
- CI checks every PR: the map is valid, and changes only a person should make wait for one.
- The board shows the map in your product, with internal stories hidden from customers.

To decide: whether to use delivery plans, and the story ID policy.
More: docs/story-map.md
```

**Advanced mode** starts with the same overview, then lists each part:

```text
Part                  State                  Change
AGENTS.md section     edited, from 0.7.5     3 rules now checked by CI; diff below
Guide                 from 0.7.5, unedited   replace with 0.7.8
CI workflow           edited, from 0.7.5     add the pr-check step; diff below
Story map skill       not added              add (see Install a story map skill)
Delivery plans        not chosen             ask
Story ID policy       not chosen             ask
```

**What each mode applies:**

| Kind of change | Simple mode | Advanced mode |
| --- | --- | --- |
| A part the host never edited, such as the guide | Replaced | Diff shown, accepted or kept |
| An addition, such as a new CI step | Added | Diff shown, accepted or kept |
| A part the host edited, that this version also changes | Kept, and listed after the overview | Diff shown, accepted or kept, and rule by rule once ESM-173 lands |
| A product choice, such as delivery plans | Asked, with "not now" as an answer | Asked, with a link to the guide |

Both modes write only with `--write`, as the edit commands do, so the default run is always a report. The changes go into a branch and PR like any other change, so they can be reverted.

## What it builds on

Shipped:

- **ESM-301**, [Set up a host repository with `story-map init`](../ENGINEERING-OVERVIEW.md#init): the parts, the templates and the `auto-story-map:start` and `auto-story-map:end` markers. This plan keeps `init`'s rule that nothing is overwritten without being asked.
- **ESM-744**, [Propose map edits from the command line](../story-map.md#change-the-map-from-the-command-line): the dry run, then `--write`, that every write here follows.
- **ESM-304**, [Summarise map changes in pull requests](../story-map.md#review-a-map-change): changes to the map's settings already appear in the PR summary, so recorded choices are reviewed like any map change.

Planned, and overlapping:

- **ESM-150**, [Plan the work in AGENTS.md](host-planning-guidance.md#3-plan-the-work-in-agentsmd): its last part makes `init` report an outdated `AGENTS.md` section, and its decision C leaves replacing the section for later. This plan replaces both. ESM-150 keeps its new paragraphs, and ESM-167 is how existing hosts get them.
- **ESM-153**, [Ask whether to use delivery plans](host-planning-guidance.md#2-ask-whether-to-use-delivery-plans): keeps the answer in `settings.plans` and proposes a `notice` severity. Delivery plans become one of the choices the review asks, and ESM-170 and ESM-172 reuse the setting pattern and the severity.
- **ESM-117**, [Install a story map skill](0.8.0-agents-and-adoption.md#2-install-a-story-map-skill): the skill becomes one more part. Hosts rarely edit a skill file, so it is the easiest part to keep current.
- **ESM-180** and **ESM-159**, [Rules as checks](rules-as-checks.md): the story ID policy becomes a choice the review asks, and ESM-173 names `AGENTS.md` rules with ESM-159's rule IDs. ESM-180 and ESM-159 to ESM-161 land in 0.7.7, before this review, and ESM-162 to ESM-165 in 0.7.9, straight after it, because they help build auto-story-map itself. New installs get them from `init`. Existing hosts get them through this review, and 0.7.9's items add their own parts and "what changes for you" lines to it.

No board changes, so this plan has no UI mockup.

## 1. Record the version each part was installed from

Each file `init` writes records the package version it came from and a hash of the template text:

- **`AGENTS.md`:** the start marker becomes `<!-- auto-story-map:start 0.7.8 sha256:… -->`. Markers without a version still work.
- **The guide and the workflow:** the same, as a comment on the first line.

With the hash, the review can tell "the host edited this" from "the package changed this". A part whose text still matches its hash is unedited and safe to replace.

**Hosts set up before 0.7.8** have no version in their files. The package ships `templates/known-versions.json`, with the hash of each template from every earlier release, generated from the release tags. A part that matches one is treated as unedited from that version. A part that matches none is treated as edited, from an unknown version.

As built, the guide's first line is `<!-- auto-story-map 0.7.8 sha256:… -->` and the workflow's is `# auto-story-map 0.7.8 sha256:…`. The hash covers the part's body: the text between the `AGENTS.md` markers, or everything after the first line. `readSetupFileVersion(part, text, known)` reads a file's recorded version and hash and says whether its body matches the recorded hash or one of `known`, the earlier templates from `loadKnownSetupVersions()`. ESM-167 builds its states on it. The skill from `init --skill` and the starter map record no version. Hosts set up before the package was renamed have `embedded-story-map` markers, which `init` does not recognise, as before.

## 2. Report the state of each part

`story-map upgrade` lists every part and, for each one, its state, the version it came from, and what this version would change. It writes nothing.

- **Parts:** the `AGENTS.md` section, the guide, the CI workflow, the skill once ESM-117 ships, and the choices kept in the map's `settings`, such as delivery plans and the story ID policy.
- **States:** not added, current, outdated, edited, edited and outdated, not chosen.
- **Workflow steps** are compared by the commands they run, not line by line, since hosts change job names, Node versions and triggers. A missing step, such as `pr-check`, is reported as an addition.
- **Output:** text by default. `--format markdown` gives a PR description. `--format json` gives agents each part with its `state`, `from`, `change`, `diff` and recommendation.
- **Diffs:** plain two-way diffs between the host's copy and this version's template, until ESM-173.

As built, the report is `upgradeReport()` in `src/upgrade.ts`, and each part is an `UpgradePart` with `part`, `kind`, `state`, `from`, `change`, `recommendation`, and `additions`, `diff`, `value` and `version` where they apply. A chosen setting has the state `chosen`. Edited means the template a part came from is still this version's, so nothing is offered. A part with an unknown origin, and a skill that differs, count as edited and outdated, since an edit cannot be told apart from an old copy. `isUpgradePartBehind(part)` is the check ESM-172's reminder can share. The plan leaves the MCP server out, so the command is CLI only. See [Review the set-up after an upgrade](../story-map.md#review-the-set-up-after-an-upgrade).

## 3. Explain the changes in plain words

The overview at the top of both modes is generated, so it cannot drift from what is applied:

- **On install**, from a "what it does for you" line kept with each part's template.
- **On upgrade**, from "what changes for you" lines kept for each release in `templates/changes.yaml`, keyed by version and part.

Only lines for the parts being applied are shown, so the overview never mentions a change the host is not getting. It is capped at about ten lines, ending with a link to the guide.

A test fails when a template changes without a matching line in `changes.yaml` for the next version, and when a part has no "what it does" line.

The text and Markdown output print the overview as a block, and the JSON has it as `overview`. The guide tells agents to show it to the person as written, rather than summarising it.

As built, `templates/changes.yaml` holds both kinds of line: `install` has one for each file part, the skill included, and `releases` has the lines for each part, by the version that changed it, from 0.7.0 on. The skill records no version, so it has no release lines. The test compares the file with `templates/known-versions.json` and this checkout's templates: a release that changed a template needs a line for it, one that did not must have none, and a template changed since the newest tag needs a line under a later version. On upgrade, the lines are newest first, from every release after the version each applied part came from. Applied means added, replaced, or, for an edited workflow, gaining steps. The overview lists at most 8 lines, and is `overview` on `UpgradeReport`, built by `upgradeOverview()` in `src/upgrade-overview.ts`. At release, the lines under unreleased versions move to the version being released. See [The overview](../story-map.md#the-overview).

## 4. Apply the recommended changes in simple mode

`story-map upgrade --mode simple --write` applies what the report recommends:

- replaces parts that are unedited and outdated
- adds what is missing, such as a CI step or the skill
- keeps every edited part as it is, and lists them after the overview
- asks each product choice not yet made, and records only the answer the person gives. "Not now" leaves it unset.

Without `--write`, it prints the overview and the list of changes, and writes nothing.

For advanced mode, `--apply <parts>` applies the parts the person accepted, such as `--apply guide,workflow`, including edited parts they chose to replace.

## 5. Ask for simple or advanced mode once

`settings.upgrade` in the map holds `simple` or `advanced`. Left out, the review asks.

- An agent asks the person, and records only their answer, as with `settings.plans`. The guide and the `AGENTS.md` section say so.
- At a terminal, when standard input is interactive and no `--format` is given, the review asks itself and walks through the parts one by one in advanced mode. Agents always get the report, because they run without an interactive terminal.
- `--mode` on the command line overrides the setting for one run.

## 6. Choose the parts at install

`init` uses the same review. Today it writes every part, except the workflow with `--no-ci`. After this item:

- `init` prints the install overview and the list of parts, all marked "not added".
- In simple mode it adds the recommended set, which is every part, as today, and asks the product choices.
- In advanced mode the person picks the parts, with `--apply`.
- `--no-ci` still works, and leaves out the workflow.

An `init` run on a host that is already set up hands over to `upgrade`, instead of skipping every file.

## 7. Remind hosts that fall behind

`story-map validate` prints a notice when a part's recorded version is older than the installed package, and its template has changed since:

> This repository's set-up is from 0.7.5, and the package is 0.7.8. Run `story-map upgrade` to see what changes.

It uses the `notice` severity proposed in ESM-153, so it never fails validation, even with `--strict`. It shows once per run, not once per part. Agents run validate after each map change, so the reminder reaches the person through them soon after an upgrade.

As built, the notice has the rule `setup-behind` and names each part that is behind, with its version when they differ. A part is behind when the version it came from is older than the package and the template it came from, its recorded hash or the known earlier template its body matches, is not one this version writes. Edits do not matter, only the template. A part that is missing, or unmarked and matching no known template, is from an unknown version and gets no notice. `findSetupBehind(root)` does the check, on `readSetupFileVersion` from ESM-166.

## 8. Review edited rules one at a time

For a host that edited its `AGENTS.md` section, a whole-section diff is hard to judge. This item names each rule in the template with a comment carrying ESM-159's rule ID, such as `<!-- rule: never-remove-draft -->`, and compares rule by rule:

- a rule the host never changed is updated, or shortened when a check now covers it
- a rule the host reworded is kept, with the new version shown beside it
- a rule the host removed stays removed
- a rule the host added is kept and never touched

Advanced mode then offers each rule separately. Simple mode still keeps every edited rule, but can update the rules around it. Until this item lands, an edited section is offered as one diff.

## Decisions made

| Question | Decision |
| --- | --- |
| The release | **0.7.8: Upgrade review**, straight after 0.7.7 and before the rest of Rules as checks in 0.7.9. The delivery planning work in 0.7.7 is mostly changes to hosts' `AGENTS.md` and guide, which existing hosts only get through this review, so it comes before agent briefs, dependency planning, map versions and delivery metrics. ESM-166 to ESM-169 are the minimum. ESM-172 needs ESM-153 and ESM-173 needs ESM-159, both in 0.7.7 |
| A. A new command or an `init` flag | A new command, `story-map upgrade`, which `init` calls when a host is already set up. "Upgrade" is the word people use, and `init --review` would hide the main use |
| B. Where the version is recorded | In each file, as a marker or first-line comment, because the review compares file contents and a file can be copied between repositories. The map's `settings` keep only the person's choices. Built in ESM-166: see [What the set-up markers mean](../story-map.md#what-the-set-up-markers-mean) |
| C. Recognising hosts set up before 0.7.8 | Ship the hashes of each earlier template, in `templates/known-versions.json`, regenerated by the release script from the tags. Without them, every existing host would look edited, and simple mode would change nothing. Built in ESM-166: `npm run known-versions` writes it, and the release workflow stops when the committed file is out of date |
| D. Simple mode and product choices | Ask them. A product choice is not an upgrade, and leaving it to a default would mean the package decides for the team |
| E. Where "what changes for you" lines live | A `templates/changes.yaml` file in the package, not the changelog, which is written for people building with the library rather than the people who use the set-up. A test keeps it in step with the templates |

## Not now

- **Running on `npm install`.** Many hosts install with `--ignore-scripts`, and an install should not ask questions or change files. The reminder from ESM-172 reaches them instead.
- **Upgrading the map file itself.** Format changes between versions are covered by the upgrade sections of the guide, such as [Upgrade to 0.7.0](../story-map.md#upgrade-to-070). They could become a part of this review later, with their own dry run.
- **Several maps in one repository.** The review covers the default map path and `--map`. A monorepo runs it once per map.
- **A board view of the review.** The review changes repository files, which belongs in the CLI and a PR, not on a deployed board.
- **Undo.** The changes are in a branch and a PR, so Git covers it.

## Effort and release fit

| Story | Points |
| --- | --- |
| ESM-166: Record the version each set-up part was installed from | not agreed |
| ESM-167: Report the state of each set-up part with story-map upgrade | not agreed |
| ESM-168: Explain set-up changes in plain words | not agreed |
| ESM-169: Apply the recommended set-up changes in simple mode | not agreed |
| ESM-170: Ask once for simple or advanced upgrade mode | not agreed |
| ESM-171: Choose the set-up parts at install | not agreed |
| ESM-172: Remind hosts whose set-up falls behind the package | not agreed |
| ESM-173: Review edited AGENTS.md rules one at a time | not agreed |
| **Total** | **not agreed** |

None of these has an agreed estimate, so the PR flags them. The team should size them in review. ESM-167 and ESM-173 are the largest: ESM-167 compares four kinds of part, and ESM-173 is a three-way comparison of prose. ESM-166, ESM-170 and ESM-172 are small. ESM-173 could move to a later release, since simple mode works without it.
