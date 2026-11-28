# Plan: offer the planning approach to host products

Status: shipped. The work is ESM-148, ESM-153, ESM-150, ESM-149, ESM-151 and ESM-152 in the **0.7.7: Delivery plans and test tags** release of the map, built as proposed below with the decisions in [Decisions made](#decisions-made). None has an agreed estimate yet.

Hosts that install auto-story-map get the map mechanics: the format, the validator, the board and the commands. They do not get the way this repository plans the work that goes into the map. That lives in this repository's own `AGENTS.md` and, mostly, as habits the plans in `docs/plans/` share: a status line, numbered items in build order, the stories the work builds on, a UI mockup, decisions, Not now and an effort table. None of it is in [the guide](../story-map.md), the host [`AGENTS.md` template](../../templates/AGENTS.md) leaves out the UI mockup and builds-on rules, and `docs/plans/` is not in the package.

This plan offers the approach to hosts in a generic form, as an **opt-in**. Many teams already plan in an issue tracker, ADRs or a design doc tool, and a rule that every agent session writes a plan in `docs/plans/` would clash with that. So nothing applies until a person says yes, and the package does as much as it can to make sure an agent asks them, with a link to the guidance, rather than deciding for them or never mentioning it.

Items are numbered in the order they should be built:

1. [Write a delivery plan section in the guide](#1-write-a-delivery-plan-section-in-the-guide) (ESM-148)
2. [Ask whether to use delivery plans](#2-ask-whether-to-use-delivery-plans) (ESM-153)
3. [Plan the work in AGENTS.md](#3-plan-the-work-in-agentsmd) (ESM-150)
4. [Ship an example plan](#4-ship-an-example-plan) (ESM-149)
5. [Scaffold a plan from the map](#5-scaffold-a-plan-from-the-map) (ESM-151)
6. [Carry the planning rules in the skill](#6-carry-the-planning-rules-in-the-skill) (ESM-152)

ESM-148 comes first because it is the page every question links to. ESM-153 records the answer, and ESM-150 uses it, so they follow in that order. ESM-149 and ESM-151 can then be built in any order. ESM-152 waits for the skill itself.

## What it builds on

Shipped:

- **ESM-301**, [Set up a host repository with `story-map init`](../ENGINEERING-OVERVIEW.md#init): copies the guide and the `AGENTS.md` section into a host, says when the host's guide differs from the package's, and ends by printing a prompt to give an agent. ESM-148 relies on the copied guide, and ESM-153 adds the question to that prompt.
- **ESM-202**, [the first-run workflow](../story-map.md#populate-the-first-map): the guide's step-by-step procedure for an agent setting up a map. ESM-148 adds the question to its hand-off step.
- **ESM-401**, [Warn about map problems without failing CI](../story-map.md#validate-a-change): the warning severity that ESM-153's unanswered-question message builds on.
- **ESM-123**, [Write a handoff brief for a story or release](agent-briefs.md#1-write-a-handoff-brief-for-a-story-or-release): picks the delivered stories to reuse and the planned stories not to build yet. ESM-151 reuses that choice for a plan's builds-on list.
- **ESM-503**, [Estimate effort on each story](effort-estimates.md): the points scale the effort table uses, and the rule that agents never set an estimate the team has not agreed.
- The guide's [Link mockups and designs](../story-map.md#link-mockups-and-designs) section already says how to link a mockup from a story. The new section points to it rather than repeating it.

Planned, and overlapping:

- **ESM-117**, [Install a story map skill](0.8.0-agents-and-adoption.md#2-install-a-story-map-skill): ESM-152 adds the planning rules to that skill. It does not build a second skill or change how ESM-117 installs one.
- **ESM-126**, [Write agent briefs from the command line](agent-briefs.md#4-write-briefs-from-the-command-line): a brief hands a planned story to an agent. A plan is what the brief's `plan` line points to. ESM-151 is a separate command with its own output, and shares the neighbour code with ESM-126, so whichever lands second exports it.
- **ESM-118**, [Survey a repository for its first map](0.8.0-agents-and-adoption.md#3-survey-a-repository-for-its-first-map): lists a host's open plans. A host whose plans follow the new structure gives the survey cleaner input, but neither depends on the other.

## How a host is asked

The question reaches the person at every point where an agent works on the map, and stops once it has an answer:

| When | What prompts the agent | Item |
| --- | --- | --- |
| Right after install | `init` lists "Delivery plans: not chosen yet" and its closing prompt asks the agent to put the question to the person | ESM-153 |
| Setting up the first map | The first-run workflow's hand-off step asks the question | ESM-148 |
| Every session | The `AGENTS.md` section says to ask before planning work while the choice is unset | ESM-150 |
| Every map change | `story-map validate`, which agents run after each edit and CI runs on each PR, reports that the choice is unset | ESM-153 |
| Upgrading an existing host | The upgrade steps say to ask before adding the planning rules | ESM-148 |

Every one of these names the same question and links to the same section, [Write a delivery plan](../story-map.md#write-a-delivery-plan), so the person can read what they would be agreeing to. The answer is kept in the map (ESM-153), so a "no" is never asked again and a "yes" turns the rules on for every agent at once.

## 1. Write a delivery plan section in the guide

A new **Write a delivery plan** section in `docs/story-map.md`, after [Where an edit belongs](../story-map.md#where-an-edit-belongs), whose table already sends implementation detail to "the delivery plan" without saying what one is. It is written for any host, with the sample map's `BUILDER-` and `FINANCE-` stories as examples.

**It opens with the choice.** Plans are optional, and the section says so first: what a team gets from them (reviewers see what is new, agents know what not to rebuild, decisions and cut ideas are written down), what they cost (a document per piece of work), and that a team that plans elsewhere can say no. Then it gives the question for an agent to ask, word for word, so every agent asks the same thing:

> Auto Story Map can keep a delivery plan in this repository for each piece of work that spans several stories, changes the UI or needs a decision. Each plan names its stories, what they build on, a mockup for UI changes, open decisions, what was left out and the effort. See [Write a delivery plan](docs/story-map.md#write-a-delivery-plan). Do you want to use delivery plans here? If so, which folder should they go in? The default is `docs/plans`.

And it says what to do with each answer: yes, no, or "not now", which leaves the choice unset so it is asked again next time (ESM-153).

**Then the structure**, for teams that say yes, each part with one or two sentences on why:

1. **A title and a status line**, such as "Status: proposed. The work is BUILDER-102 and BUILDER-103 in the **Builder workflow** release." The status line names every story and the release, says whether the estimates are agreed, and is kept up to date as the work moves on.
2. **Why**, in a short paragraph: the problem, and who has it.
3. **Numbered items in build order**, each a `## N. Title` heading with its story ID beside it in the list, so each story's `sources` can link to its own section. The heading gives a stable `#heading` link that `--check-sources` checks.
4. **What it builds on**: the merged or shipped stories the work reuses, and the planned stories it overlaps, each with a link to its plan. It tells the reader to find them with `story-map stories --query` and `story-map story`.
5. **`## UI mockup`**, when the work adds or changes UI: an HTML mockup built on the product's real styles and markup, filled with stories from the map rather than lorem ipsum, a PNG of it embedded in the plan, and how to regenerate the image. Each story it shows links to this section in its `sources`, after its own plan section, as [Link mockups and designs](../story-map.md#link-mockups-and-designs) says.
6. **`## Decisions to make`**: a table of open questions, each with a proposal, so a reviewer can agree or change it in one line.
7. **`## Not now`**: what was considered and left out, and why.
8. **`## Effort and release fit`**: a table of each story with its points, or "not agreed" when the team has not sized it, a total, and a sentence on which stories could move to another release.

It closes with what to do in the map once the plan is agreed: add or find each story, put the plan section first in its `sources`, name the plan in the release `notes`, and run `validate --check-sources`, which checks the plans folder once it is set (ESM-153).

**Two more places in the guide:**

- **The first-run workflow** gains the question in its hand-off step (step 4): after validating the first map, ask whether to use delivery plans, record the answer, and list it in the hand-off with the rest of the open decisions.
- **The upgrade section** for this release says to ask the person before adding the planning rules, and to record the answer, rather than copying the new `AGENTS.md` paragraph in.

The guide grows by roughly 70 lines. Hosts on an older version are told about it by the existing `init` message that their guide differs, and by the upgrade section.

## 2. Ask whether to use delivery plans

ESM-153 gives the choice a place in the map and makes the tools ask for it.

**The setting.** `settings.plans` in the map takes a folder, such as `docs/plans`, to use delivery plans there, or `false` to not use them. Left out means nobody has chosen yet. It lives in the map, beside `stalledAfterWeeks`, so the answer is in Git, reviewed in a PR like any map change, and the same for every agent and every person. `story-map diff` reports a change to it under the map's settings.

**Recording the answer.** `story-map settings --plans <folder>` and `story-map settings --plans off` set it, with a dry run first and `--write` to save, as the other edit commands do. "Not now" changes nothing. An agent only records an answer the person gave in the conversation, and the `AGENTS.md` section says so.

**Prompts from the tools**, while the setting is left out:

- **`init`** adds a line to its steps, `ask     delivery plans (not chosen yet; see docs/story-map.md#write-a-delivery-plan)`, and its closing prompt for the agent gains a sentence: "Then ask me whether to use delivery plans, linking to Write a delivery plan in docs/story-map.md, and record my answer with `story-map settings`." The person sees it in the terminal, and so does an agent that ran `init` for them.
- **`story-map validate`** reports the unset choice once per map, at the top: "Delivery plans: not chosen yet. Ask the person whether to use them, see docs/story-map.md#write-a-delivery-plan, and record the answer with `story-map settings --plans`." Agents run validate after every map change, so the question comes up the first time one touches the map. In CI it appears as a notice on the PR. It does not fail `--strict`: see [decision B](#decisions-to-make).
- **The link.** Messages link to the host's own copy of the guide. When that copy has no **Write a delivery plan** heading, because the host has not updated its guide, they link to the section on GitHub at the installed version's tag instead, such as `https://github.com/duncan-m/auto-story-map/blob/v0.7.7/docs/story-map.md#write-a-delivery-plan`, so the link always opens the right text.

**Once chosen**, the setting does two more things: `validate --check-sources` checks the story IDs in that folder, as `--plans` does today, without the flag, and `story-map plan` (ESM-151) suggests a path in it. With `false`, nothing mentions plans again.

## 3. Plan the work in AGENTS.md

Two short paragraphs in `templates/AGENTS.md`, inside the `auto-story-map:start` and `auto-story-map:end` markers, between **Populate the first map** and **Maintain the map**.

**Ask about delivery plans**, which applies until the choice is made:

> If `settings.plans` is not set in `product/story-map.yaml`, ask the person whether to use delivery plans before you plan or start work bigger than a small fix, with the question and link in [Write a delivery plan](docs/story-map.md#write-a-delivery-plan). Record their answer with `npx --no-install story-map settings --plans <folder>` or `--plans off`. Only record an answer they gave you. If they say not now, leave it unset and carry on.

**Plan the work**, which applies only when `settings.plans` names a folder:

> When `settings.plans` names a folder, write a delivery plan there for work bigger than a small fix, following [Write a delivery plan](docs/story-map.md#write-a-delivery-plan). Name the merged or shipped stories the work builds on and any planned stories it overlaps, and link their plans. When the plan adds or changes UI, include a `## UI mockup` section with an HTML mockup built on the product's real styles and markup, using stories from this map, and a PNG of it.

They leave out what only applies here: the ESM-123 numbering rule and the board's `styles.css`. The existing paragraph that starts "When a plan has a mockup" moves under **Plan the work**. The section stays short, since every session reads it, and the detail stays in the guide.

**Reaching existing hosts.** `init` only adds the section when `AGENTS.md` does not have the markers, so a host that already has the section would never get the new paragraphs. This item makes `init` compare the text between the host's markers with the template and report a difference, as it already does for the guide: "differs from this version's section; compare it with node_modules/auto-story-map/templates/AGENTS.md". The validator's prompt from ESM-153 reaches those hosts anyway, because it does not depend on `AGENTS.md`. Replacing the section in place is [decision C](#decisions-to-make).

## 4. Ship an example plan

`docs/example-builder-estimate-plan.md` is rewritten as a full plan for the sample map's builder release, following every part of the structure: a status line for BUILDER-102 and BUILDER-103, what they build on (BUILDER-101, in progress), a `## UI mockup` section, decisions, Not now (FINANCE-202, which the sample map cuts) and an effort table. Its `## Builder workflow` heading stays, or the guide's [Example](../story-map.md#example) and the tests that use its link move with it.

The mockup in the example is a short HTML table with a PNG, built on the board's `styles.css`, since the sample map has no product of its own. Its point is to show the shape of the section, not to design an estimating screen.

The example is added to the package `files`, so it is in `node_modules/auto-story-map/docs/` beside the guide. The guide's question and structure link to it there and by its GitHub URL, so a person deciding whether to say yes can see a real plan. `init` does not copy it, because a host does not want sample stories in its own docs.

## 5. Scaffold a plan from the map

`story-map plan <ID...>` prints a plan skeleton for the stories given, in the structure from ESM-148, filled in from the map:

- **Title and status line**, with the stories' IDs and their release, and whether every story has an estimate.
- **Numbered items** in the order given, each with the story's title as its heading and its summary as a first line to rewrite.
- **What it builds on**: the delivered stories nearby and the planned stories nearby, chosen as the agent brief does (ESM-123), each with its first plan source as the link.
- **Empty sections** for UI mockup, Decisions to make and Not now, each with a one-line hint of what goes there.
- **Effort and release fit**: a table of the stories with their agreed estimates, "not agreed" where there is none, and the total.

It prints to standard output and writes nothing, so an agent pipes it into a new file and an existing plan is never overwritten. It ends with a suggested path in the `settings.plans` folder. Options: `--map`, as other commands, and `--release <ID>` in place of IDs, for every planned and in-progress story in that release. An unknown ID exits 1, as `story-map story` does. It never writes an estimate, a story or a job.

While `settings.plans` is unset, it still prints the skeleton, after the same reminder that validate gives. With `false`, it prints the skeleton and a note that this host has chosen not to keep plans, since a person may run it on purpose.

This is the proposal for [decision A](#decisions-to-make). The other option, a `docs/plans/TEMPLATE.md` that `init` writes, is weighed there.

## 6. Carry the planning rules in the skill

The skill from ESM-117 gets both paragraphs from ESM-150, the question from ESM-148, and the `story-map plan` command from ESM-151 if it has landed. ESM-117 already builds the skill and the `AGENTS.md` section from one template, with a test that both carry every rule, so this item adds the rules to that template and to the test. The skill holds the longer form, such as the order of the parts and when a plan is needed, and follows the same setting: it asks while `settings.plans` is unset and applies the rules only when it names a folder. `AGENTS.md` keeps the short paragraphs, so agents that do not read skills still ask.

If ESM-117 is cut or moved, this item moves with it, and ESM-150's paragraphs are enough on their own.

## UI mockup

No mockup: this work changes docs, the `AGENTS.md` template and the command line, not the board. The example plan in ESM-149 has a mockup of its own, as an example.

## Decisions made

The build took every proposal below. For B, validate reports the unset choice with a new `notice` severity: printed first by every format, a `::notice` annotation with `--format github`, counted in `notices`, and never failing, even with `--strict`. The Actions tab does not list notices yet, since it lists warnings only. For E, "not now" leaves `settings.plans` unset.

## Decisions to make

These are proposals. Each is easy to change during review.

| Question | Proposal |
| --- | --- |
| A. A template file or a scaffold command | The scaffold, `story-map plan`. A `TEMPLATE.md` copied by `init` is cheaper, about a point, but goes out of date like the guide, gives every host a file before it has said yes to plans, and cannot fill in IDs, titles, builds-on stories or estimates, which are the parts agents get wrong. The guide section already shows the bare structure, so a template would mostly repeat it |
| B. How validate reports an unset choice | As a new `notice` severity: printed by every format and shown on the PR in CI, but never failing validation, even with `--strict`. A warning would break CI for every `--strict` host on the day it upgrades, for a question rather than a problem. If a third severity is too much, a warning left out of `--strict` is the fallback |
| C. Whether `init` replaces an existing `AGENTS.md` section | No. It reports the difference, as it does for the guide. Hosts edit this section, and `init` has never overwritten anything. The validator prompt reaches existing hosts without it. A `--update-agents` flag that replaces the text between the markers can follow if people ask |
| D. Where the answer is kept | In the map's `settings.plans`, so it is in Git, reviewed and shared by every agent. Keeping it in `AGENTS.md` would need an agent to edit the marked section, which `init` compares against the template |
| E. What "not now" does | Leaves the setting unset, so the next session asks again. If that turns out to nag, a `settings.plans: later` that the validator reports once a month is the fallback |
| F. The release | 0.7.7, beside ESM-117, since ESM-152 adds to the skill and the release is about adoption. ESM-148, ESM-153 and ESM-150 do not depend on 0.7.7 work, so they could ship in a 0.7.x release instead |

## Not now

- **Turning the rules on by default.** It would be simpler, but a host that plans elsewhere would find agents writing documents nobody asked for. Asking costs one question per host.
- **`validate --plans` warnings for a plan with no Effort section.** It would be noisy. `--plans` reads every Markdown file under the folder, including notes, retros and shipped plans, and in this repository only 4 of the plans in `docs/plans/` have an `## Effort and release fit` section: others use `## Estimate` or put the points beside each item. The validator already warns about a planned story with no estimate, which is the part that matters. It is worth looking at again once `story-map plan` has been used for a while and plans have a common shape.
- **Shipping this repository's plans.** They describe this package's own work and would mean nothing in a host. The example plan (ESM-149) is the generic version.
- **A board view of plans.** The story panel already links each story's plan as its Engineering overview.
- **Checking a plan's structure in general**, such as that each item names a story ID. Same reason as the Effort warning: plans vary, and a warning on prose is easy to get wrong.

## Effort and release fit

| Story | Points |
| --- | --- |
| ESM-148: Show hosts how to write a delivery plan | not agreed |
| ESM-153: Ask each host whether to use delivery plans | not agreed |
| ESM-150: Tell host agents how to plan work in AGENTS.md | not agreed |
| ESM-149: Ship an example delivery plan that follows the guide | not agreed |
| ESM-151: Scaffold a delivery plan from the map | not agreed |
| ESM-152: Carry the planning rules in the story map skill | not agreed |
| **Total** | **not agreed** |

None of these has an agreed estimate, so the map leaves them out of the 0.7.7 total and validation warns about each. The team should size them in review. ESM-153 is the largest after ESM-151: a schema setting, a command, an `init` change and possibly a new severity. ESM-148, ESM-150 and ESM-149 are mostly docs. ESM-151 could move to 0.7.8 beside ESM-126, whose code it shares. ESM-152 depends on ESM-117 and moves with it.
