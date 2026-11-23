# Plan: show story dependencies

Status: planned. The work is ESM-129 in the **0.7.5: Evidence and claims for agents** release of the map.

Stories already say what they need in their notes and plans, such as “Needs ESM-113 and ESM-114”, but the board never shows it. A builder has to read every story to find a workable build order, and nothing on the story that is needed says what is waiting for it.

Dependencies are internal only. The customer view does not change.

## UI mockup

![Mockup of story cards with a dependency icon to the right of the status, and two story panels with a Dependencies section](story-dependencies-mockup.png)

The mockup is [story-dependencies-mockup.html](story-dependencies-mockup.html), built on the real `styles.css` and the board's real markup, rendered from this product's map, status history and tests index. The dependencies are real ones from the stories' notes and plans. The panels leave out their Changes, Tests and Engineering sections. The dependency markup and its styles at the top of the file are proposed. To refresh the image, open it in a browser at 1360 px wide and take a full-page screenshot. ESM-129 links to this section from its `sources`.

What it shows:

1. **Count** to the right of the status on each card: how many stories this one depends on.
2. **Tooltip** and screen readers name them, such as “Depends on 2 stories: ESM-105, ESM-116”.
3. **Grey, like the test count,** whatever the status of the stories it depends on. The card shows only the count.
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

Validate rejects an ID that is not in the map, a story that depends on itself and a cycle. The board works out the stories waiting for each story from these lists, so nothing is recorded twice. Existing “Needs ESM-…” notes move into `dependsOn` in the same PR.

## Open questions

- **Cut dependencies:** whether validate should warn when a story depends on a cut story.
- **Edit and add:** whether `story-map edit` and `add` get `--add-dependency` and `--remove-dependency` in this story or later.
