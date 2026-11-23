# Plan: show story dependencies

Status: planned. The work is ESM-129 in the **0.7.5: Evidence and claims for agents** release of the map.

Stories already say what they need in their notes and plans, such as “Needs ESM-113 and ESM-114”, but the board never shows it. A builder has to read every story to find a workable build order, and nothing on the story that is needed says what is waiting for it.

Dependencies are internal only. The customer view does not change.

## UI mockup

![Mockup of story cards with a dependency icon to the right of the status, and two story panels with a Dependencies section](story-dependencies-mockup.png)

The mockup is [story-dependencies-mockup.html](story-dependencies-mockup.html), built on the real `styles.css` and the board's real markup, rendered from this product's map, status history and tests index. The dependencies are real ones from the stories' notes and plans. The panels leave out their Changes, Tests and Engineering sections. The dependency markup and its styles at the top of the file are proposed. To refresh the image, open it in a browser at 1360 px wide and take a full-page screenshot. ESM-129 links to this section from its `sources`.

What it shows:

1. **Waiting.** To the right of the status, an amber icon and count when a story it depends on is not merged yet.
2. **Count** of the stories it depends on. The tooltip and screen readers name the ones still to land.
3. **Ready.** Once every dependency is merged or shipped, the icon turns grey, like the test count.
4. **No dependencies, no icon.** Stories that need it show in its panel instead.
5. **The same icon** beside the status at the top of the story panel.
6. **Depends on** lists each story with its status and release, linking to its panel, with a line saying what it is waiting on.
7. **No icon** on a story that depends on nothing, even when others need it.
8. **Needed by** lists the stories that depend on this one, so finishing it shows what it unblocks.

## Open questions

- **Where dependencies are recorded:** a new `dependsOn` list of story IDs, which validate can check, or IDs read from the notes, which needs no schema change but cannot tell “needs” from a passing mention.
- **Cut and blocked dependencies:** whether a story that depends on a cut story should warn in validate.
