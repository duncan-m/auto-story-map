# Changelog

All notable changes to `auto-story-map` are recorded here. The project follows [semantic versioning](https://semver.org). Before 1.0.0, a minor version can include breaking changes, and each one is listed with its upgrade steps.

## 0.7.11

0.7.11 helps host teams plan work and keep their set-up current, checks the map's rules in CI, and asks for a review and the architecture decisions before each pull request is ready. It brings together 0.7.7 to 0.7.10, which were not published on their own.

- **Plan the work:** The guide, an example and `story-map plan` show host teams how to write a delivery plan, once a person says they want plans.
- **Keep the set-up current:** `story-map upgrade` shows which parts of your set-up are behind the package, says what changes in plain words, and applies the changes while keeping your own edits.
- **Check the map's rules:** Each problem `validate` reports names its rule and links to the fix, plans are checked against the map, and CI fails an agent's pull request that makes a change only a person should make.
- **Review before ready:** Agents review each pull request against its story, and record the review and the architecture decisions, before it is ready.
- **Brief an agent from the terminal:** `story-map brief` prints the same brief as the board's **Copy brief**.
- **See delivery totals:** An **Analytics** tab shows the stories, points, tokens and spend completed each day, week or month.
- **See everything released in one lane:** A toolbar switch moves every shipped story into one **Released** lane.
- **Change a story from its panel:** The status, reason and release pickers move into an **Actions** menu beside **Share**.
- **Scroll the board with the page:** One scroll bar each way, with the titles kept in view.
- **Read a summary at a glance:** Summaries written over several lines show each line on its own.

Breaking changes: `validate` has a new `notice` severity, every problem names a rule, so its text and annotation titles change, and the board scrolls with the page instead of in a box of its own. Hosts can upgrade from 0.7.0 or later: follow [Upgrade to 0.7.11](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-0711), which starts with `story-map upgrade`.

### Delivery plans for host products

- **Write a delivery plan:** The guide has a new [Write a delivery plan](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#write-a-delivery-plan) section: the question an agent asks before a product adopts plans, and the parts of a plan, from the status line to the effort table. Plans are opt in, and nothing changes until a person says yes.
- **Ask once, remember the answer:** `story-map settings --plans <folder>` or `--plans off` records the answer in the map's new `settings.plans`. Until then, `init`, `validate` and the `AGENTS.md` section ask the agent to put the question to the person.
- **Scaffold a plan:** `story-map plan <ID...>`, or `--release <ID>`, prints a plan skeleton filled in from the map, with the stories the work builds on and overlaps and an effort table of agreed estimates.
- **An example plan in the package:** `docs/example-builder-estimate-plan.md` is now a full plan for the sample map, with a mockup, and ships in the package.

**For developers**

- `validate` has a new `notice` severity, for questions to a person rather than problems with the map. It is printed first as `notice:`, as a `::notice` annotation with `--format github`, and counted in a new `notices` field, and it never fails validation, even with `--strict`. `StoryMapIssueSeverity` now includes `"notice"`: host code that switches over every severity needs a case for it.
- The only notice so far asks whether to use delivery plans, while `settings.plans` is unset. It links to the host's copy of the guide, or to the guide on GitHub at the installed version's tag when the copy has no Write a delivery plan section.
- Once `settings.plans` names a folder, `validate --check-sources` checks the story IDs in it, as `--plans` does.
- `edit --from` and the MCP server's `propose_edit` take a `plans` op, and `story-map diff` lists a change to `settings.plans` under **Settings**.
- `init` says when the story map section of `AGENTS.md` differs from the package's, and never replaces it. The `AGENTS.md` template gains a **Plan the work** section, and the skill from `init --skill` carries the planning rules in full. `storyMapPlan` and `deliveryPlanGuideLink` are exported.
- See [Upgrade to 0.7.11](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-0711).

### Rules as checks

- **Each validation problem names its rule and links to the guide:** Every problem `validate` reports now has a stable rule ID, such as `missing-status-reason`, and a link to the section of the guide that explains how to fix it, so an agent can fix a problem without reading the whole guide. Text output gives the rule in brackets with the link on the next line, GitHub annotations are titled with the rule, and JSON issues gain `rule` and `help`. The MCP server's `validate_map`, `story-map actions` and the board's Actions tab show them too. Most messages now also say what to change. See [Validation rules](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#validation-rules).
- **Warn when a plan's status line is out of date:** `validate --plans`, and `validate --check-sources` once `settings.plans` names a folder, read the first `Status:` line of each plan and warn when it is behind every story it names, starts with words other than the map's statuses, such as `built` or `done`, or names in bold a release title the map no longer has. The rules are `plan-status-behind`, `plan-status-words` and `plan-status-release`. They are warnings, so they fail only with `--strict`. Files without a status line are skipped, and `story-map plan` now starts the line with the status its stories have reached, so its output passes. The plans in this repository are reworded to match. See [Check plan status lines](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#check-plan-status-lines).
- **Check plan mockups:** `validate --plans` now checks each plan's `## UI mockup` section: it must link an HTML mockup and embed a PNG of it, both files must exist, and at least one story must list the section in its `sources`. A section with no links or images, such as one saying there is no mockup, is not checked. Each problem has its own rule: `mockup-without-html`, `mockup-without-image`, `missing-mockup-file` and `unlinked-mockup`. Like the other plan checks, it also runs under `--check-sources` once `settings.plans` names a folder, so a host whose plans break these rules sees new errors. See [Link mockups and designs](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-mockups-and-designs).
- **See the map changes only a person should make:** `story-map diff` has a new **Needs a person** section after **Customer-facing changes**. It lists drafts confirmed, estimates set, changed or removed, stories removed rather than cut, a removed story whose title matches an added one as a possible renumber, customer copy added or changed, a switch to `all-users`, and changed settings, each with its rule. It says what changed, not who changed it, and is left out when there is nothing to list. The PR template asks who made or agreed each item. See [Changes that need a person](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#changes-that-need-a-person).

- **Fill gaps in story IDs:** With `settings.storyIds: lowest-free` in the map, `story-map add` takes the lowest unused number in the map's main prefix, counting cut stories, instead of one after the highest. Maps without the setting number stories as before. `story-map diff` lists a change to it under **Settings**, and `nextStoryId` takes the scheme as a new optional third argument. See [Change the map from the command line](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#change-the-map-from-the-command-line).
**For developers**

- `StoryMapDiff` gains `needsPerson`, a list of `NeedsPersonChange` with `rule`, `itemType`, `itemId`, `title`, `change` and, for a possible renumber, `addedId`. `needsPersonChanges(before, after, diff)` and `needsPersonRules` are exported, with the `NeedsPersonChange`, `NeedsPersonRule` and `NeedsPersonItemType` types. The six rules, `draft-confirmed`, `estimate-changed`, `story-removed`, `possible-renumber`, `customer-copy-changed` and `settings-changed`, are in `storyMapRules`, though `validate` never reports them. `hasStoryMapChanges` is now true when only `needsPerson` has items, such as when a setting is set to its default.
- `StoryMapIssue` has a required `rule`, and `StoryMapCheckIssue` adds `help`. A warning's `rule` is its `kind`. The `--format json` `version` stays 1, since the fields are additions.
- Links go to the repository's own `docs/story-map.md` when it has the heading, otherwise to the guide on GitHub at the installed version's tag. `storyMapRules`, `storyMapRuleIds`, `storyMapRuleHelp`, `storyMapRuleLinker` and `isStoryMapRuleId` are exported, and `getStoryMapActions` takes a `help` option. Action groups gain `rule` and `help`.
- Text output and annotation titles change, so scripts that compare them exactly should match on `rule` instead.
- New property tests in `test/audience-edits.property.test.js` generate maps, filters and edits, and check that the customer view and page never show internal work, that `edit`, `add` and the local edit server change only what they name and keep every ID, draft and comment, and that `story-map diff` lists exactly the stories that changed. Set `FC_NUM_RUNS` for a longer run.

### Upgrade review

- **Record the version each set-up part came from:** `story-map init` now records the package version and a hash of the text it wrote in each part it sets up: in the `AGENTS.md` start marker, as `<!-- auto-story-map:start 0.7.11 sha256:… -->`, and as a comment on the first line of `docs/story-map.md` and `.github/workflows/story-map.yml`. A later upgrade review uses them to tell your edits from the package's changes. Parts set up earlier, with no version, still work as before. See [What the set-up markers mean](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#what-the-set-up-markers-mean).
- **See which parts of your set-up are behind:** `story-map upgrade` lists the story map section of `AGENTS.md`, the guide, the CI workflow, the skill and the choices in the map's `settings`, with each one's state (not added, current, outdated, edited, edited and outdated, not chosen or chosen), the version it came from and what this version changes. Workflow steps are compared by the commands they run, so a missing step shows as an addition. It writes nothing. `--format markdown` gives a table for a pull request and `--format json` gives agents each part with its diff. See [Review the set-up after an upgrade](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#review-the-set-up-after-an-upgrade).
- **Read what changes in plain words:** `story-map upgrade` now opens with a short overview for the people who use the set-up. On install it says how the set-up works. On upgrade it says what changes for the team since the version each part came from, covering only the parts the review would apply, and names the parts you edited that are kept and the choices still to make. It is in the text and Markdown output, and in the JSON as `overview`. The lines come from `templates/changes.yaml`, which covers the changes to `AGENTS.md`, the guide and the workflow since 0.7.0. See [Review the set-up after an upgrade](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#review-the-set-up-after-an-upgrade).
- **Remind hosts whose set-up falls behind:** `story-map validate` prints one `setup-behind` notice when the `AGENTS.md` section, the guide or the CI workflow comes from an older version whose template has changed since, naming each part and pointing to `story-map upgrade`. It never fails validation, even with `--strict`, and stays quiet for parts that are current, missing, or from before 0.7.11 and still match an unchanged template. See [What the set-up markers mean](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#what-the-set-up-markers-mean).
- **Review the AGENTS.md section rule by rule:** each rule in the `AGENTS.md` templates now has a `<!-- rule: <id> -->` marker on the line before it. `story-map upgrade` compares an outdated or edited section rule by rule: rules you never changed are updated, rules you reworded or added are kept, rules you removed stay removed, and each reworded rule this version also changes is listed with this version's wording beside it. Sections from before 0.7.11, with no markers, are compared through the known rules of each earlier release. See [Review the AGENTS.md section rule by rule](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#review-the-agentsmd-section-rule-by-rule).
- **Apply the recommended changes:** `story-map upgrade --mode simple --write` replaces the parts you never edited, adds missing parts and missing workflow steps, updates the rules of an edited `AGENTS.md` section that you left as the package wrote them, and keeps every edit of yours: reworded rules, your own rules and headings, and any other part you edited. It asks the product choices nobody has made, at a terminal, and records only the answer given. Agents get the questions listed instead, and pass the person's answer with `--plans` and `--story-ids`. `--apply <parts>`, such as `--apply guide,workflow`, applies only the parts you accept, replacing even edited ones. Without `--write` it is a dry run. A run with nothing to apply writes nothing, and the files it writes carry this version's markers, so the `validate` reminder goes quiet. `story-map settings --story-ids next|lowest-free` records the story ID policy. See [Apply the changes](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#apply-the-changes).
- **Choose simple or advanced upgrades once:** the map's `settings.upgrade` keeps the person's choice of `simple` or `advanced` mode, and `story-map upgrade` runs in it. Left out, agents get the question with the report, and ask the person and record their answer with `story-map settings --upgrade simple|advanced`. At an interactive terminal, the review asks itself, and in advanced mode walks through each part that would change, with its diff, asking whether to take it. `--mode` overrides the setting for one run, and `story-map diff` lists a change to it. The `AGENTS.md` template gains the `choose-upgrade-mode` rule. See [Choose simple or advanced mode](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#choose-simple-or-advanced-mode).
- **Choose the set-up parts at install:** `story-map init` now prints how Auto Story Map works and the list of parts before it writes them. Simple mode, the default, adds every part, as before. `--mode advanced` with `--apply <parts>`, such as `--apply agents,guide`, adds only the parts you choose, and asks which at a terminal without `--apply`. The delivery plans and story ID choices are asked at a terminal, or listed for an agent to put to the person and pass with `--plans` and `--story-ids`. In a repository that is already set up, `init` hands over to `story-map upgrade` and writes nothing. See [Choose the parts at install](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#choose-the-parts-at-install).

**For developers**

- The package ships `templates/known-versions.json`, the hash of each set-up template from every earlier release, so parts set up before versions were recorded can be matched to the release they came from. `npm run known-versions` writes it from the release tags, and the release workflow stops when the committed file is out of date.
- `readSetupFileVersion`, `stampSetupFile`, `loadKnownSetupVersions`, `knownSetupVersionsFrom`, `setupBody`, `setupBodyHash`, `hasAgentsSection` and `setupParts` are exported, with the `SetupPart`, `SetupFileVersion`, `KnownSetupVersions` and `ReleasedSetupTemplate` types.
- `upgradeReport`, `describeUpgradeState`, `isUpgradePartBehind`, `workflowCommands` and `upgradePartIds` are exported, with the `UpgradeReport`, `UpgradePart`, `UpgradePartId`, `UpgradePartState`, `UpgradeRecommendation` and `UpgradeReportOptions` types.
- `init` compares an existing guide and `AGENTS.md` section with this version's by their body, so a stamped copy counts as up to date.
- `templates/known-versions.json` gains `rules`, the hash of each `AGENTS.md` rule from every earlier release. `npm run known-versions` fails when an earlier template has a rule with no ID. The `agents` part of `upgradeReport` has `rules`, each an `AgentsRuleReview`. `reviewAgentsRules`, `summariseAgentsRules`, `agentsRules`, `agentsRuleIds`, `isAgentsRuleId`, `agentsSectionBlocks`, `agentsRuleHash` and `templateRules` are exported, with the `AgentsRuleReview`, `AgentsRuleState`, `AgentsRuleRecommendation`, `AgentsRuleId`, `AgentsRuleInfo`, `AgentsRuleForm`, `AgentsSectionBlock` and `KnownAgentsRules` types.
- `findSetupBehind(root)` returns the set-up parts that are behind the package, and `isSetupPartBehind`, `currentSetupTemplateHashes`, `setupBehindMessage` and `setupPartPaths` are exported, with the `SetupPartBehind` and `FindSetupBehindOptions` types. `checkStoryMap` returns the new notice, so `notices` can be 2.
- The package ships `templates/changes.yaml`, and a test fails when a template changes without a line in it for the next release. `upgradeOverview`, `upgradeOverviewLines`, `loadSetupChanges`, `parseSetupChanges`, `setupChangeParts` and `maxOverviewLines` are exported, with the `UpgradeOverview`, `SetupChanges` and `SetupChangePart` types, and `UpgradeReport` gains `overview`. `upgradeReport` takes a `changes` option.
- `findSetupBehind` no longer counts an edited workflow that already runs every step this version's does, so the `validate` reminder and `story-map upgrade` agree on it.
- `applyUpgrade({ root, map, mode, parts, answers, write })` applies the review and returns an `UpgradeApplyResult`, and `mergeAgentsSection`, `addWorkflowSteps`, `parseUpgradeParts`, `replaceAgentsSection`, `upgradeTemplates`, `runCommands` and `UpgradeApplyError` are exported, with the `UpgradeAnswers`, `UpgradeApplyMode`, `UpgradeApplyOptions`, `UpgradeChange`, `UpgradeChangeAction`, `UpgradeQuestion` and `UpgradeTemplates` types. `stampSetupFile` takes an optional template hash. The edit operations gain `story-ids`, which records `settings.storyIds`.
- `UpgradeReport` gains `mode`, from `settings.upgrade`, or `modeQuestion` when it is not set, and `upgradeModeQuestion` and the `UpgradeMode` type are exported. `UpgradeAnswers` gains `upgrade`, `UpgradeApplyResult` gains `modeRecorded`, and advanced mode accepts an empty `parts` to keep every part. `StoryMapDiff` gains `upgrade`, and the edit operations gain `upgrade-mode`.

### Rules in CI and claim checks

- **Check pull requests for map rules in CI:** the new `story-map pr-check <base-ref>` fails a pull request whose agent-written commits make a change only a person should make, such as confirming a draft, setting an estimate or changing customer copy, unless a person approves it with `--approved`. A commit is an agent's when its author is a bot or a `Co-Authored-By` trailer names a known agent, such as Claude or Codex. With `--body-file`, it also fails when the pull request marks a story merged without a **Tokens used** section that names the story or says why there is no count. Problems are reported as `validate` reports them, in text, GitHub annotations or JSON, with a rule and a guide link. The workflow from `story-map init` runs it on every pull request that changes the map, and again when the description or labels change, approving when a person adds the `map-approved` label. `story-map upgrade` adds the step to existing workflows. This repository runs it in a new `Map rules` workflow. See [Check a pull request in CI](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#check-a-pull-request-in-ci).
- **Claim from parallel worktrees:** agents in worktrees of one clone can now claim stories at the same time. Worktrees share their clone's refs, so two reads of the claims at once could collide on a ref lock, and `story-map claim` failed with `Could not read claims` and exit 1 instead of winning or exiting 3. The read now tries again when that is the only problem. See [Coordinate several agents](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#coordinate-several-agents).

**For developers**

- `checkPullRequest`, `commitAgent`, `tokensUsedSection`, `knownAgentNames`, `prCheckRules` and `needsPersonLabels` are exported, with the `PrCheckOptions`, `PrCheckResult`, `PrCheckIssue`, `PrCheckCommit` and `PrCheckAgentCommit` types. `storyMapRules` gains `missing-tokens-used`, which only `pr-check` reports. The workflow template gains the pr-check step and `edited`, `labeled` and `unlabeled` pull request types.
- A model-based fast-check test, `test/claims.model.test.js`, runs random claims, renewals, take-overs, releases and expiries by three agents against a temporary Git remote and a `--store` folder, including two or three agents calling at once, and checks the claims against a simple model after every step: at most one claim per story, refusals that name the holder, expiry that frees the story and take-overs that record the new holder. It found the worktree bug above. `FC_NUM_RUNS` runs more cases.

### Review and architecture

- **Review before ready and record architecture decisions, in hosts:** the `AGENTS.md` template gains two rules. `review-before-ready` asks agents to review each pull request's diff with an explicit target before it is ready, such as `/code-review <PR number>` in Claude Code, starting from the story, and to record the review and its own cost in the description's **Review** section. A person's review also counts, and the rule says review does not replace CI. `architecture-decisions` asks agents to answer four questions, where the work runs, who consumes it, which boundaries it touches and how to undo it, in the plan or on an **Architecture** line in the pull request, and to leave a consequential decision for a person to agree. `init --skill` hosts get the short `skill-review-before-ready` and `skill-architecture-decisions`, and the skill gains a review section. The guide has new sections, [Review a change before it is ready](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#review-a-change-before-it-is-ready) and [Record architecture decisions](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#record-architecture-decisions), and the parts of a plan gain `## Architecture decisions`. `story-map plan` scaffolds that section with the hints `validate` reports until they are answered. The upgrade review offers both rules, and simple mode adds them even to an edited section. When a run adds `architecture-decisions` and the map has no `settings.architectureDecisions`, it records `required`, so open plans without the section get warnings, which fail with `--strict`. `init` sets it in new starter maps that take the rules. See [Upgrade to 0.7.11](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-0711).
- **Warn when a ready pull request has no review recorded:** `story-map pr-check` takes `--draft true|false`. With `--body-file` and `--draft false`, a pull request that is ready for review gets a `missing-review` warning when its description has no **Review** section, or only the template's labels and comments. Drafts are never warned, and without `--draft` nothing changes. `--strict` makes `pr-check` fail on warnings. The result gains `checkedReview`. The workflow from `story-map init` does not pass `--draft` yet. See [Check a pull request in CI](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#check-a-pull-request-in-ci).
- **Check the architecture section in plans:** `validate --plans`, and `validate --check-sources` once `settings.plans` names a folder, report an open plan, one whose status line starts with proposed, planned or in progress, that has no `## Architecture decisions` section, an empty one, one that still holds the scaffold's placeholder hints, or a `None:` answer with no reason after `because`. The rule is `plan-architecture-section`. It is a notice, so hosts with open plans see it after upgrading and nothing fails, even with `--strict`. A map that sets the new optional `settings.architectureDecisions: required` gets warnings instead, which fail with `--strict`. Record it with `story-map settings --architecture-decisions required|recommended`, and `story-map diff` lists a change to it under **Settings**. Hosts with `settings.plans: false` see nothing from `--check-sources`, which then reads no plans. The JSON output stays at `version: 1`. See [Check the architecture section in plans](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#check-the-architecture-section-in-plans).
- **Warn when a ready pull request answers no architecture questions:** in a map with `settings.architectureDecisions: required`, `story-map pr-check` with `--body-file` and `--draft false` gives a `missing-architecture` warning when the description has no **Architecture** line, an empty one, or a `None:` answer with no reason after `because`. A reason that wraps onto the next line counts, and HTML comments and code fences are ignored. Maps that only recommend architecture decisions, drafts and runs without `--draft` see nothing, and the workflow from `story-map init` does not pass `--draft`. The result gains `checkedArchitecture`. See [Check a pull request in CI](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#check-a-pull-request-in-ci).
- **Know when to review the architecture:** the guide has a new section that names four points to review the architecture: planning, code review, release planning and a scheduled audit. It says size and complexity prompt a look, not a refactor, and that a refactor story needs evidence of its cost from Git and review history, such as conflicting edits, regressions, one file changed across unrelated stories, review findings that keep coming back and rules that work around the code. The story names that cost and how the team will tell it improved. Hosts that already have the guide get it through the upgrade review. See [When to review the architecture](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#when-to-review-the-architecture).
- **Count part of a story's tokens:** `story-map tokens` takes `--since <time>` and `--until <time>`, such as `2026-11-20T10:42:00Z`, to count only the responses made in that range, such as a pull request's review. With a range, `--format markdown` prints a **Review cost** line for the Review section instead of the Tokens used section, and the text output says not to record it as the story's total. `countStoryTokens` takes `since` and `until` as `Date`s, and `StoryTokenUsage` gains `since` and `until`. `UpgradeApplyResult` gains `architectureDecisionsRecorded`, and its `changes` gain an entry with `part: "agents"`, the map's `path` and `setting: "architectureDecisions"` when the run adds the rule. It is `record`, or `keep` when the map has problems, which the run then leaves as they are without stopping the rest of the upgrade.
- **Write story summaries people can read at a glance:** the guide has a new section, [Write a story summary](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#write-a-story-summary). It says a summary is written for someone who doesn't know the code and answers four questions in order: what changes and for whom, why now, when it is done and what it leaves out, with a new line at least every 180 characters and for each new long sentence. The `AGENTS.md` template gains the rule `write-story-summaries`, which the upgrade review offers. The story, release and persona panels now show each line of a summary written over several lines as its own `.esm-detail-summary-line` block, with 6px between lines, and `.esm-detail-summary` is slightly smaller, at `.9375rem`. In the story panel, the rows under the summary, starting with **For**, sit 24px below it, up from 16px, and the **For** row's persona chips have 8px more space under them, before **Jobs**. A one-line summary renders as before. Hosts can restyle both classes.

**For developers**

- This repository lints with Biome in CI (`npm run lint`), fails CI when test coverage of `src` drops below a floor that only goes up, runs CodeQL's security-and-quality queries, shares one regular-expression escape helper across the code, and has a test that fails when Biome's complexity warnings grow past a ceiling. None of this changes the package's behaviour.

### Agent briefs

- **Write agent briefs from the command line:** `story-map brief` prints the same handoff brief as the board's **Copy brief**, for one or more stories, a release with `--release <ID>` or an activity's open stories with `--activity <ID>`. Its in-flight section adds what `story-map evidence` finds for each target, such as open branches and commits on the default branch that change code, and claims with `--claims`. Commits that change only the map or plans are counted, not listed. `--no-evidence` leaves Git out. `--full` adds notes, persona context, job statements and every tagged test, and `--format json` prints the brief with its scope, targets, branch and sections. The MCP server has a new `get_brief` tool that returns the same JSON. In code, `storyMapBrief` takes `{ stories }`, `{ activity }`, `full` and `evidence`, and the new `storyMapBriefDetails` returns the brief with its parts. See [Write a brief from the command line](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#write-a-brief-from-the-command-line).

### Board

- **Show shipped stories in one lane:** internal boards with search and filters have a **Shipped as Released** switch in the toolbar, off by default. Turned on, it moves every shipped story into one **Released** lane at the top of the board, under its activity, and hides the releases it empties, so you can see everything live for a persona without scrolling lane by lane. Each story keeps its release in its panel, permalink and brief, and exports and the customer view are unchanged. `readStoryMapFilters` reads `released=1`, and `StoryMapFilters` and the view's `filter` gain an optional `released`, for internal views only. `board.js` applies the switch as soon as it changes. Hosts can restyle `.esm-released-switch`. See [Show shipped stories in one lane](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#show-shipped-stories-in-one-lane).
- **See delivery totals in an Analytics tab:** Internal boards have a new tab, **Analytics**, after **Story map**, **Personas** and **Actions**, at `?view=analytics`. It shows the stories, points, tokens and spend completed each UTC day, week or month, for the last 8 days, 8 weeks or 6 months, with totals, a bar chart of one measure and a table. **Completed when** counts merged or shipped stories, or shipped only. Completion times come from the status history file, and a reopened story counts once, at its latest completion. Values are each story's today, and missing estimates and tokens show as coverage, such as “1 of 3 estimated”, never as zero. Without a history file, the tab explains how to add one. `storyMapAnalytics` exports the same calculation. Internal viewers only. See [See delivery totals](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#see-delivery-totals). The toolbar under the tabs, on every tab, has more room above it: `.esm-toolbar` padding is `24px 18px 16px`, up from `14px 17px`, and narrow screens keep `12px`.
- **Change a story from an Actions menu in its panel:** the story panel's **Change** section, with its status, reason and release pickers, moves into an **Actions** menu beside **Share** at the top of the panel. On `story-map preview`, **Save** writes the change as before. On every internal board, **Copy command** copies the matching `story-map edit` command without showing it, then closes the menu. A menu that can neither save nor copy stays hidden, and on narrow screens the panel buttons move to their own row above the title. `.esm-change-menu` replaces `.esm-change-section`, and `.esm-change-command` is gone, so hosts that restyled them need to update their CSS. Internal viewers only. See [Change a story from the board](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#change-a-story-from-the-board).
- **Scroll the board with the page:** the map's grid no longer scrolls in a box of its own inside a page that also scrolls, so there is one scroll bar each way. The activity titles stick to the top of the window and the release column to its left, and a board wider than the window scrolls the page sideways. `--esm-board-height` no longer has a default. A host that sets it to a length, such as one with a fixed header, keeps the grid in a box of that height, but now only with `board.js`, which reads it. The headings stick to the nearest parent that scrolls, so a host whose page wraps the board in an element with `overflow: auto` or `hidden` should remove it or set `--esm-board-height`. See [Integrate with a product](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#integrate-with-a-product).

### Tests linked to stories

- **Tag a describe block for all its tests:** A story ID at the start of a `describe` or `suite` name now links every test inside it, including tests in nested blocks, so renaming a test no longer unlinks it from its story. A test that names its own story inside a tagged block counts for both. This applies to `story-map tests`, `validate --tests`, `story-map evidence` and `story-map actions`. The story panel lists those tests under the story, marked “Covered by its group”, and the tests index marks the IDs each test has from its block in a new optional `inheritedIds` field, which older boards ignore. An unknown ID in a block's name is reported once, at the block. Internal viewers only. See [Link tests to stories](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-tests-to-stories).

### Fixes

- **Check for missing values instead of assuming they are there:** the 181 places in the code that assumed a value was present without checking now check for it. Where a value comes from the map, a host's setup files or a command's arguments, the code keeps the existing message or skips the part it cannot read, such as `story-map upgrade` keeping a section whose markers it cannot read. Where a missing value can only mean a bug, the error says `Internal error: … is missing` and asks for a report. Valid maps behave as before. Biome's `noNonNullAssertion` rule is now an error, so `npm run lint` fails on a new `!` assertion.
- **Keep export file names fast on crafted titles:** export file names are built in linear time from a map title or file name with long runs of hyphens, so a crafted title can no longer slow the export route.

## 0.7.6

0.7.6 lets people triage the map without editing the YAML, and gives agents new ways into it.

- **See what the map is waiting for:** An **Actions** tab on the internal board lists the drafts to confirm, estimates to agree and gaps in the map, with the command that deals with each one.
- **Triage without the YAML:** Confirm an agent's drafts from the terminal, and change a story's status or release from its panel, saving straight to the map on the local preview.
- **Edit personas on your machine:** Add and reword personas, and add, reword and delete their jobs, on the Personas tab, on the local preview or in your own app running locally.
- **Prioritise stories:** Tag stories as must, should or could have.
- **See which stories are ready to start:** Each planned story says whether the stories it depends on have landed.
- **Give agents the map:** Agents can use the map through an MCP server or an installable skill, and draft a first map for an existing repository from a survey of it.
- **Take the map into Spreo:** The Export menu has a guide to building a Spreo board from the map.
- **Keep titles in view:** Activity and release titles stay on screen as you scroll the board.

Nothing needs an upgrade step: existing maps, history files and host code keep working, and everything new is optional. The board now scrolls in its own box, no taller than the window. A host with a fixed header or a taller footer sets `--esm-board-height` on `.esm-board`, or sets it to `none` to scroll with the page as before. `story-map preview` no longer lists warnings above the board, because the Actions tab shows them.

Hosts that copied the `AGENTS.md` template can copy its new paragraph on `story-map actions`, and its changes on the survey and `story-map confirm`, from `node_modules/auto-story-map/templates/AGENTS.md`. To edit personas in their own app running locally, hosts add a save route with `createStoryMapEditServer`, as [In your own app](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#in-your-own-app) describes.

### Actions tab

- **See what the map is waiting for:** The internal board has an **Actions** tab beside **Story map** and **Personas**. It lists everything the map is waiting for, such as drafts to confirm, estimates to agree and stories that serve no job, says who can act on each, and copies the command that deals with it. Story and release panels show their own actions, and agents get the same list from `story-map actions`. Customers never see actions.

**For developers**

- Internal boards have an **Actions** tab next to **Story map** and **Personas**. It lists what validate warns about in one table, with each action's type as a badge coloured by category: gaps, drafts to confirm, estimates, tests and the rest. Each row says who can act, links to its story, release or persona, and shows the problem and its line, and a **Copy** button copies the command that fixes it. Tick several rows to copy their commands at once, one per line. Columns run Category (persona, story, release or map), Item, Problem, Action and Line. One row of filters, a category switch, action and release dropdowns and **Needs a person**, narrows the table, with counts, with links that work without JavaScript. Story and release panels show their own actions. `story-map actions` prints the same list for agents and people at a terminal, and `validate --format json` gives each warning a `kind`. Pass `mapFile` to `getStoryMapPage` to show each action's line. Customers never see actions. `story-map preview` no longer lists warnings above the board, since the tab shows them. See [See what the map is waiting for](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#see-what-the-map-is-waiting-for).

### Triage without the YAML

- **Confirm drafts from the command line:** When a person has reviewed a job, a persona's context or an impact item that an agent drafted, `story-map confirm` shows it as the board does and, once they type its ID back, removes its `draft: true`. Agents can show a person the draft but never confirm it.
- **Change a story from the board:** A story's panel has a **Change** section to pick a new status, reason or release. It gives the matching command to copy into a terminal or an agent's chat.
- **Save changes from the local preview:** On `story-map preview`, the **Change** section saves the new status or release straight to the map file. Deployed boards stay read-only.

**For developers**

- New `story-map confirm <job | persona | release --impact <n>>` and `story-map confirm --all-in <persona>` print each draft as the board shows it, then the line diff and the `story-map diff` summary, where it shows under “Confirmed”. `--write` removes only the `draft: true` line, after the person types the ID back, and refuses when standard input is not a terminal, so agents cannot confirm a draft. `--format json` never writes.

  New export `proposeDraftConfirmation(source, target)`, which returns the drafts and the same result as `proposeStoryMapEdit` without writing. See [Confirm a draft](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#confirm-a-draft).
- Internal story panels have a **Change** section with status, reason and release pickers. The board does not save: it shows the matching `story-map edit` command, with each value quoted for the shell, and a **Copy** button, to paste into a terminal or an agent's chat. It needs `board.js`. Internal viewers only. See [Change a story from the board](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#change-a-story-from-the-board).
- On `story-map preview`, the story panel's **Change** section has a **Save** button that writes the new status, reason or release to the map file, through the same checks as `story-map edit --write`, then reopens the panel. The preview's edit route now accepts `status` and `release` operations beside persona edits, and still refuses a page older than the file, another origin, or a request without its token. `--read-only` turns it off. A host's board saves the same way with the new `storyEditing` prop, set from `createStoryMapEditServer`'s `read`. Deployed boards stay read-only. See [Save from the local preview](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#save-from-the-local-preview).

### Personas on your machine

- **Edit personas on your machine:** On a board running on your own machine, the Personas tab rewords a persona's title, summary, context and jobs where they are, adds and deletes jobs, and adds personas, saving each change to the map file. Rewording a draft keeps it a draft, and deployed boards stay read-only.
- **Set up personas from an empty tab:** A map with no personas still shows internal viewers the Personas tab, with an example of how to add them.

**For developers**

- A map without personas keeps the **Personas** tab for internal viewers. It shows an example `personas` list, how to tag stories with their jobs, and a link to the guide. See [Personas tab](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#personas-tab).
- On `story-map preview` and the example host, the Personas tab has **Edit** on a persona's title, summary, **Success means**, **Uses today**, **Constraints** and each job's statement, **Add job** and **Delete job** for jobs, and **+ Add persona**.

  Each save writes only the fields that changed, through the same edit as `story-map edit`, keeping comments and every untouched line, and refuses a change that would make the map invalid. New jobs and personas get IDs from their text and are not drafts. IDs, order, customer copy and `draft` are left alone. `story-map preview --read-only` turns editing off. See [Edit personas on your machine](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#edit-personas-on-your-machine).
- A host's board can now edit personas on the Personas tab, like `story-map preview`, while the app runs on your machine. `createStoryMapEditServer` gains `read(request)`, which reads the map on each request and returns edit props only for a loopback `Host` outside a production build, and `handleRequest(request)` for Fetch routes such as App Router, vinext, Remix, Hono and Workers. Its new `authorize` option is required, so a host decides who may edit: pass the same rule as the board's `canViewInternal`. An internal Personas tab opened from `localhost` without a save route notes that editing is not set up, with a link to the steps; `personaEditing={false}` skips the note. Deployed boards stay read-only. See [In your own app](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#in-your-own-app).

### Priorities

- **Tag stories as must, should or could have:** Internal cards show each story's priority as **MH**, **SH** or **CH**, so the team can see what a release cannot go without.

**For developers**

- Stories take an optional `priority` of `must`, `should` or `could`. Internal cards show it as an **MH**, **SH** or **CH** tag before the estimate, and the story panel lists it in full. Set it with `story-map edit <ID> --priority must`, or remove it with `--priority none`. `story-map story` and `story-map diff` show it. Internal viewers only. See [Prioritise stories](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#prioritise-stories).

### Readiness

- **See which stories are ready to start:** A planned or in-progress story's panel says whether it is ready to start, waiting for the stories it depends on, or at risk because one of them is cut, blocked or in a later release. It never changes a status.

**For developers**

- The board and the CLI work out from the `dependsOn` links whether each planned or in-progress story is ready to start, waiting for prerequisites that are not merged yet, or at risk because a prerequisite is cut, blocked or in a later release. The story panel shows it beside the status and at the top of its **Dependencies** section, `story-map story` prints it, `story-map stories --readiness ready|waiting|at-risk` filters by it, and the JSON export carries each story's `readiness` with its blocking prerequisites. Readiness never changes a status. Internal viewers only. See [See which stories are ready to start](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#see-which-stories-are-ready-to-start).

### Agent access

- **Serve the map over MCP:** Agents that call tools rather than run commands can read the map, check it, propose edits and claim stories through `story-map mcp`, with the same safeguards as the commands.
- **Install the rules as a skill:** `story-map init --skill` puts the story map rules in a skill, so agents read them only when a task needs them.
- **Survey a repository for its first map:** For a repository with months of history, `story-map survey` lists its releases, docs, open plans and `TODO` comments, for an agent to draft the first map from.

**For developers**

- `story-map mcp` runs a local Model Context Protocol server over standard input and output, for agents that call tools rather than run commands. Its tools, `list_stories`, `get_story`, `list_releases`, `validate_map`, `get_evidence`, `propose_edit` and `claim_story`, wrap the matching commands and return their JSON, with the same safeguards: edits are dry runs unless the call sets `write`, paths stay inside the repository, and there is no tool to confirm drafts. `--read-only` leaves out the tools that write. It needs `@modelcontextprotocol/sdk`, a new optional peer dependency that only this command loads. See [Serve the map over MCP](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#serve-the-map-over-mcp).
- `story-map init --skill` writes the story map rules and common commands to `.claude/skills/story-map/SKILL.md`, and gives `AGENTS.md` a short pointer to it instead of the full section, so agents read the rules only when a task needs them. Existing files are never overwritten. See [Populate the first map](https://github.com/duncan-m/auto-story-map/blob/main/README.md#populate-the-first-map).
- `story-map survey --format json` lists what an agent needs to draft a first map for a repository that already has history: release tags and `CHANGELOG.md` versions, with dates, as suggested releases; Markdown docs and their headings as candidate sources; and open plans and `TODO` and `FIXME` comments, with file and line, as planned work. It needs no map, reads and suggests only, and makes no network calls. The [first-run workflow](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#populate-the-first-map) now starts with it. See [Survey a repository](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#survey-a-repository).

### Spreo

- **Take the map into Spreo:** The board's **Export** menu opens a guide to building an interactive Spreo board from the map, with a prompt to copy into ChatGPT, Claude or Claude Code.

**For developers**

- The board's **Export** menu has a new item, *Spreo, guide to an interactive board*. It opens a guide, in a new tab, to building an interactive Spreo board from the map through Spreo's MCP server, from ChatGPT, Claude or Claude Code, with a prompt you can copy. Internal viewers only, as for the rest of the menu. See [Spreo](https://github.com/duncan-m/auto-story-map/blob/main/docs/integrations.md#spreo).

### Board

- **Keep activity and release titles in view:** On a map with several releases, the activity titles stay at the top of the board as it scrolls down, each release's name stays beside its lane, and the release column stays on the left as the board scrolls sideways, so every card keeps its activity and release in sight.

**For developers**

- The grid scrolls in its own box, no taller than the window less 7.5rem, so the activity row and the release column stay in view. Set `--esm-board-height` on `.esm-board`, such as `calc(100dvh - 12rem)`, for a fixed header or taller footer, or `none` to scroll with the page as before.

  With `board.js`, each release's name also stays beside its lane and the activity row shrinks to its titles while the board scrolls, staying full size while one of its controls has focus. Permalinks scroll their target clear of the pinned titles. New board.js export `enhanceStoryMapHeadings`. See [Integrate with a product](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#integrate-with-a-product).

## 0.7.5

0.7.5 makes it easier to hand work to coding agents and to keep the map in step with what they deliver.

- **Hand a story to an agent:** Open any story or release on the internal board and copy a ready-made brief for a coding agent, or open it in a new tab in Claude, ChatGPT or Claude Code with the brief already filled in.
- **Check a story against the code:** Agents can look up what the repository says about a story, such as the branches, commits and tests that mention it, and find merged stories that a release tag shows have shipped.
- **Run several agents on one map:** Agents claim a story before they start it, so two agents never start the same work.
- **See the build order:** Stories can say which other stories must land first, and the board shows it.
- **See what agent work used:** Stories can record the tokens an agent used to deliver them and an estimate of what that cost.

Nothing needs an upgrade step: existing maps, history files and host code keep working, and everything new is optional.

Hosts turn on agent briefs in internal story and release panels with the new `brief` option of `getStoryMapForViewer` or `getStoryMapPage`, and the **Open in** links with the new `webAgents` board prop.

Hosts that copied the `AGENTS.md` template can copy its new paragraphs on claims and tokens from `node_modules/auto-story-map/templates/AGENTS.md`.

### Agent briefs

- **Write a brief for a story or release:** A brief is a short prompt, written from the map, that tells a coding agent what to build and why: who it is for, what is already built nearby to reuse, what is planned but should not be built yet, the open questions and the repository's rules. It links to the plan and other files instead of copying them, so it stays small enough to paste.
- **Copy the brief from the board:** Internal story and release panels have an **Agent brief** section where you can read the brief, and a **Share** menu, in place of **Copy link**, with **Copy link** and **Copy brief**. Customers never see briefs.

**For developers**

- New `storyMapBrief(view, { story })` and `storyMapBrief(view, { release })` write a handoff brief for a coding agent from the internal map: a compact Markdown prompt with `<rules>`, `<target>`, `<context>`, `<in_flight>`, `<open_decisions>` and `<done_when>` sections.

  It lists the targets with their plan, personas and jobs, the delivered stories nearby to reuse, the planned stories nearby not to build yet, the tagged tests and changes that already name each target, draft jobs, missing estimates and plans, and blocked stories, and names the branch to create.

  Options `mapPath`, `readFirst`, `validateCommand`, `testCommand` and `baseBranch` fit it to the repository. Text from the map is escaped so it cannot close or add a section. A story brief stays under 4 KB and a release brief under 16 KB. Throws a `TypeError` for a customer or filtered view.

  New exports `storyMapBriefBranch`, `storyBriefMaxBytes`, `releaseBriefMaxBytes`, `briefBranchMaxLength` and `briefBuiltNearbyMaxItems`, and types `StoryMapBriefRequest`, `StoryMapBriefOptions` and `StoryMapBriefDocument`. See [Write a brief for an agent](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#write-a-brief-for-an-agent).
- New `brief` option for `getStoryMapForViewer` and `getStoryMapPage`. Pass `true`, or the options of `storyMapBrief`, and each planned, in-progress or blocked story, and each release with planned or in-progress stories, gets its agent brief as `brief` on the internal view.

  Briefs are written before the filters, so a search does not change them. Off by default, and never on customer views. The JSON export and the CLI's read commands leave `brief` out.
- Internal story and release panels with a brief have an **Agent brief** section, with a closed **Show the brief** block to read and select the brief, and a **Share** menu at the top right in place of **Copy link**.

  The menu holds **Copy link** and **Copy brief**, which board.js shows and wires up, saying what it copied, such as “Copied brief: ESM-111”. The menu's button says “Copied” after a copy, and Escape closes the menu without closing the panel. Panels without a brief keep the plain **Copy link**.

  New board.js export `enhanceStoryMapBriefs`, and classes `esm-brief`, `esm-brief-intro`, `esm-brief-details`, `esm-brief-text`, `esm-panel-menu`, `esm-menu-item`, `esm-menu-item-text` and `esm-menu-item-hint`. `story-map preview` and the demo turn briefs on. See [Copy a brief from the board](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#copy-a-brief-from-the-board).

### Open a brief in Claude, ChatGPT or Claude Code

- **Open a brief in Claude or ChatGPT:** When the product turns them on, the **Share** menu has **Open in Claude** and **Open in ChatGPT**. Each opens a new chat in a new tab with the brief already typed in, ready to talk through the work.

  A web chat cannot see the code, so this suits planning and questions. Both are off by default, because they send internal map content to Anthropic or OpenAI. If a brief is too long to fit in the link, the board copies it and opens an empty chat for you to paste it into.
- **Start building in Claude Code:** **Open in Claude Code** opens a new Claude Code session on the web, in a new tab, with the brief filled in and the product's GitHub repository chosen, so the agent can read and change the code rather than only discuss it. Anthropic does not document this link, so if it changes, the link still opens Claude Code but without the brief or repository.

**For developers**

- New `webAgents` board prop, such as `webAgents={["claude", "chatgpt"]}`, adds **Open in Claude** and **Open in ChatGPT** to each **Share** menu, starting a new web chat with the brief filled in. Off by default, because it sends internal map content to those companies.

  When the link would be longer than 8,000 characters, it opens an empty chat and board.js copies the brief first.

  New exports `storyMapWebAgents` and `webAgentLinkMaxLength` and type `StoryMapWebAgent` from `auto-story-map/react`, and class `esm-menu-agent`. The demo turns both on. See [Open a brief in a web agent](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#open-a-brief-in-a-web-agent).
- `webAgents` takes `"claude-code"`, which adds **Open in Claude Code** to each **Share** menu. It starts a new Claude Code session on the web, at `https://claude.ai/code`, with the brief filled in, in the repository from `repositoryUrl` when that is a GitHub address, passed as `repo=<owner>/<name>`.

  Anthropic does not document these parameters, so if they change, the link opens Claude Code without the prompt or repository.

  New type `StoryMapWebAgentInfo`, and `storyMapWebAgents` entries gain `opens` and `repository`. The demo turns it on. See [Open a brief in a web agent](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#open-a-brief-in-a-web-agent).

### Evidence for a story

- **Look up the evidence for a story:** `story-map evidence` lists what the repository says about a story: the branches, commits, plans and tests that mention it, any links in its sources that are broken and, with history, whether it has stalled.

  It then suggests what the story's status should be, such as merged once its work has reached the main branch. It only suggests: it never changes the map, so a person or agent decides.
- **Find stories that have shipped:** Stories often stay at merged after their release goes out. For products that tag their releases, `--shipped-tags` checks whether a merged story's work is in a release tag, then suggests marking it shipped and names the release it went out in.

**For developers**

- New `story-map evidence [<ID> ...]` reports, for each story or every active story, the branches whose names contain its ID, the commits on the default branch that mention it, the Markdown lines that mention it, its tagged tests, its broken sources and, with `--history`, whether it is stalled.

  It suggests a status with its reasons and changes nothing. A commit suggests `merged` only when its title names the story and it changes more than Markdown, the map and files under `--plans`. It never suggests moving a story back from merged or shipped, never changes a cut story and never suggests shipped.

  Takes `--format json`, `--default-branch`, `--plans`, `--tests`, `--history`, `--map` and `--root`. See [Look up the evidence for a story](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#look-up-the-evidence-for-a-story).
- `story-map evidence --shipped-tags <pattern>`, such as `--shipped-tags 'v*'`, suggests `shipped` for a merged story whose merging commit is in a Git tag that matches the pattern, and names the earliest such tag as `shippedIn`, so stories stop waiting in merged after a release goes out.

  Opt-in: without it, evidence never suggests shipped. The pattern goes to `git tag --list` as an argument, never through a shell. New option `shippedTags` for `gatherStoryEvidence` and type `EvidenceTag`. See [Suggest shipped from release tags](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#suggest-shipped-from-release-tags).
- New export `gatherStoryEvidence(source, options)`, which takes the map's source text and throws `StoryMapValidationError` for an invalid map, with `StoryEvidenceError`, `evidenceItemsMaxItems`, `evidenceTextMaxLength` and types `StoryEvidence`, `StoryEvidenceOptions`, `StoryEvidenceResult`, `EvidenceBranch`, `EvidenceCommit`, `EvidenceMention` and `EvidenceTest`.

### Claims for several agents

- **Claim a story so several agents do not clash:** When a team runs several coding agents from one map, each agent claims a story with `story-map claim` before it starts. If another agent already holds it, the second agent is told who has it and until when, and picks something else.

  A claim runs out after 4 hours unless the agent renews it, so an agent that stops does not hold a story for ever. Claims are kept in Git, never in the map file, and teams with one agent can ignore them.

**For developers**

- New `story-map claim <ID> --agent <name>` records that an agent is on a story, before any branch or pull request exists, so a second agent is told before it starts the same work. Each claim is a Git ref, `refs/story-map/claims/<ID>`, on `origin` or `--remote <name>`, pointing at a parentless commit whose message is the claim as JSON.

  The push only succeeds when the ref does not exist, so of two agents claiming at once exactly one wins, and the other exits 3 and is told who holds the claim, on which branch and until when.

  Claims last 4 hours, or `--ttl`, such as `30m` or `2d`, up to 30 days. `--renew` extends your own claim and `--take-over` replaces an expired one, both leasing against the claim that was read.

  Stories that are not in the map, or are merged, shipped or cut, cannot be claimed. The map is never changed. See [Coordinate several agents](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#coordinate-several-agents).
- New `story-map claims` lists claims, marking expired ones, and `story-map unclaim <ID>` releases one, refusing another agent's claim when `--agent` is given. All three take `--format json`.
- `--store <dir>` keeps claims as files in a folder inside the repository instead, using exclusive file creation for the same guarantee, for agents on one machine that cannot push refs.
- `story-map evidence --claims` adds each story's claim to its evidence and reports a claim on a merged, shipped or cut story as stale. `--claims-remote` and `--claims-store` read them from elsewhere. New option `claims` for `gatherStoryEvidence`, type `EvidenceClaim`, and `claims` in `checked`.
- Claims hold an agent name, never a person: the commit is credited to `story-map`, and an agent name that looks like an email address is refused.
- New exports `claimStory`, `listStoryClaims`, `releaseStoryClaim`, `parseClaimTtl`, `describeClaim`, `claimTime`, `StoryClaimError`, `StoryClaimHeldError`, `claimRefPrefix`, `defaultClaimTtlMs`, `claimTtlMaxMs`, `claimAgentMaxLength` and `claimBranchMaxLength`, and types `StoryClaim`, `StoryClaimOptions`, `StoryClaimSource`, `ClaimStoryOptions` and `ClaimStoryResult`.
- The agent instructions from `story-map init` ask agents to claim a story before they start it when their team uses claims.

### Story dependencies

- **Show what a story depends on:** A story can list the stories that must land before it. Its card shows how many of those are not yet delivered, and its panel lists the stories it waits for and the stories waiting for it, each with its status, so the build order is clear without reading every story's notes.

  Validation catches mistakes, such as a story that depends on itself or stories that wait on each other in a loop. Customers never see dependencies.

**For developers**

- Stories can list the stories they depend on in a new optional `dependsOn`, up to 10 story IDs. Validation rejects unknown, repeated and self dependencies and cycles, and warns when a story depends on a cut story. See [Record dependencies](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#record-dependencies).
- Internal cards show how many stories they depend on, to the right of the status, counting only those not yet merged or shipped, so a card whose dependencies are all delivered shows no count.

  The story panel counts every dependency and shows a Dependencies section listing the stories it depends on and the stories waiting for it, with their status and release, each opening its panel. Customers never see dependencies.
- Internal views give each story `dependsOn` and `dependents`, each a list of `StoryDependency` with the story's ID, title, status and release, so they stay complete when a filter hides those stories. The JSON export and `story-map story` include them. New export `storyDependsOnMaxItems`.
- `story-map edit` takes `--add-dependency` and `--remove-dependency`, `story-map add` takes `--dependency`, and `--from` takes the `add-dependency` and `remove-dependency` ops and `dependsOn` on `add`. `story-map diff` shows dependencies added and removed.

### Tokens used to deliver a story

- **Record the tokens used to deliver a story:** In the pull request that finishes a story, `story-map tokens` counts the tokens Claude Code used on it, from the logs on that machine, and estimates their cost at the API's list prices. Both are recorded on the story and shown in its internal panel, so the team can see what agent work on each story used.

  The cost is an estimate, not what was billed. Agents other than Claude Code can record the figures their own tools report. Customers never see them.

**For developers**

- Stories can record the model tokens used to deliver them in a new optional `tokens`, a whole number, set in the pull request that finishes the story.

  The internal story panel lists it as **Tokens used**, `story-map story` prints it, the JSON export carries it, and `story-map diff` shows a change as “Tokens used: none → 4,348,638”. Customers never see it. See [Record the tokens used on a story](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#record-the-tokens-used-on-a-story).
- New `story-map tokens <ID>` counts the tokens Claude Code used on a story from its session logs on this machine: every response on a branch whose name contains the story ID, or on a `--branch` or in a `--session` given, each response once, subagents included.

  It prints input, output, cache-write and cache-read tokens and their total, and the edit that records it. `--format markdown` prints a **Tokens used** section for the pull request, and `--format json` the counts.

  It changes nothing, makes no network calls and exits 1 when it finds nothing. `--logs` reads another folder than `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`.
- Stories can also record `estimatedCostUsd`, the estimated cost of those tokens in US dollars, shown as **Estimated cost** in the internal story panel and in `story-map story`, the JSON export and `story-map diff`.

  `story-map tokens` works it out per response from the model the log names, at API list prices built in and dated in `defaultTokenPricesDate`, with cache writes priced by duration and fast mode at twice the price. `--prices <file>` replaces the built-in prices. Tokens from models with no price are named and left out of the cost.
- `story-map edit` takes `--tokens <n>` and `--estimated-cost <usd>`, and `--from` takes the `tokens` and `estimated-cost` ops.
- New exports `countStoryTokens`, `branchNamesStory`, `defaultClaudeLogs`, `defaultTokenPrices` and `defaultTokenPricesDate`, and types `StoryTokenOptions`, `StoryTokenUsage`, `TokenCounts`, `TokenCost`, `TokenPrice` and `TokenPrices`.
- The agent instructions from `story-map init` ask agents to record the tokens and estimated cost in the pull request that finishes a story.

### Fixes

- `story-map story` leaves a space after labels as long as the label column, so “Updated by:” no longer runs into its value.

## 0.7.4

0.7.4 lets agents and people work with the map from the command line, says who each story is for, and links each story to the code that delivered it. There are no 0.7.2 or 0.7.3 releases: 0.7.4 follows 0.7.1 and brings together the work planned as 0.7.2 to 0.7.4, with effort estimates planned for 0.7.6.

- **Work with the map from the command line:** Read, search and change the map with commands instead of editing the file by hand, and preview it as a board before adding it to the product.

- **Say who each story is for:** Describe the people the product serves and the jobs they need done, and see on the board which stories serve them and where the gaps are.

- **Estimate effort:** Give each story an estimate in story points, and see each release's total and how much is left.

- **Trace stories to code:** See the pull requests and commits behind each story, and share a link that opens the board on a story or release.

**The licence changes from Apache-2.0 to the GNU AGPL version 3 only.** Nothing else needs an upgrade step: existing maps, history files and host code keep working, and everything new is optional. Hosts that restyle `.esm-detail` should check the new panel position, and hosts that copied the `AGENTS.md` template can copy its new paragraphs from `node_modules/auto-story-map/templates/AGENTS.md`.

### Licence

- The project licence changes from Apache-2.0 to the GNU AGPL version 3 only (`AGPL-3.0-only`). Package metadata and the board footer use the new licence identifier.

### Read and change the map from the command line

- **Read the map from the command line:** `story-map story`, `stories` and `releases` show stories and releases with the same filters and search as the board, so agents look things up instead of reading the map file.
- **Get validation results as JSON:** `story-map validate --format json` lists each problem and where it is, so agents and scripts can act on it.
- **Change the map from the command line:** `story-map edit` and `add` change a story's status, release, sources and more, and `release-impact` adds an expected impact to a release. Each shows what would change and checks the result, and writes only when asked, keeping comments and every other line as they were.
- **Preview the map before adding the board:** `story-map preview` shows the map as a board on your own computer, as internal and customer viewers see it, so you can check a first map before adding the board to your product.

**For developers**

- New `story-map story <ID> [...]`, `story-map stories` and `story-map releases` read the map from the command line as text, or as JSON with `--format json`, so agents stop reading the YAML by hand.

  `stories` takes the board's filters: `--status` (with `stalled` and `all`), `--release`, `--activity`, `--query` and `--changed-within`, and hides blocked and cut stories unless asked, as the board does. All three take `--map`, `--history` and `--tests-index`. JSON stories have the same shape as the JSON export.

  An unknown story ID exits 1 and suggests close matches. New exports `findStories` and `getStories`, and types `StoryQuery`, `FoundStories` and `MissingStory`. See [Read the map from the command line](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#read-the-map-from-the-command-line).
- `story-map validate --format json` prints each map's result and every issue with its severity, file, line, column, YAML path, readable target, item ID and message. Exit codes are unchanged. New export `checkStoryMap`, which returns the same result without printing, and types `StoryMapCheckResult`, `StoryMapCheckIssue` and `StoryMapCheckOptions`.
- New `story-map edit <ID>`, `story-map add` and `story-map release-impact <release ID>` change the map as named edits, so agents stop editing the YAML by hand. `edit` sets `--status` (with `--reason` for blocked and cut), `--release`, `--activity`, `--title`, `--summary`, `--notes`, `--add-source`, `--remove-source` and, with `--customer`, customer copy.

  `--from <file>` applies a JSON list of edits, all or none. Each is a dry run that prints the YAML line diff, the `story-map diff` summary and the problems the edit introduces, until `--write`, which saves only a valid map. Comments and every untouched line are kept byte for byte.

  There is no delete, `release-impact` always adds `draft: true`, `add` never reuses an ID, and `--updated-by` is needed to set `updatedBy`. New exports `proposeStoryMapEdit`, `nextStoryId`, `StoryMapEditError` and `storyMapEditOperationSchema`, and types `StoryMapEditOperation`, `StoryMapEditOptions` and `StoryMapEditResult`.

  See [Change the map from the command line](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#change-the-map-from-the-command-line).
- `story-map add` numbers a new story one after the highest ID in the map, such as BILLING-205 after BILLING-204, whatever its release, and takes `--id` to choose one. `nextStoryId(stories)` does the same, and ignores its optional `release` argument. Existing IDs never change.

  See [Change the map from the command line](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#change-the-map-from-the-command-line).
- New `story-map preview [<map.yaml>]` serves the map as a board on `http://127.0.0.1:4173/story-map`, with internal and signed-in customer views, the JSON view and the export menu, so a team can check its map before adding the board to its product. It reads the map on every request and shows validation errors on the page.

  It listens on loopback only, refuses requests addressed to any other host, and takes `--port`, `--history`, `--tests-index` and `--source-base-url`. It needs `react` and `react-dom`, now listed as an optional peer dependency. See [Preview the map locally](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#preview-the-map-locally).
- New `story-map help <command>` prints just that command's options. A usage error now prints the usage for the command that was run, instead of every command's.

### Personas and jobs to be done

- **Define personas and their jobs:** The map can describe the people the product serves and the jobs they need done, each written as “When …, I want …, so that …”. Each story names the jobs it serves, and validation warns about jobs that no story serves.
- **Describe a persona's context:** A persona can say what success means to them, what they use today and the constraints they work under, so stories are planned around them. Only internal viewers see it.
- **Mark a core job:** A persona's first job is their core job, the one that matters most to them. The board labels it, and validation warns when no story serves it.
- **Write clearer job statements:** The guide asks for a situation that names the trigger and what makes it hard, and an outcome that names what is at stake, with a weak and a strong example.
- **Break a job into steps:** A job can list up to 6 steps in order, each pointing to the part of the map where its stories live, so you can see which steps have no stories yet.

**For developers**

- Maps can name the people the product serves, as `personas`, each with up to 8 `jobs` to be done written as job statements: `situation` (“When …”), `motivation` (“I want …”) and `outcome` (“so that …”), with `draft: true` for a job an agent drafted. Stories list the `jobs` they serve, and any other `personas` they help.

  Validation fails on duplicate persona or job IDs and on unknown or repeated IDs on a story, and warns about personas and jobs with no stories, active stories that serve none of a listed persona's jobs, drafted jobs whose stories have shipped, and maps where most active stories say nothing about who they are for.

  Existing maps stay valid and get no new warnings. New exports `storyPersonas`, `storyPersonaResolver`, `storyMapJobs`, `jobStatement`, `personasMaxItems`, `personaJobsMaxItems`, `storyPersonasMaxItems` and `jobStatementMaxLength`, and types `StoryMapPersona`, `StoryMapJob` and `StoryMapJobOwner`.

  See [Personas and jobs to be done](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#personas-and-jobs-to-be-done).
- `story-map diff` and `diffStoryMaps` report persona and job changes under **Personas and jobs**, as new `personas` and `jobs` fields on the diff, and a story's changed jobs and personas as `jobs` and `personas` on its update.
- Personas can describe their `context`: what `success` means to them, what they `usesToday` and their `constraints`, with `draft: true` for context an agent drafted. It is internal: internal views and the JSON export carry it, customers never see it, and search does not match it.

  Validation fails on empty context and warns about drafted context on a persona that a shipped story is for. `story-map diff` reports context changes, as a new `personaContexts` field on the diff.

  New exports `personaContextMaxLength`, `personaUsesTodayMaxItems`, `personaUsesTodayMaxLength` and `personaConstraintsMaxItems`, and types `StoryMapPersonaContext` and `PersonaContextChanges`. See [Describe a persona's context](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#describe-a-personas-context).
- A persona's first job is their core job. The persona panel labels it **Core job** and sets it apart, with the others under **Other jobs**, and the story panel's **Jobs** row and `story-map story` mark it. Validation warns “Core job … has no stories” for a core job with no active stories, in place of the usual warning.

  `story-map diff` reports a change of core job, as `coreChanged` on the diff's `jobs`. Job labels in the view and the JSON export gain `core: true` on the core job. New export `personaCoreJob`, types `CoreJobChange`, `JobChanges` and `JobDiffRef`, and classes `esm-core-label`, `esm-job-core` and `esm-jobs-subhead`.

  Reordering a persona's jobs changes their core job. See [Mark a core job](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#mark-a-core-job).
- Job statements read “When …, I want …, so that ….” on the board, in `jobStatement()`, the CLI, `story-map diff` and the exports,. The guide and schema descriptions ask for a `situation` that names the trigger and what makes it hard, and an `outcome` that names what is at stake, with a weak and a strong example.

  The first-run workflow asks agents to write jobs this way and cite their source in the PR. See [Write a job statement](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#write-a-job-statement).
- The story panel's **Jobs** row puts “I want” and “so that” on lines of their own, so each job statement reads as When, I want and so that.
- Jobs can list up to 6 workflow `steps`, in order, each with a `title`, an optional `summary` and an optional `activity` where its stories live. A step's stories are the active stories that serve its job and sit in its activity. Validation fails on an unknown activity and warns about a step with no stories, unless its job has none at all.

  The persona panel shows how many of the core job's steps have no stories, such as “1 of 3 steps has no stories”. Steps in the view and the JSON export gain `activeStories` when they have an activity, and `story-map diff` reports changed steps, as `stepsChanged` on the diff's `jobs`. Customers never see steps.

  New exports `jobStepCounter`, `jobStepGaps`, `jobStepsMaxItems` and `jobStepTitleMaxLength`, and types `StoryMapJobStep`, `PersonaJobStepLabel` and `JobStepsChange`. See [Break a job into steps](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#break-a-job-into-steps).
- `story-map edit` takes `--add-job`, `--remove-job`, `--add-persona` and `--remove-persona`, and `story-map add` takes `--job` and `--persona`. The matching ops are `add-job`, `remove-job`, `add-persona` and `remove-persona`, and `jobs` and `personas` on `add`.
- The starter map from `story-map init` has one example persona with one drafted job, and the first-run workflow asks agents to draft personas and jobs and tag stories with them. The `AGENTS.md` template asks agents to tag stories with the jobs they serve and to mark any job they invent as a draft. Hosts can copy the new sentence from `node_modules/auto-story-map/templates/AGENTS.md`.

### See personas on the board

- **See who a story is for:** Cards and activities show the avatars of the personas they serve, and the story panel lists who the story is for and the jobs it serves.
- **Filter by persona:** A persona menu narrows the board to the stories for the personas you choose, and links narrow it to one job.
- **Open a persona:** Selecting a persona opens a panel with their jobs and how many stories serve each, so the jobs with none stand out.
- **Open a persona's page:** A **Personas** tab beside the map gives each persona a page with their context and their jobs as lanes, each step in order, with gaps marked.
- **Share personas with customers:** Customers can see who a story is for, using only persona descriptions approved for them. Internal personas and jobs never reach them.
- **Include personas in exports:** The CSV, JSON and Visio exports carry each story's personas and jobs.

**For developers**

- Internal boards show who each story is for. Cards show persona avatars beside the ID, up to three then “+N”, activities show the personas their active stories are for, and the story panel gains **For** and **Jobs** rows, with a **Draft** label on drafted jobs. Screen readers hear persona titles, not initials.

  New classes `esm-avatar`, `esm-avatar-more`, `esm-avatars`, `esm-card-tags`, `esm-persona-row`, `esm-persona-chip`, `esm-story-jobs` and `esm-story-job-persona`, and colour properties `--esm-persona-0` to `--esm-persona-5` with `-bg` pairs, in light, dark and auto themes, each with at least 4.5:1 contrast. Boards for maps without personas, and customer boards, do not change.
- Internal views of a map with personas gain `personas`, with each persona's `initials`, `colour` and `jobs`, and stories gain `personas`, resolved from their jobs and own list, and `jobs`. The JSON export and the JSON from `story-map story` and `stories` carry the story fields. New exports `personaInitials` and `personaColourCount`, and type `PersonaLabel`.
- Internal boards filter by persona. A persona menu beside the status filter ticks every persona by default, showing everyone, and unticking personas keeps the stories for the rest. Choosing every persona is the same as choosing none. `job` keeps the stories that serve a job, and the filter summary names it with a link to clear it.

  `readStoryMapFilters` reads repeated `persona` and `job` parameters, `StoryMapFilters` gains `persona` and `job`, and `filter.persona` and `filter.job` are set on the view when they narrow it. Unknown IDs are ignored, and customers' job parameters, and internal persona IDs, change nothing. Internal search also matches persona titles and job statements.

  Persona labels gain `activeStories`. `board.js` applies the persona menu when it closes and returns focus to it. New class `esm-persona-menu`. See [Filter by persona](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#filter-by-persona).
- Internal boards open a persona panel from a persona's avatar under an activity or the **For** row of a story panel. The panel shows the persona's summary and each job to be done with a **Draft** label on drafts, a bar and count of its active stories by status, a note of blocked and cut ones, and **No stories yet** for a job with none.

  With filters, each job links to its stories and the panel links to the persona's stories. Counts ignore the filters. Jobs on persona labels gain `storyCounts`.

  New type `PersonaJobLabel`, and new classes `esm-persona-detail`, `esm-persona-head`, `esm-avatar-lg`, `esm-avatar-button`, `esm-jobs`, `esm-job`, `esm-job-statement`, `esm-job-meta`, `esm-job-gap`, `esm-job-left` and `esm-bar`. See [Open a persona](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#open-a-persona).
- Internal boards of maps with personas gain a **Personas** tab beside the story map, when the host uses search and filters. It shows each persona on a page: a list of personas with their active stories and gaps, the chosen persona's context, and their jobs as lanes, core job first, each with its steps in order, a link to each step's stories and dashed gaps.

  Job lanes collapse like release lanes, and `board.js` remembers them. With the tab, the persona panel is a quick look with the core job and an **Open persona** link to the tab.

  `readStoryMapFilters` reads `view=personas` and repeated `activity` parameters, `StoryMapFilters` gains `view` and `activity`, and `filter.view` and `filter.activity` are set on the view. Customers never get the tab.

  New type `StoryMapPage`, and new classes `esm-tabs`, `esm-tab`, `esm-persona-page`, `esm-persona-list`, `esm-persona-link`, `esm-persona-picker`, `esm-persona-main`, `esm-context-band`, `esm-context-card`, `esm-job-lanes`, `esm-job-lane`, `esm-job-collapse`, `esm-job-steps`, `esm-step-card`, `esm-popover-foot` and `esm-open-persona`.

  See [Personas tab](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#personas-tab).
- Customer views share personas with approved `customer` copy that a story in the view is for, as `personas` with public IDs such as `persona-1`, and customer stories gain `personas` with those IDs. The customer story panel shows a **For** line with the approved titles, and the persona menu, without avatars, appears when two or more personas are shared.

  Internal persona IDs and copy, and all jobs, never reach customers. See [Share personas with customers](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#share-personas-with-customers).
- Exports include personas. When the map has personas, the CSV gains `Personas` and `Jobs` columns, with persona titles and job IDs joined by “; ”, and Visio cards gain `Personas` and `Jobs` shape data.

  The JSON export lists the map's `personas`, each with its `activeStories` and its jobs, each job with its `storyCounts`, `statement` and `activeStories`, as new types `StoryMapJsonPersona` and `StoryMapJsonJob`, and notes when jobs are drafted. Files for maps without personas do not change.

  `story-map story` prints a story's personas and jobs, and `story-map stories` takes `--persona` and `--job`, and exits 1 for an unknown ID.

### Estimates

- **Estimate effort on each story:** A story can carry an estimate in story points, and each release lane shows its total, how much is merged and how much is left to do. Customers never see estimates.

**For developers**

- Stories can carry an optional `estimate` in story points: 1, 2, 3, 5, 8 or 13. Any other value is a validation error. New exports `estimatePoints` and type `EstimatePoints`. Existing maps stay valid.
- Validation warns about a `planned` or `in-progress` story with no estimate, but only in a release where another story has one, so maps that do not use estimates get no new warnings. `--strict` makes it fail.
- Internal views carry each story's `estimate`, and each release's `estimates`: `{ total, merged, left, unestimated }`.

  Cut stories are left out, `merged` counts the points on merged stories, `left` counts only stories that are not merged or shipped, so a release whose work is all merged has 0 left, and the totals count the whole release whatever the filters. Releases with no estimated story have no `estimates`. Customers never see either. New type `ReleaseEstimates`.

  See [Estimate effort](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#estimate-effort).
- Internal boards show estimates. A card shows its estimate at the top right, such as “5 pts”. Each release lane shows its total under the story count, such as “21 pts · 5 merged · 8 left · 2 unestimated”, leaving out merged when it is 0, and it stays on a collapsed lane.

  The release panel adds a line under progress, such as “21 points, 5 merged and waiting to ship, 8 left to do.”, and the story panel lists the estimate. New classes `esm-card-head`, `esm-estimate`, `esm-release-estimate` and `esm-release-estimate-note`, using the existing colours. Boards with no estimates look the same as before.
- `story-map diff` and `diffStoryMaps` report estimate changes, such as “Estimate: 3 → 5”, as `estimate` on the story update. Estimates are internal, so they are not part of the customer-facing comparison.
- Exports carry estimates. The CSV has a new last column, `Estimate`, after `Title`, and collapsed release rows put the release total there. `story-map releases` prints each release's total. Visio cards show the estimate after the ID and in their shape data, and release headers show the total. The JSON export includes each story's `estimate` and each release's `estimates`.

### Links to code and stories

- **Link history to pull requests and commits:** Each line in a story's history links to the pull request and commit that made the change, when the product passes its repository address.
- **See the pull requests and commits behind a story:** A **Changes** section in the story panel lists the merged pull requests and commits that name the story, found from Git, so you can see the work behind it without searching.
- **Link to a story or release:** Each story and release panel has **Copy link**. Opening the link takes you to the board with that panel open, even when your filters would hide the story.

**For developers**

- `story-map history` records the pull request each change came from, as an optional `pullRequest` number on history events and last edits, read from GitHub merge commits, squash and rebase subjects ending in `(#n)`, and GitLab `See merge request` lines. Direct commits have none. History files written before this version still load, and the file stays `version: 1`.
- `StoryMapBoard` takes `repositoryUrl`, such as `https://github.com/your-org/your-product`, and links each history line in the story panel to its pull request and commit, such as “· #70 · 8078905”, and the “Last updated” time to the pull request, or to the commit when there is none.

  For GitLab and other hosts, `repositoryLinks` takes `commit` and `pullRequest` templates with `{commit}` and `{number}` placeholders, as new type `StoryMapRepositoryLinks`. Only `http:` and `https:` links are made, and customer boards never show them. Without either prop, boards look the same. New classes `esm-history-link` and `esm-commit-hash`.

  See [Show status history](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#show-status-history).
- `story-map history` finds the merged pull requests and direct commits whose title, commit messages or branch name name a story, and records them in the history file as `changes`, newest first, with each one's `storyIds`, `pullRequest`, `title`, `branch`, `commit`, `at`, `by`, `mergedBy` and `commitCount`.

  Each story lists at most 30, with the rest counted in `moreChanges`. IDs in messages use the map's case, and branch names match in any case, so `feat/esm-801-story-tests-panel` names ESM-801. It reads the branch's history once more across every file, in one Git call. The file stays `version: 1`, and older files still load.

  New types `StoryChange` and `StoryMoreChanges`. See [Link pull requests and commits to stories](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-pull-requests-and-commits-to-stories).
- Internal story panels gain a **Changes** section between **History** and **Tests**, listing each pull request with its number, title, when and by whom it was merged and its commit count, and each direct commit with its short hash and subject.

  Titles link to the pull request or commit when the board has `repositoryUrl` or `repositoryLinks`, and on GitHub “+N more” links to a pull request search. With a history file from before this version, the section is left out. Internal views gain `changesIndexed`, and stories gain `changes` and `moreChanges`, as new type `StoryChangeEntry`.

  The JSON export carries them with a provenance note, and `story-map story` prints them. Customers never see them. New classes `esm-changes`, `esm-change-list`, `esm-change`, `esm-change-body`, `esm-change-link`, `esm-change-number`, `esm-change-title`, `esm-change-meta`, `esm-changes-more` and `esm-changes-empty`.
- Permalinks to a story or release. Each story panel, and each internal release panel, has a **Copy link** button whose link, such as `?story=ESM-801#esm-story-ESM-801` or `?release=v0-7-4#esm-release-v0-7-4`, opens the board on that panel.

  Links keep `preservedParams` and drop the viewer's filters, and a linked story is shown even when the filters would hide it. With board.js, the button copies the link and says “Link copied”, and the linked panel opens on load with its lane expanded. Without it, the link scrolls to the card and highlights it.

  IDs outside the viewer's view are ignored, so customer boards treat internal stories like unknown ones. `readStoryMapFilters` reads `story` and `release`, `StoryMapFilters` and the view's `filter` gain `story` and `release`, and `StoryMapBoard` takes `permalinkBase` for hosts behind a proxy.

  Cards and release lanes gain the IDs `esm-story-<ID>` and `esm-release-<ID>`, and the board gains `data-esm-open`. `storyMapToJson` takes `permalinkBase` and adds `permalink` to each story and release, as new type `StoryMapJsonRelease`.

  New exports `storyMapPermalink`, `storyMapAnchorId` and `enhanceStoryMapPermalinks` (from `auto-story-map/board.js`), type `StoryMapPermalinkTarget`, and classes `esm-detail-actions` and `esm-copy-link`. Hosts that restyle `.esm-detail-head` should check the new actions group.

  See [Link to a story](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-to-a-story).

### Board

- **Open details in a side panel:** Story, release and persona details slide in from the right, so the board stays in view beside them, instead of opening in the middle of the screen.

**For developers**

- Story, release and persona panels slide in from the right as a full-height panel, 42rem wide, keeping the board in view beside them, instead of opening as a 34rem modal in the middle of the screen. On screens narrower than that, the panel fills the width.

  The panel's header, with its close button, stays in view as the panel scrolls, and the slide is off for people who prefer reduced motion. Hosts that restyle `.esm-detail` should check its new position.
- The board no longer says how many blocked and cut stories the default status filter hides, such as “3 cut hidden. Show them”. Tick Blocked and Cut in the status menu to see them. Filtered views still count them in `filter.hidden`.
- The example host's page has a favicon, an inline SVG of a small story map. The package itself sets no favicon, so a host keeps its own.

### Guide and `AGENTS.md` template

- The guide explains how to [link mockups and designs](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-mockups-and-designs) from the map: give the mockup a heading in its plan, add that link to the `sources` of each story it shows, and name it in the release notes.

  The `AGENTS.md` template asks agents to do this, and to read a story's `sources` before changing it. Hosts can copy the new paragraph from `node_modules/auto-story-map/templates/AGENTS.md`.
- The `AGENTS.md` template asks agents to change the map with `story-map edit`, `add` and `release-impact`, and to check the dry run before writing.
- The `AGENTS.md` template asks agents to search for existing stories with `story-map stories --query` before adding one. Hosts can copy the new sentence from `node_modules/auto-story-map/templates/AGENTS.md`.
- The `AGENTS.md` template asks agents not to set or change an estimate unless the team has agreed it, and to flag a missing one in the PR. Hosts can copy the new paragraph from `node_modules/auto-story-map/templates/AGENTS.md`.
- The `AGENTS.md` template asks agents to name each branch for its work and start each pull request title with the story ID, such as “BILLING-204: Refund cancelled orders”, instead of using a generated branch name. Hosts can copy the new section from `node_modules/auto-story-map/templates/AGENTS.md`.
- The `AGENTS.md` template asks agents to start commit messages with the story ID, as pull request titles do. Hosts can copy the sentence from `node_modules/auto-story-map/templates/AGENTS.md`.

## 0.7.1

0.7.1 adds a JSON export of the map for agents and scripts. Nothing breaks: existing maps, history files and host code need no change.

### JSON export for agents

- **Export the map as JSON for agents:** A JSON file of the whole internal map, with each story's notes, sources, history and tests, and notes on where the data came from and what is left out, so an agent can review the map against the code and suggest work. Download it from the board's **Export** menu or with `story-map export --format json`.

**For developers**

- New `storyMapToJson(view, { maxStories, now })` writes the internal map as JSON for an agent or script to review: activities, releases with notes and impact, and each story's summary, status, notes, sources, history and tagged tests, with `testCount` when a tests index was supplied.

  `provenance` and `completeness` sections say where the data came from, when the history and tests were generated, how many stories are left out and why, with plain-language notes for the agent. Every story is included unless `maxStories` is passed, and collapsed lanes are ignored, so the file always covers every release.

  New exports `jsonContentType` and types `StoryMapJsonExport`, `StoryMapJsonExportOptions` and `StoryMapJsonStory`. See [Export as JSON for agents](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#export-as-json-for-agents).
- `story-map export` accepts `--format json` and a new `--tests-index <file>` option for the index from `story-map tests`. `storyMapExportResponse` accepts `format=json`, ignoring `collapsed` for it, and the board's Export menu has a *JSON, for agents and scripts* link. The example host passes the tests index to its export route.
- Internal views gain `testsGeneratedAt`, when the tests index was generated, alongside `testsIndexed`.

## 0.7.0

0.7.0 lets you take the map into other tools, shows the tests behind each story, and lets you pick several statuses in the filter.

- **Export the map:** Download the map as a Visio or CSV file to open in Miro, Lucidchart, Visio or a spreadsheet.

- **See each story's tests:** Tests that name a story show in its panel, and its card shows how many there are.

- **Filter by several statuses:** Tick any mix of statuses in the status filter.

One breaking change, to the status filter. Follow the [0.7.0 upgrade steps](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-070): if host code reads `view.filter.status` or the JSON `filter.status`, treat it as an array. Links with `?status=all` or one status need no change. Existing maps and history files stay valid.

### Export the map

- **Export as a Visio file:** Download the internal map as a Visio file, laid out like the board with release notes and impact, to import into Lucidchart, Miro or Visio.
- **Export as CSV:** Download a spreadsheet with a row per story giving its activity, release, ID and title. It opens safely in spreadsheet apps and imports into Miro and Lucidchart.
- **Export from the command line:** `story-map export` writes either file straight from the map file, without the product.
- **Download from the board:** Internal viewers get an **Export** menu on the board when the product turns it on, and lanes they collapsed stay collapsed in the file.

**For developers**

- New `storyMapToVsdx(view, { collapsedReleases, maxStories, now })` writes the internal map as a Visio file (`.vsdx`) to import into Lucidchart, Miro or Visio. It is one page laid out like the board, with release notes and impact, and a card per story showing its ID and title, plus shape data.

  Collapsed lanes show only their title and story count, and at most 200 of the most recently changed stories are included. Customer views and filtered views are refused. New exports `vsdxContentType` and type `StoryMapExportOptions`. See [Export the map](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#export-the-map).
- New `story-map export --format vsdx [--output <file>] [--history <file>] [--collapsed <release IDs>] [--max-stories <n>] [<map.yaml>]` writes the same Visio file from the YAML file, without a host route. It validates the map first, always exports the internal view, and writes to `story-map.vsdx` by default, or to stdout with `--output -`.

  See [Export the map](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#export-the-map).
- New `storyMapToCsv(view, { collapsedReleases, maxStories, now })` writes the internal map as CSV, with a row per story giving its activity, release, ID and title, in board order. A collapsed release is one row with its story count.

  It follows the same rules as the Visio export, quotes fields following RFC 4180, prefixes formula-looking fields with `'`, and starts with a UTF-8 byte order mark. New export `csvContentType`. `story-map export` accepts `--format csv`. See [Export as CSV](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#export-as-csv).
- New `exportHref` prop on `StoryMapBoard`. On internal boards, an **Export** button to the right of the filters opens a menu linking to it with `format=vsdx` and `format=csv`, and `board.js` adds the lanes the viewer collapsed as `collapsed`. Customers never see the button.

  New `storyMapExportResponse(view, { format, collapsed, filename, maxStories, now })` returns the file and its download headers for a host route, throwing a `RangeError` for an unknown format. New exports `storyMapExportFormats` and types `StoryMapExportFormat`, `StoryMapExportResponse` and `StoryMapExportResponseOptions`.

  The example host serves `/story-map/export`. See [Download from the board](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#download-from-the-board).

### Tests linked to stories

- **See a story's tests:** Tests whose names start with a story ID, such as “ESM-702: exports a valid Visio package”, are listed in the story's panel, each linking to its line in the code. Nothing in the map needs changing.
- **Count tests on cards:** Internal cards show a flask and how many tests a story has, so you can see at a glance which stories are covered.

**For developers**

- New `story-map tests [--tests <path>]… [--root <path>] [--out <file>] [<map.yaml>]` finds tests whose names contain a story ID, such as `test("ESM-702: exports a valid Visio package", …)`, and writes them as JSON for the board. It reads the source text only, so no test code runs.

  `test`, `it`, `describe` and `suite` count, with `.only`, `.skip`, `.todo`, `.concurrent` and `.each(…)`, when the name is a string literal.

  In a folder, it reads `*.test.*` and `*.spec.*` files and scripts under `test/`, `tests/` and `__tests__/`, skipping `node_modules`, `dist`, `build` and dot folders, and it never follows a path or symbolic link out of the repository. Tags for stories that are not in the map are left out with a warning.

  The index lists at most 5,000 tests and 50 per story, counting the rest, with names up to 250 characters. New exports `parseStoryMapTests`, `storyMapTestsSchema`, `testNameMaxLength`, `testsMaxItems` and `testsPerStoryMaxItems`, and types `StoryMapTests`, `StoryTestEntry` and `OmittedStoryTests`. The board does not show tests yet (ESM-801).
- New `validate --tests <path>`, repeatable. It reports an error, at the test, for a tag naming a story that is not in the map, and a warning, at the story, for an `in-progress` or `merged` story with no tagged tests. Without `--tests`, validate does not change.
- New `tests` option on `getStoryMapForViewer` and `getStoryMapPage`, taking the index from `story-map tests` parsed with `parseStoryMapTests`. Internal stories gain `tests`, the tests and groups tagged with their ID, and `moreTests`, those the index's limits left out, counted per file. Internal views gain `testsIndexed: true` when an index was passed. The customer view never includes them. New type `StoryTestLink`.
- On internal boards, the story panel has a **Tests** section between **History** and **Engineering**, listing each tagged test under its file with its line. With `sourceBaseUrl`, each test links to `<file>#L<line>`, and without it they are plain text.

  A leading tag such as `ESM-702: ` is dropped from the name, a tagged `describe` shows as a group, and "+N more in this file" counts tests over the limit. With an index, a story without tests says how to tag one. Without one, the section is left out.

  New classes `esm-tests`, `esm-tests-file`, `esm-tests-path`, `esm-test`, `esm-test-name`, `esm-test-line`, `esm-tests-more` and `esm-tests-empty`, using the existing colour properties. The example host passes the index through, and the demo builds it at start-up.
- `parseStoryMapTests` refuses absolute paths, `..` segments, backslashes and URLs in `file`, so a test link always stays under `sourceBaseUrl`.
- `story-map init` adds `--tests <folder>` to the CI workflow's validate step when the host has a top-level `test`, `tests` or `__tests__` folder, and runs the workflow when its tests change. Hosts without one get the same workflow as before. Existing workflows are never changed, so add `--tests` yourself to check tags in an existing host.
- The guide has a new section, [Link tests to stories](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-tests-to-stories), and the `AGENTS.md` section that `init` adds tells agents to start a test's name with the story ID it covers.
- On internal boards, a story card with tagged tests shows a flask and the count, such as “· 7”, between its status and its last change, read by screen readers as “7 tests”. The count includes tests the index left out over its limits. Cards for stories without tests, and customer cards, do not change. New class `esm-card-tests`.

### Status filter

- **Choose several statuses:** The status filter is a list of checkboxes, so you can show any mix of statuses, including stalled stories. Active statuses are ticked to begin with.

**For developers**

- **Breaking:** the board's status filter takes several choices. It is a list of checkboxes, one per status plus **Stalled**, in place of the dropdown. Active statuses are ticked by default, and the **All, including blocked and cut** choice is gone, because ticking every box does the same.

  **Stalled** is now just “Stalled”, and adds stalled stories to the other choices. Choices apply when the list closes with `board.js`, or with **Apply** without it. In the URL, `status` repeats once per choice, and `status=all` and single-status links still work. `StoryMapFilters.status` also takes an array.

  `filter.status` in the view, and in JSON responses, is now an array of choices, such as `["planned", "stalled"]`, instead of a single value, and is absent for the default. New type `StoryStatusFilter`. `board.js` exports `enhanceStoryMapMenus`, which closes the status and Export menus on Escape or a click elsewhere.
- The “Changed in” filter's options read **All time** (the default), **Last day**, **Last 7 days**, **Last 14 days** and **Last 30 days**, in place of “Changed any time” and “Changed: last 7 days”.

### Board

- The board footer shows the short hash of the commit the library was built from, right of the version number, such as “Auto Story Map 0.7.0 50058dd”. Internal boards link it to the commit on GitHub. Builds made outside a git checkout show the version alone. New export `storyMapCommit`.
- Internal cards shorten the time since a story last changed to “5h ago” and “12 mins ago”. The board header and story panel keep “5 hours ago” and “12 minutes ago”.

## 0.6.1

0.6.1 is mainly fixes from a code review of 0.5.0, several of them for security, plus a new board header. There is no 0.6.0 release: 0.6.1 follows 0.5.0. No upgrade steps: existing maps and history files stay valid.

### Board header

- **See when the map last changed and where:** The internal board's header says when the map was last updated, by whom, and which releases recent changes were in.

**For developers**

- With history, the internal board's header says when the map was last updated and by whom, and which releases recent changes focused on, such as “Last updated 4 hours ago by Sam Patel. Recent changes focused on 0.6.1 (12 stories) and 0.5.0 (3 stories).” It replaces the map's `summary` there.

  Without history, and for customers, the header still shows the summary. Internal views carry the data in a new `recentUpdates` field. New export `recentUpdateDays` and type `StoryMapRecentUpdates`.
- Activity titles on the board are larger: `.esm-activity-title` is now `1.1rem`.

### History and diffs

- **Long names no longer break history:** Very long Git names are shortened, so the history file always loads.
- **History and diffs survive format changes:** When the map's format changes, history and diffs read older versions of the map instead of failing or losing dates, and say what they could not read.

**For developers**

- `story-map history` fits names to the history format, so `parseStoryMapHistory` always accepts the file it writes. Git author and committer names have no length limit, and a name over 120 characters used to produce a history file that failed to load.

  Names are trimmed and cut to 120 characters ending in “…”, and blocked or cut reasons to 500, counting characters rather than UTF-16 code units so emoji are never split. `parseStoryMapHistory` counts the same way, so it now accepts names of up to 120 emoji.
- `story-map history` and `story-map diff` read past versions of the map leniently, so a future format change that removes or renames a field or status no longer breaks them. Fields the format no longer has are ignored, and a story that no longer validates is left out of that version only.

  History used to skip every such version silently, losing its events and dates, and diff failed until the change merged.
- History now records each version it cannot read, because the map was missing or not valid YAML, in new optional `skipped` and `skippedCount` fields, and `story-map history` warns about them and still exits 0. `parseStoryMapHistory` accepts files with and without these fields. New type `SkippedStoryMapVersion`.
- When the diff's base drops anything, the summary starts with a note saying what, and `--format json` adds `baseDropped`.

### Show each viewer the right map

- **Project and filter the map in one call:** One function now shows each viewer only what they may see and then applies their filters, so products get the safe order without extra work. The guide also gives measured page sizes for large maps.

**For developers**

- New `getStoryMapPage(document, viewer, { canViewInternal, history, stalledAfterWeeks, now, searchParams })` projects the map for the viewer and then applies the filters from `searchParams`, so the safe order is the easy one. It returns the same as `filterStoryMapView(getStoryMapForViewer(...), readStoryMapFilters(searchParams), { now })`, which remain available. New type `StoryMapPageOptions`.
- New `storyMapResponseHeaders`: `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`, for every story map response.
- The example host and the integration guide use both. The guide has a new [Large maps](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#large-maps) section with measured page sizes.

### Pull request summaries

- **Diff summaries no longer notify people:** Pasting a summary of a map change into a pull request no longer mentions people or teams, or links issues, by accident.

**For developers**

- `story-map diff` escapes `@` and `#` in text from the map, so pasting the summary into a PR does not mention people or teams, or link issues.
- The diff's note about stories dropped from an older-format base shows each rejected ID as inline code, so an ID with backticks, links, mentions or line breaks cannot change the summary.

### Board fixes

- **The board works with bad date settings:** An unknown language or time zone no longer stops the board from showing. It falls back to the defaults instead.

**For developers**

- `StoryMapBoard` no longer fails to render when given a `locale` or `timeZone` the runtime does not recognise, such as `timeZone="Nowhere/Nope"`. It uses `en-GB` or the server's time zone instead, and logs a warning once. The board also builds its date formatters once per render instead of once per date. Rendered markup is otherwise unchanged.
- `getStoryMapForViewer` and `getStoryMapPage` group history events in linear time. They used to copy each story's growing list for every event, so a history with many events for one story took quadratic time: 100,000 events took over a minute and now take well under a second. Entry order is unchanged, including for events with the same timestamp.

### Command line and validation fixes

- **Fix command line and source check edge cases:** Options no longer take the next option as their value by mistake, and checks no longer follow links out of the repository.
- **Keep source checks fast:** A crafted heading in a pull request can no longer stall validation in CI.

**For developers**

- CLI options no longer take the next option as their value. `story-map validate --plans --strict map.yaml` and `story-map history --map --allow-shallow` used to read `--strict` and `--allow-shallow` as paths. They now print `story-map: --plans needs a value` and the usage, and exit 2. Pass a value that starts with a hyphen as `--name=-value`. The same applies to `init --dir`.
- `--check-sources` and `--plans` no longer follow symbolic links out of the repository. A source or plan file that links outside is reported as pointing outside the repository through a symbolic link, and is not read. Links inside the repository still work.
- `story-map init` no longer follows symbolic links out of the host repository. A link at `AGENTS.md`, the map, the guide or the workflow that points outside the chosen directory, or is broken, is refused with a message instead of being written through.

  It skips a read-only `AGENTS.md` that already has the story map section, and accepts in-repository names that start with two dots, such as `..docs`.
- Text output from `story-map validate` escapes line breaks and control characters in messages and paths, so map text cannot add lines that look like other diagnostics or send terminal escape codes.
- `--check-sources` reads heading anchors in linear time, so a Markdown heading full of unclosed `<`, `[` or trailing spaces can no longer stall validation. A 200 KB heading used to take about 14 seconds. Heading anchors are not checked in Markdown files over 5 MB, and the source is reported instead.
- Validation locates problems in linear time. A map with many unknown or duplicate fields used to make validation quadratic.

### Other changes

- `story-map init` titles the starter map “[App Name] Story Map”, such as “Field Ops Story Map”, instead of “Field ops story map”.
- The release workflow checks that the packed `package.json` matches the committed one and pins the npm registry, so a tampered tarball cannot redirect the publish.

## 0.5.0

0.5.0 lets you collapse finished releases and shows which version of Auto Story Map a product runs. No upgrade steps. Hosts with custom CSS for `.esm-release` should check the new toggle fits.

### Collapse release lanes

- **Collapse release lanes:** Each release has a chevron that folds its lane down to its title and story count, so finished releases take less room. With the optional script, collapsed lanes stay collapsed when the page reloads.

**For developers**

- Release lanes can be collapsed. Each release header has a chevron toggle (`.esm-collapse`, a labelled checkbox `.esm-collapse-input` whose value is the release ID) that hides the lane’s stories, summary and impact, leaving its title, the chevron to expand it and its story count on one line. It works without JavaScript through CSS `:has()`, and browsers without `:has()` do not show the toggle.
- `board.js` remembers collapsed lanes per page in `localStorage`, so they stay collapsed when a filter reloads the page. New export `enhanceStoryMapReleases(root)` for pages that add a board after loading.

### Version in the footer

- **See the running version:** A footer shows the version of Auto Story Map, its author and licence. Internal viewers also get links to the changelog and source code.

**For developers**

- The board shows the running version, author and licence in a footer, such as “Auto Story Map 0.5.0 · By Duncan Malcolm · Apache-2.0 licence”. Internal boards also link to the changelog, source code, licence and author. Pass `showVersion={false}` to `StoryMapBoard` to remove it. New exports `storyMapVersion` and `storyMapRepositoryUrl`.

## 0.4.1

0.4.1 makes the filters apply as soon as you change them. No upgrade steps. Nothing changes for hosts that do not load the new script.

### Filters apply as you choose

- **Apply filters as soon as they change:** With the optional script, choosing a filter applies it straight away, and search applies when you press Enter, so there is no **Apply** button to press. Without the script, the filters work as before.

**For developers**

- New optional browser script, `auto-story-map/board.js`. Load it with `<script type="module">` on the page that renders the board, and the filters apply as soon as they change: a select applies on change, search applies on Enter, the **Apply** button is hidden, and focus returns to the filter that was used. Without it, the filter form works as before. It also exports `enhanceStoryMapFilters(root)` for pages that add a board after loading.
- The **Apply** button has a new `esm-apply` class, and the filter form has an empty, visually hidden hint that the script fills in for screen reader users.

### Demo

- The demo shows this library’s own story map instead of the builder estimates sample, loads `board.js`, and starts as **Super admin**. The sample moved to `test/fixtures/builder-estimates.yaml`.

## 0.4.0

0.4.0 tracks delivery more closely: blocked and cut work, merged work that has not shipped, release notes and expected impact, stalled stories and who last changed each story.

Upgrade steps: [Upgrade to 0.4.0](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-040). Existing maps stay valid, but expect new validation warnings, mainly releases with no impact.

### Statuses

- **Separate merged from shipped:** A new `merged` status means the work is on the main branch but not yet available to its users. Customers see it as in progress.
- **Record blocked and cut stories:** New `blocked` and `cut` statuses, each with a reason, keep stopped or dropped work on the map instead of deleting it. The board hides them unless you ask, and customers never see them.

**For developers**

- **Breaking:** new `merged`, `blocked` and `cut` statuses, with an optional `statusReason` of up to 500 characters. `storyStatuses` and `StoryStatus` include them, so host code that handles every status needs three more cases. New `activeStoryStatuses`, `inactiveStoryStatuses` and `isActiveStatus`.
- `merged` means the work is on the default branch but not yet available to its users. It is active, has its own icon, label and `--esm-status-merged` colour, and appears in release progress, such as “2 of 5 stories shipped, 1 merged”. Customers see merged stories as in progress: new `customerStoryStatuses`, `customerStatus` and `CustomerStoryStatus`.

  `story-map diff` compares customer-facing statuses the same way, so in progress → merged is not a customer-facing change.
- **Breaking:** `filterStoryMapView` hides blocked and cut stories unless a status is given, and reports how many it hid in `filter.hidden`. Pass `status: "all"` (`?status=all`) for every story. The board’s status filter offers **Active**, **All, including blocked and cut**, and each status, and says how many stories are hidden with a link to show them.

  Boards rendered without `filterStoryMapView` hide them too, behind a **Show blocked and cut stories** checkbox that works without JavaScript.
- The customer view never includes blocked or cut stories, or activities and releases that only contain them.
- Story panels show the reason. `story-map history` records it on changes to blocked or cut, and the panel’s history list shows it.
- `story-map diff` has a **Blocked and cut** section, and a customer-facing story that becomes blocked or cut is listed as no longer visible.
- New `--esm-status-blocked` and `--esm-status-cut` colours, with icons and text labels.

### Release notes and impact

- **Record release notes and expected impact:** Each release can have notes and a list of the results it is expected to have, each a measure and its target. Internal viewers open a release to read them, with its progress and stories.

**For developers**

- Releases accept optional `notes` (plain text, up to 800 characters) and `impact` (up to 10 items with `metric`, `expected`, and optional `solves`, `actual` and `draft`). New `ReleaseImpact`, `releaseNotesMaxLength` and `releaseImpactMaxItems`.
- Validation warns about a release with active stories but no impact, and about a drafted impact item in a release with shipped stories.
- Internal boards show each release’s first impact item under its title, and the release title opens a panel with the notes, impact, progress and the release’s stories grouped by status. The internal view’s releases are `InternalReleaseLabel`s with `notes`, `impact` and `storyCounts`. The customer view is unchanged.
- `story-map diff` has a **Release notes and impact** section listing notes changes, added, changed, confirmed and removed impact items, and measured results being recorded. New `releaseDetails` on `StoryMapDiff`.
- Release notes and impact are not editable on the board. Agents and people change them in PRs.

### Stalled stories

- **Flag stories that stay in progress too long:** Stories in progress for more than 4 weeks are flagged on internal boards, and the status filter can show just those. Teams can change the 4 weeks or turn the flag off.

**For developers**

- Internal boards flag stories that have been in progress for longer than 4 weeks: the card reads “In progress for 6 weeks”, the story panel says when the story became in progress and that it is stalled, and the status filter has a **Stalled** option (`?status=stalled`). The flag needs a history file and is never shown to customers.
- New optional map `settings.stalledAfterWeeks` (whole weeks, 0 to 104, 0 turns the flag off) and `defaultStalledAfterWeeks`. Hosts can override it with the `stalledAfterWeeks` option on `getStoryMapForViewer`, which also takes `now`.
- Internal stories have `inProgressSince` and `stalled`, and the internal view has `stalledAfterWeeks` when the flag is on. `StoryMapFilters.status` and `filter.status` accept `"stalled"`.
- `story-map diff` lists a changed threshold under **Settings**, with a new `stalledAfterWeeks` on `StoryMapDiff`.
- New `--esm-stalled` and `--esm-stalled-bg` colours.

### Last updated from Git

- **See who last updated a story:** Story panels say when a story was last changed and by whom, taken from Git. Changes made by bots are credited to the person who merged them.

**For developers**

- `story-map history` records each current story’s last edit to any field, including notes, sources and moves, as `lastEdits` in the history file. New `StoryLastEdit` type. Older history files still parse.
- Story panels show “Last updated 3 days ago by Sam Patel” from the last edit, and fall back to `updatedBy` without it. Status changes and the **Changed** filter are unaffected.
- Edits authored by bots are credited to whoever merged them, in both the last edit and status history. Names ending in `[bot]` are bots. New `--bot-names` option on `story-map history`, and `botNames` on `buildStoryMapHistory`.
- `updatedBy` is now optional guidance. The guide and the `AGENTS.md` template ask agents to set it only when the commit author is not the person to credit.

### Validation

- **Warn without failing CI:** Some problems are now warnings, which are reported without making the map invalid, so CI still passes. `--strict` turns them into errors.

**For developers**

- Validation issues have a `severity` of `error` or `warning`. Warnings do not make a map invalid. The first warning is a blocked or cut story with no `statusReason`. New `storyMapWarnings(document)`.
- `story-map validate` prints warnings with `warning:`, emits `::warning` annotations with `--format github` and exits 0 when there are only warnings. Add `--strict` to fail on warnings.

## 0.3.0

0.3.0 brings a new board with search and filters, status history from Git, change summaries for pull requests and a command that sets up a product.

Upgrade steps: [Upgrade to 0.3.0](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-030). The YAML format is unchanged.

### Board

- **Search and filter the board:** A search box and status filter narrow the board to the stories you want.
- **Open story details without JavaScript:** Selecting a card opens a panel with the story's details, and it works even when JavaScript is off.

**For developers**

- **Breaking:** the board is now a grid of activity tiles and coloured release lanes, with a story count per release. The markup and class names changed, so remove host CSS that targets `.esm-table`, `.esm-card-toggle` or `<details>`.
- Cards show only the story ID, title and status. Selecting a card opens a detail panel with the summary, activity and release. For internal viewers, the panel also shows the engineering overview, notes, linked sources and last editor. The panel uses the popover API and works without client-side JavaScript.
- New `filterStoryMapView` and `readStoryMapFilters` add a search box and status filter, submitted as a GET form. Use `preservedParams` to keep the host page’s own query parameters.
- New `theme` prop: `light` (default), `dark` or `auto`. All colours are `--esm-*` custom properties.
- Phones show each release lane as a stacked section.
- Engineering overview and source links in the story panel open in a new tab, with an icon and screen-reader text that say so.

### Access and validation

- **Show validation problems on the pull request:** Validation reports each problem with its line and column, and on GitHub it appears on the changed line of the pull request.

**For developers**

- New `canViewInternal` option on `getStoryMapForViewer` lets the host decide who sees the internal map. The default is unchanged: the `engineer` and `super-admin` roles.
- `parseStoryMap` throws `StoryMapValidationError`. Its `issues` give the path, message, line, column and containing item ID. Every problem is reported in one run, including reference checks when another field is invalid.
- `story-map validate` prints `file:line:column` and supports `--format github` for PR annotations.
- New `--check-sources` validator option checks that repository-relative sources exist and that Markdown `#heading` links match a heading. New `--plans <folder>` checks that story IDs mentioned in delivery plans exist in the map.
- The package ships `story-map.schema.json` (also exported as `auto-story-map/schema.json`) for editor autocomplete and inline checks.
- **Breaking:** `storyMapSchema` is now a Zod 4 schema.

### Reviewing changes

- **Summarise map changes in pull requests:** `story-map diff` writes a summary of a map change for the pull request, starting with what customers will see.

**For developers**

- New `story-map diff <base-ref>` prints a Markdown summary of a map change for the PR, starting with what signed-in customers will see. `diffStoryMaps` and `formatStoryMapDiff` expose the same comparison in code.

### Status history

- **Show status history from Git:** The board shows when each story was added and how its status changed, and who made each change, taken from Git. A filter shows the stories that changed recently.

**For developers**

- New `story-map history` reads the map’s Git history and records when each story was added and each status change, who made it and who merged it. Pass the result to `getStoryMapForViewer` as `history`.
- Internal cards show the time since the last change, such as “Shipped · 2 days ago”, and the story panel lists the full history. A new **Changed** filter shows stories added or changed in the last 1, 7, 14 or 30 days (`changed=7d`). The customer view never includes history.
- New `locale`, `timeZone` and `now` props on `StoryMapBoard`, and a `now` option on `filterStoryMapView`.

### Setup

- **Set up a product with one command:** `story-map init` adds a starter map, the guide, instructions for agents and a CI check to a product's repository, without overwriting anything.
- **Install from npm:** The package is published to npm, with provenance that shows where it was built.

**For developers**

- New `story-map init` command creates a starter map, the story map guide, an `AGENTS.md` section and a GitHub Actions workflow that validates the map and its sources and adds the change summary to each PR. It never overwrites existing files.
- The package is published to npm.

## 0.2.0

0.2.0 links stories to their engineering docs and helps agents write a first map.

### Engineering links

- **Link stories to their engineering overview:** A story whose sources include a Markdown heading gets an **Engineering overview** link to it.
- **Help agents write the first map:** The guide gives agents a step-by-step workflow for drafting a product's first map.

**For developers**

- Story cards expand to show their activity and release.
- A Markdown source with a heading fragment becomes the card’s **Engineering overview** link. New `sourceBaseUrl` prop resolves repository-relative sources.
- Documented the host upgrade path and the first-run workflow for agents.

## 0.1.0

The first release.

### The story map

- **Keep the map in one file:** Each product keeps its story map in one YAML file, checked against strict rules, with stable story IDs.
- **Validate the map:** A command checks the map file and reports any problems.
- **Show internal and customer views:** The product says who is viewing, and the library builds only what that viewer may see, so customers never see internal stories.
- **Show the map as a board:** A React board and stylesheet show the map inside the product.

**For developers**

- First release: the YAML format, validator CLI, audience projection for internal and all-users views, React board and stylesheet.
- Stories can record `updatedBy`, shown to internal viewers.
