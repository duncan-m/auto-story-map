# Plan: show story dependencies

Status: built. The work is ESM-129 in the **0.7.5: Evidence and claims for agents** release of the map.

Stories already say what they need in their notes and plans, such as “Needs ESM-113 and ESM-114”, but the board never shows it. A builder has to read every story to find a workable build order, and nothing on the story that is needed says what is waiting for it.

Dependencies are internal only. The customer view does not change.

## UI mockup

![Mockup of story cards with a dependency icon to the right of the status, and two story panels with a Dependencies section](story-dependencies-mockup.png)

The mockup, made before the build, is [story-dependencies-mockup.html](story-dependencies-mockup.html), built on the real `styles.css` and the board's real markup, rendered from this product's map, status history and tests index. The dependencies are real ones from the stories' notes and plans. The panels leave out their Changes, Tests and Engineering sections. The dependency markup and its styles at the top of the file are proposed. To refresh the image, open it in a browser at 1360 px wide and take a full-page screenshot. ESM-129 links to this section from its `sources`.

What it shows:

1. **Count** to the right of the status on each card: how many stories this one depends on.
2. **Tooltip** and screen readers name them, such as “Depends on 2 stories: ESM-105, ESM-116”.
3. **Grey, like the test count.** The card shows only the count. Since built, the card counts only the dependencies not yet merged or shipped. See [Hide delivered dependencies on cards](#hide-delivered-dependencies-on-cards).
4. **No dependencies, no count.** The stories waiting for a story show only in its panel.
5. **The same count** beside the status at the top of the story panel.
6. **Depends on** lists each story with its status and release, linking to its panel.
7. **No count** on a story that depends on nothing, even when others wait for it.
8. **Waiting for this story** lists the stories whose `dependsOn` names this one, so finishing it shows what it unblocks.

## Record dependencies in the map

Each story gets an optional `dependsOn` list of story IDs in the schema:

```yaml
  - id: ESM-109
    title: Audit the map against the code on a schedule
    dependsOn:
      - ESM-105
```

Validate rejects an ID that is not in the map, a story that depends on itself and a cycle. It warns when a story that is not cut depends on a cut story, because that work will not land. The board works out the stories waiting for each story from these lists, so nothing is recorded twice. Existing “Needs ESM-…” notes move into `dependsOn` in the same PR.

`story-map edit` gets `--add-dependency <ID>` and `--remove-dependency <ID>`, and `story-map add` gets `--dependency <ID>`, repeated for each story, so agents record dependencies without editing the YAML by hand. `story-map diff` shows dependencies added and removed.

## Estimate

8 points: the schema field and its checks, the edit and add options, the diff line, the card count, the panel's Dependencies section, moving the existing notes into `dependsOn`, the docs and tests.

## What was built

The guide describes the feature in [Record dependencies](../story-map.md#record-dependencies). The dependencies already written in this map's notes and plans moved into `dependsOn`: ESM-109 and ESM-126 depend on ESM-105, ESM-126 also on ESM-116, ESM-111 on ESM-122, ESM-112 on ESM-111, ESM-115 on ESM-113 and ESM-114, and ESM-127 on ESM-112.

## Hide delivered dependencies on cards

A card that kept counting a dependency already merged said the story was still waiting when it was not. ESM-107 showed “1” for ESM-105 after ESM-105 had merged. So, before 0.7.5 ships, cards count only the dependencies that are not yet delivered:

- **Delivered means `merged` or `shipped`.** The work is on the default branch, so dependent work can build on it, as the [dependency planning plan](visual-dependency-map.md) defines a done prerequisite. Blocked and cut dependencies still count.
- **All delivered, no count.** The card shows nothing, as for a story with no dependencies.
- **Some delivered.** The card counts the rest, and its tooltip says so, such as “Depends on 1 story not yet merged or shipped: ESM-116”.
- **The panel is unchanged.** Its count beside the status still counts every dependency, and **Depends on** lists each one with its status, so the record of what the story built on stays visible.

![Mockup of four cards, two whose only dependency is merged with no count, one counting one of two dependencies and one counting two, above the ESM-109 panel listing its merged dependency](story-dependencies-delivered-mockup.png)

The mockup is [story-dependencies-delivered-mockup.html](story-dependencies-delivered-mockup.html), the real board rendered with this change from this product's map, using the real `styles.css`. To refresh the image, open it in a browser at 1360 px wide and take a full-page screenshot.

ESM-139 builds on this with ready, waiting and at-risk states.

## Follow-ups

The handoff brief from ESM-123 does not list dependencies yet. Adding them to its `<target>` section is a follow-up.
