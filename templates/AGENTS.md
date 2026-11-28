<!-- auto-story-map:start -->
## Story map

<!-- rule: source-of-truth -->
Treat [product/story-map.yaml](product/story-map.yaml) as the source of truth for story placement, release grouping and delivery status. Follow [the story map guide](docs/story-map.md) for audience rules, examples and validation.

### Populate the first map

<!-- rule: populate-first-map -->
When `product/story-map.yaml` is missing, still contains the builder estimates demo, or is the starter map from `story-map init` (its summary begins “Starter map”), follow the [first-run workflow](docs/story-map.md#populate-the-first-map). Run `npx --no-install story-map survey --format json` first, then inspect this product, draft its initial internal map from what you find, and validate it. Use an existing Markdown heading for each engineering overview you can verify. If the product already has a map, keep its story IDs and update only the requested scope.

### Upgrade the set-up

<!-- rule: choose-upgrade-mode -->
Before you run `npx --no-install story-map upgrade` with `--write`, check `settings.upgrade` in `product/story-map.yaml`. If it is not set, ask the person whether they want simple or advanced upgrades, with the question and link in [Choose simple or advanced mode](docs/story-map.md#choose-simple-or-advanced-mode), and record their answer with `npx --no-install story-map settings --upgrade simple --write` or `--upgrade advanced --write`. Only record an answer they gave you. If they say not now, leave it unset and pass `--mode` for this run only.

### Plan the work

<!-- rule: choose-delivery-plans -->
If `settings.plans` is not set in `product/story-map.yaml`, ask the person whether to use delivery plans before you plan or start work bigger than a small fix, with the question and link in [Write a delivery plan](docs/story-map.md#write-a-delivery-plan). Record their answer with `npx --no-install story-map settings --plans <folder> --write` or `--plans off --write`. Only record an answer they gave you. If they say not now, leave it unset and carry on.

<!-- rule: write-delivery-plans -->
When `settings.plans` names a folder, write a delivery plan there for work bigger than a small fix, following [Write a delivery plan](docs/story-map.md#write-a-delivery-plan). `npx --no-install story-map plan <ID...>` prints a skeleton to start from. Name the merged or shipped stories the work builds on and any planned stories it overlaps, and link their plans. When the plan adds or changes UI, include a `## UI mockup` section with an HTML mockup built on the product's real styles and markup, using stories from this map, and a PNG of it.

<!-- rule: link-mockups -->
When a plan has a mockup, screenshot or design, add its link to the `sources` of each story it shows, after the story’s plan section, and name it in the release `notes` when it covers the release. See [Link mockups and designs](docs/story-map.md#link-mockups-and-designs). Read a story’s `sources` to find its plan, mockups and other material before changing it.

<!-- rule: architecture-decisions -->
Record the architecture decisions of work bigger than a small fix, following [Record architecture decisions](docs/story-map.md#record-architecture-decisions). Answer the four architecture questions: where the work runs, who consumes it upstream and downstream, which security boundaries it touches, and how to undo it. Put the answers in the plan's `## Architecture decisions` section when the work has a plan, or on an **Architecture** line in the PR description when it has none. Routine work answers in one line with a real reason, such as “None: keeps the existing design because it adds a flag to an existing command.” A consequential decision, such as a new service, a data store, a field in a saved format, a public export, a breaking contract change or a changed security boundary, needs a person's agreement before its stories go `in-progress`. Write it as a proposal until then, and never write that a person agreed a decision they did not.

### Maintain the map

<!-- rule: update-map-in-pr -->
When a change affects a user journey, story scope, release assignment or delivery status, update the map in the same PR. Find existing IDs before creating stories, with `npx --no-install story-map stories --query <text> --status all` and `npx --no-install story-map story <ID>`, and reference those IDs in the delivery plan. When your team runs several agents on one map and claims stories, claim a story with `npx --no-install story-map claim <ID> --agent <name>` before you start it, and pick another story if it exits 3. See [Coordinate several agents](docs/story-map.md#coordinate-several-agents). Make the smallest map change that matches the agreed work. Prefer `npx --no-install story-map edit`, `add` and `release-impact` to editing the YAML by hand, and check the dry run before adding `--write`. The status history credits the commit author with each edit, or whoever merged it when the author is a bot. Set `updatedBy` only when neither is the person to credit, such as when you make an edit on someone else’s behalf, and use their display name.

<!-- rule: audience-and-status -->
Keep new stories internal by default. Add customer-facing copy only when the story is approved for that audience. Mark a story as `merged` when its work reaches the default branch, and as `shipped` when it is available to its intended users. If the product deploys every merge straight away, go straight to `shipped`. When work stops or is dropped, set the status to `blocked` or `cut` instead of deleting the story, and explain why in `statusReason`. If release assignment or availability is unclear, keep the existing value and flag the question in the PR.

<!-- rule: release-notes-and-impact -->
Record each release’s notes and expected impact in its `notes` and `impact`, following [Release notes and impact](docs/story-map.md#release-notes-and-impact). Mark impact items you draft with `draft: true`. Only a person removes `draft`, so never remove it yourself, and never run `story-map confirm` with `--write`. CI checks this with `story-map pr-check`. The board cannot edit these fields, so update them in a PR like any other map change.

<!-- rule: jobs-to-be-done -->
Tag each story you add or change with the jobs to be done it serves, using the existing job IDs in the map's `personas`, following [Personas and jobs to be done](docs/story-map.md#personas-and-jobs-to-be-done). Never invent a persona or job without marking each job `draft: true` and saying so in the PR, and never remove `draft` yourself.

<!-- rule: outstanding-actions -->
To find outstanding map work, run `story-map actions`, which lists what the board's Actions tab shows, following [See what the map is waiting for](docs/story-map.md#see-what-the-map-is-waiting-for). You may act on actions that do not need a person. Leave the ones marked as needing a person, such as drafts to confirm and estimates to agree, to a person, and mention them in the PR if your work touches them.

<!-- rule: agreed-estimates -->
A story's `estimate` is the team's agreed size in story points, following [Estimate effort](docs/story-map.md#estimate-effort). Do not set or change an estimate unless the team has agreed it, and CI checks this with `story-map pr-check`. When a planned or in-progress story has none, flag it in the PR instead.

<!-- rule: record-tokens -->
When you open the pull request that finishes a story, the one that marks it `merged`, record the tokens used to deliver it and their estimated cost, following [Record the tokens used on a story](docs/story-map.md#record-the-tokens-used-on-a-story). In Claude Code, run `npx --no-install story-map tokens <ID>`, adding `--branch` for a branch your session started on before you renamed it, record them with `npx --no-install story-map edit <ID> --tokens <n> --estimated-cost <usd>`, and paste the output of `npx --no-install story-map tokens --format markdown <ID>` into the PR's **Tokens used** section. Other agents record the count and cost their own tool reports. When you cannot count them, say so in that section instead of guessing. CI checks that the section names each story the PR marks merged.

<!-- rule: test-names -->
When you add or change a test that covers a story, put the story ID at the start of the test's name, followed by a colon, such as `test("BILLING-204: refunds a cancelled order", …)`. See [Link tests to stories](docs/story-map.md#link-tests-to-stories).

<!-- rule: validate-after-change -->
Run `npx --no-install story-map validate --check-sources product/story-map.yaml` after every map change. It also checks that each repository-relative source exists and that each `#heading` matches. Add `--plans <folder>` to check story IDs mentioned in delivery plans, and `--tests <folder>` to check the story IDs in test names. In CI, add `--format github` so problems appear on the PR diff.

### Branches and pull requests

<!-- rule: branch-and-title-names -->
Name each branch for the work it holds and include the story ID, such as `fix/billing-204-refund-cancelled-orders`. Start each pull request title and commit message with the story ID and a colon, such as “BILLING-204: Refund cancelled orders”, so the story panel lists the work under **Changes**. Do not use random or generated branch names, such as `claude/zealous-fermat-srf6a2`, or the branch name as the title. This is your explicit permission to rename a branch your session assigned before the first push.

<!-- rule: pr-diff-summary -->
In the PR description, include the summary from `npx --no-install story-map diff origin/<base branch>`, and call out anything under **Customer-facing changes**.

<!-- rule: review-before-ready -->
Review each pull request's diff before you mark it ready, following [Review a change before it is ready](docs/story-map.md#review-a-change-before-it-is-ready), starting from what the story promised. Give the review an explicit target, the PR number or `origin/<base branch>...HEAD` before the PR exists, so it covers every commit: in Claude Code, run `/code-review <PR number>`. Fix the findings that are real, and review again after any material change. Record the review in the PR description's **Review** section: the target, the commit reviewed, the findings fixed and declined with a reason for each, and the review's own tokens and cost, apart from the story's. A person's review of the same diff also counts. If you cannot run a review, leave the PR as a draft and say so. The review does not replace CI, which still runs every test and check.
<!-- auto-story-map:end -->
