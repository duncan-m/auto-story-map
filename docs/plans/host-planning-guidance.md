# Plan: ship the planning approach to host products

Status: proposed. The work is ESM-148, ESM-149, ESM-150, ESM-151 and ESM-152 in the **0.8.0: Agents and adoption** release of the map. None has an agreed estimate yet.

Hosts that install auto-story-map get the map mechanics: the format, the validator, the board and the commands. They do not get the way this repository plans the work that goes into the map. That lives in this repository's own `AGENTS.md` and, mostly, as habits the plans in `docs/plans/` share: a status line, numbered items in build order, the stories the work builds on, a UI mockup, decisions, Not now and an effort table. None of it is in [the guide](../story-map.md), the host [`AGENTS.md` template](../../templates/AGENTS.md) leaves out the UI mockup and builds-on rules, and `docs/plans/` is not in the package. This plan ships the approach in a generic form.

Items are numbered in the order they should be built:

1. [Write a delivery plan section in the guide](#1-write-a-delivery-plan-section-in-the-guide) (ESM-148)
2. [Ship an example plan](#2-ship-an-example-plan) (ESM-149)
3. [Plan the work in AGENTS.md](#3-plan-the-work-in-agentsmd) (ESM-150)
4. [Scaffold a plan from the map](#4-scaffold-a-plan-from-the-map) (ESM-151)
5. [Carry the planning rules in the skill](#5-carry-the-planning-rules-in-the-skill) (ESM-152)

ESM-148 comes first because every other item points to it. ESM-149, ESM-150 and ESM-151 can then be built in any order. ESM-152 waits for the skill itself.

## What it builds on

Shipped:

- **ESM-301**, [Set up a host repository with `story-map init`](../ENGINEERING-OVERVIEW.md#init): copies the guide and the `AGENTS.md` section into a host, and says when the host's guide differs from the package's. That makes the guide the cheapest way to reach hosts, and ESM-148 relies on it.
- **ESM-202**, [the first-run workflow](../story-map.md#populate-the-first-map): the guide's model for a step-by-step procedure an agent follows. The new section is written the same way.
- **ESM-123**, [Write a handoff brief for a story or release](agent-briefs.md#1-write-a-handoff-brief-for-a-story-or-release): picks the delivered stories to reuse and the planned stories not to build yet. ESM-151 reuses that choice for a plan's builds-on list.
- **ESM-503**, [Estimate effort on each story](effort-estimates.md): the points scale the effort table uses, and the rule that agents never set an estimate the team has not agreed.
- The guide's [Link mockups and designs](../story-map.md#link-mockups-and-designs) section already says how to link a mockup from a story. The new section points to it rather than repeating it.

Planned, and overlapping:

- **ESM-117**, [Install a story map skill](0.8.0-agents-and-adoption.md#2-install-a-story-map-skill): ESM-152 adds the planning rules to that skill. It does not build a second skill or change how ESM-117 installs one.
- **ESM-126**, [Write agent briefs from the command line](agent-briefs.md#4-write-briefs-from-the-command-line): a brief hands a planned story to an agent. A plan is what the brief's `plan` line points to. ESM-151 is a separate command with its own output, and shares the neighbour code with ESM-126, so whichever lands second exports it.
- **ESM-118**, [Survey a repository for its first map](0.8.0-agents-and-adoption.md#3-survey-a-repository-for-its-first-map): lists a host's open plans. A host whose plans follow the new structure gives the survey cleaner input, but neither depends on the other.

## 1. Write a delivery plan section in the guide

A new **Write a delivery plan** section in `docs/story-map.md`, after [Where an edit belongs](../story-map.md#where-an-edit-belongs), whose table already sends implementation detail to "the delivery plan" without saying what one is. It is written for any host, with the sample map's `BUILDER-` and `FINANCE-` stories as examples, and says that a plan is optional: a one-line fix does not need one.

The section describes these parts, in this order, each with one or two sentences on why:

1. **A title and a status line**, such as "Status: proposed. The work is BUILDER-102 and BUILDER-103 in the **Builder workflow** release." The status line names every story and the release, says whether the estimates are agreed, and is kept up to date as the work moves on.
2. **Why**, in a short paragraph: the problem, and who has it.
3. **Numbered items in build order**, each a `## N. Title` heading with its story ID beside it in the list, so each story's `sources` can link to its own section. The heading gives a stable `#heading` link that `--check-sources` checks.
4. **What it builds on**: the merged or shipped stories the work reuses, and the planned stories it overlaps, each with a link to its plan. Reviewers can then see what is new, and an agent knows what not to rebuild. It tells the reader to find them with `story-map stories --query` and `story-map story`.
5. **`## UI mockup`**, when the work adds or changes UI: an HTML mockup built on the product's real styles and markup, filled with stories from the map rather than lorem ipsum, a PNG of it embedded in the plan, and how to regenerate the image. Each story it shows links to this section in its `sources`, after its own plan section, as [Link mockups and designs](../story-map.md#link-mockups-and-designs) says.
6. **`## Decisions to make`**: a table of open questions, each with a proposal, so a reviewer can agree or change it in one line.
7. **`## Not now`**: what was considered and left out, and why. It stops the same idea coming back in every review, and gives a later plan a link to start from.
8. **`## Effort and release fit`**: a table of each story with its points, or "not agreed" when the team has not sized it, a total, and a sentence on which stories could move to another release.

Then the section closes with what to do in the map once the plan is agreed: add or find each story, put the plan section first in its `sources`, name the plan in the release `notes`, and run `validate --check-sources --plans docs/plans`.

The guide grows by roughly 60 lines. Hosts on an older version are told about it by the existing `init` message that their guide differs, and by a line in the next upgrade section.

## 2. Ship an example plan

`docs/example-builder-estimate-plan.md` is rewritten as a full plan for the sample map's builder release, following every part of the section above: a status line for BUILDER-102 and BUILDER-103, what they build on (BUILDER-101, in progress), a `## UI mockup` section, decisions, Not now (FINANCE-202, which the sample map cuts) and an effort table. Its `## Builder workflow` heading stays, or the guide's [Example](../story-map.md#example) and the tests that use its link move with it.

The mockup in the example is a short HTML table with a PNG, built on the board's `styles.css`, since the sample map has no product of its own. Its point is to show the shape of the section, not to design an estimating screen.

The example is added to the package `files`, so it is in `node_modules/auto-story-map/docs/` beside the guide. The guide links to it there and by its GitHub URL, as it already does for the example host. `init` does not copy it, because a host does not want sample stories in its own docs.

## 3. Plan the work in AGENTS.md

A short **Plan the work** paragraph in `templates/AGENTS.md`, inside the `auto-story-map:start` and `auto-story-map:end` markers, between **Populate the first map** and **Maintain the map**. It is the general form of the rules in this repository's own `AGENTS.md`, roughly:

> For work bigger than a small fix, write a delivery plan first, following [Write a delivery plan](docs/story-map.md#write-a-delivery-plan). Name the merged or shipped stories the work builds on and any planned stories it overlaps, and link their plans. When the plan adds or changes UI, include a `## UI mockup` section with an HTML mockup built on the product's real styles and markup, using stories from this map, and a PNG of it.

It leaves out what only applies here: the ESM-123 numbering rule and the board's `styles.css`. The paragraph that starts "When a plan has a mockup" moves under it. The section stays short, since every session reads it, and the detail stays in the guide.

**Reaching existing hosts.** `init` only adds the section when `AGENTS.md` does not have the markers. A host that already has the section never gets the new paragraph. So this item also makes `init` compare the text between the host's markers with the template and report a difference, as it already does for the guide: "differs from this version's section; compare it with node_modules/auto-story-map/templates/AGENTS.md". Replacing the section in place is [decision B](#decisions-to-make).

## 4. Scaffold a plan from the map

`story-map plan <ID...>` prints a plan skeleton for the stories given, in the structure from ESM-148, filled in from the map:

- **Title and status line**, with the stories' IDs and their release, and whether every story has an estimate.
- **Numbered items** in the order given, each with the story's title as its heading and its summary as a first line to rewrite.
- **What it builds on**: the delivered stories nearby and the planned stories nearby, chosen as the agent brief does (ESM-123), each with its first plan source as the link.
- **Empty sections** for UI mockup, Decisions to make and Not now, each with a one-line hint of what goes there.
- **Effort and release fit**: a table of the stories with their agreed estimates, "not agreed" where there is none, and the total.

It prints to standard output and writes nothing, so an agent pipes it into a new file and an existing plan is never overwritten. Options: `--map`, as other commands, and `--release <ID>` in place of IDs, for every planned and in-progress story in that release. An unknown ID exits 1, as `story-map story` does. It never writes an estimate, a story or a job.

This is the proposal for [decision A](#decisions-to-make). The other option, a `docs/plans/TEMPLATE.md` that `init` writes, is weighed there.

## 5. Carry the planning rules in the skill

The skill from ESM-117 gets the **Plan the work** rules from ESM-150, the commands from the planning section, and the `story-map plan` command from ESM-151 if it has landed. ESM-117 already builds the skill and the `AGENTS.md` section from one template, with a test that both carry every rule, so this item adds the rules to that template and to the test. The skill holds the longer form, such as the order of the parts and when a plan is needed. `AGENTS.md` keeps the short paragraph, so agents that do not read skills still get the rules.

If ESM-117 is cut or moved, this item moves with it, and ESM-150's paragraph is enough on its own.

## UI mockup

No mockup: this work changes docs, the `AGENTS.md` template and the command line, not the board. The example plan in ESM-149 has a mockup of its own, as an example.

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. A template file or a scaffold command | The scaffold, `story-map plan`. A `TEMPLATE.md` copied by `init` is cheaper, about a point, but goes out of date like the guide, gives every host one more file it did not ask for, and cannot fill in IDs, titles, builds-on stories or estimates, which are the parts agents get wrong. The guide section already shows the bare structure, so a template would mostly repeat it. The scaffold reuses the brief's neighbour code and is never out of date with the map |
| B. Whether `init` replaces an existing `AGENTS.md` section | No. It reports the difference, as it does for the guide. Hosts edit this section, and `init` has never overwritten anything. A `--update-agents` flag that replaces the text between the markers can follow if people ask |
| C. The release | 0.8.0, beside ESM-117, since ESM-152 adds to the skill and the release is about adoption. The other stories do not depend on 0.8.0 work, so ESM-148 to ESM-150 could ship in a 0.7.x release instead |
| D. Where hosts keep plans | The guide suggests `docs/plans/` and says any folder works, as long as `validate --plans` points at it |
| E. Whether a plan is required | No. The guide says when one helps: work that spans stories, changes UI or needs a decision. `AGENTS.md` says "bigger than a small fix" |

## Not now

- **`validate --plans` warnings for a plan with no Effort section.** It would be noisy. `--plans` reads every Markdown file under the folder, including notes, retros and shipped plans, and in this repository only 4 of the plans in `docs/plans/` have an `## Effort and release fit` section: others use `## Estimate` or put the points beside each item. A warning would fire on most existing host docs the day it shipped. The validator already warns about a planned story with no estimate, which is the part that matters. It is worth looking at again once `story-map plan` has been used for a while and plans have a common shape.
- **Shipping this repository's plans.** They describe this package's own work and would mean nothing in a host. The example plan (ESM-149) is the generic version.
- **A board view of plans.** The story panel already links each story's plan as its Engineering overview.
- **Checking a plan's structure in general**, such as that each item names a story ID. Same reason as the first item: plans vary, and a warning on prose is easy to get wrong.

## Effort and release fit

| Story | Points |
| --- | --- |
| ESM-148: Show hosts how to write a delivery plan | not agreed |
| ESM-149: Ship an example delivery plan that follows the guide | not agreed |
| ESM-150: Tell host agents how to plan work in AGENTS.md | not agreed |
| ESM-151: Scaffold a delivery plan from the map | not agreed |
| ESM-152: Carry the planning rules in the story map skill | not agreed |
| **Total** | **not agreed** |

None of these has an agreed estimate, so the map leaves them out of the 0.8.0 total and validation warns about each. The team should size them in review. ESM-148, ESM-149 and ESM-150 are docs and a small `init` change, and could move to an earlier release. ESM-151 is the largest, and could move to 0.8.1 beside ESM-126, whose code it shares. ESM-152 depends on ESM-117 and moves with it.
