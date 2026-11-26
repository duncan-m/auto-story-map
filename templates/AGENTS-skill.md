<!-- auto-story-map:start -->
## Story map

Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. The rules for changing it, and the commands to use, are in the [story map skill](.claude/skills/story-map/SKILL.md). Read it before you pick up a story, change the map or open a pull request, even if your agent does not load skills. [The story map guide](docs/story-map.md) has the details.

Never remove `draft` yourself. Name the story ID in each branch, and start each commit message, pull request title and test name with it, such as “BILLING-204: Refund cancelled orders”. Run `npx --no-install story-map validate --check-sources product/story-map.yaml` after every map change.
<!-- auto-story-map:end -->
