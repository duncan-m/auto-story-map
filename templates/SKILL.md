---
name: story-map
description: Rules and commands for the product story map in product/story-map.yaml. Use when picking up a story, finding story IDs, planning work, changing a user journey, story scope, release or delivery status, writing tests for a story, or opening a pull request that touches the map.
---

# Story map

__RULES__

## Delivery plans in detail

Read `settings` in `product/story-map.yaml` before you plan work, and follow the rule that matches it:

- **`settings.plans` is left out**: nobody has chosen yet. Before you plan or start work bigger than a small fix, ask the person the question in [Choose whether to use delivery plans](../../../docs/story-map.md#choose-whether-to-use-delivery-plans), word for word, so every agent asks the same thing. Record a yes with `npx --no-install story-map settings --plans <folder> --write` and a no with `--plans off --write`, and commit it with your work. Only record an answer the person gave you in this conversation. If they say not now, change nothing and carry on.
- **`settings.plans` is `false`**: this product plans elsewhere. Do not write delivery plans, and do not ask again.
- **`settings.plans` names a folder**: write a plan in that folder for work that spans several stories, changes the UI or needs a decision. A one-story fix with nothing to decide needs none.

A plan has these parts, in this order, as [The parts of a plan](../../../docs/story-map.md#the-parts-of-a-plan) explains:

1. A title and a status line naming every story, the release and whether the estimates are agreed. Keep it up to date as the work moves on.
2. Why: the problem, and who has it.
3. Numbered items in build order, each a `## N. Title` heading with its story ID, so each story's `sources` link to its own item.
4. What it builds on: the merged or shipped stories it reuses and the planned stories it overlaps, each with a link to its plan.
5. `## UI mockup`, when the work adds or changes UI: an HTML mockup on the product's real styles and markup, using stories from the map, with a PNG and how to regenerate it.
6. `## Decisions to make`: a table of open questions, each with a proposal.
7. `## Not now`: what was left out, and why.
8. `## Effort and release fit`: each story's agreed points, or "not agreed", and a total. Never write an estimate the team has not agreed.

Start from `npx --no-install story-map plan <ID...>`, or `--release <ID>`, which prints the skeleton filled in from the map. Save it to a new file in the plans folder, never over an existing plan. Once the plan is agreed, put each story's plan section first in its `sources`, name the plan in the release `notes` when it covers the release, and run `npx --no-install story-map validate --check-sources product/story-map.yaml`, which then checks the story IDs in the plans folder.

## Common commands

```sh
npx --no-install story-map stories --query <text> --status all
npx --no-install story-map story <ID>
npx --no-install story-map releases
npx --no-install story-map evidence <ID>
npx --no-install story-map claim <ID> --agent <name>
npx --no-install story-map edit <ID> --status in-progress
npx --no-install story-map add --title <text> --activity <ID> --release <ID>
npx --no-install story-map plan <ID...>
npx --no-install story-map settings --plans <folder>
npx --no-install story-map validate --check-sources product/story-map.yaml
npx --no-install story-map diff origin/<base branch>
```

`edit` and `add` print a dry run. Check it, then run the command again with `--write`. Add `--format json` to the read commands for output you can parse.

Each problem `validate` reports names its rule in brackets, such as `[missing-status-reason]`, with a `help:` link to the guide section that explains it. Read that section to fix the problem, rather than the whole guide.
