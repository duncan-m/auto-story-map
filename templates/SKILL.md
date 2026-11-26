---
name: story-map
description: Rules and commands for the product story map in product/story-map.yaml. Use when picking up a story, finding story IDs, changing a user journey, story scope, release or delivery status, writing tests for a story, or opening a pull request that touches the map.
---

# Story map

__RULES__

## Common commands

```sh
npx --no-install story-map stories --query <text> --status all
npx --no-install story-map story <ID>
npx --no-install story-map releases
npx --no-install story-map evidence <ID>
npx --no-install story-map claim <ID> --agent <name>
npx --no-install story-map edit <ID> --status in-progress
npx --no-install story-map add --title <text> --activity <ID> --release <ID>
npx --no-install story-map validate --check-sources product/story-map.yaml
npx --no-install story-map diff origin/<base branch>
```

`edit` and `add` print a dry run. Check it, then run the command again with `--write`. Add `--format json` to the read commands for output you can parse.
