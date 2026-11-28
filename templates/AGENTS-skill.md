<!-- auto-story-map:start -->
## Story map

<!-- rule: skill-source-of-truth -->
Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. The rules for changing it, and the commands to use, are in the [story map skill](.claude/skills/story-map/SKILL.md). Read it before you pick up a story, change the map or open a pull request, even if your agent does not load skills. [The story map guide](docs/story-map.md) has the details.

<!-- rule: skill-short-rules -->
If `settings.plans` is not set in the map, ask the person whether to use delivery plans before you plan work bigger than a small fix, as the skill says, and only record an answer they gave you. Never remove `draft` yourself. Name the story ID in each branch, and start each commit message, pull request title and test name with it, such as “BILLING-204: Refund cancelled orders”. Run `npx --no-install story-map validate --check-sources product/story-map.yaml` after every map change.

<!-- rule: skill-architecture-decisions -->
Answer the four architecture questions, where the work runs, who consumes it, which boundaries it touches and how to undo it, in the plan's `## Architecture decisions` section, or on an **Architecture** line in the PR description when there is no plan, as the skill says.

<!-- rule: skill-review-before-ready -->
Before you mark a pull request ready, review its diff with an explicit target, such as `/code-review <PR number>` in Claude Code, and record the review in the PR description, as the skill says. A person's review of the same diff also counts, and CI still runs every check.
<!-- auto-story-map:end -->
