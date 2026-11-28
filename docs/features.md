# Auto Story Map features

Every feature Auto Story Map has, grouped by what it does. Each item names its stories in [this library's own map](../product/story-map.yaml) and the version it shipped in. Items marked **Unreleased** are merged to `main` but not yet in a published package. The map is the live record. This page is a snapshot of it, taken at version 0.7.6 plus the merged work after it.

For how to use each feature, follow the links to [the story map guide](story-map.md). For how the code works, see the [engineering overview](ENGINEERING-OVERVIEW.md). Planned work is listed at the end.

## The map file

- **One validated YAML file per product.** `product/story-map.yaml` holds activities, releases, stories and personas, with strict validation, size limits and stable story IDs. A JSON Schema, `auto-story-map/schema.json`, gives editors autocomplete and inline checks. ESM-101, 0.1.0. [Validate a change](story-map.md#validate-a-change)
- **Stable story IDs.** IDs never change when a story is renamed or moved. With `settings.storyIds: lowest-free`, `story-map add` takes the lowest unused number, counting cut stories. ESM-180, Unreleased. [Where an edit belongs](story-map.md#where-an-edit-belongs)
- **Statuses for the whole life of a story.** `planned`, `in-progress`, `merged`, `shipped`, `blocked` and `cut`. Merged means the work is on the default branch, and shipped means its users can use it. ESM-407, 0.4.0. [Merged and shipped](story-map.md#merged-and-shipped)
- **Blocked and cut stories keep their reason.** Stopped or dropped work stays on the map with a `statusReason`, instead of being deleted. ESM-402, 0.4.0. [Blocked and cut stories](story-map.md#blocked-and-cut-stories)
- **Format migrations.** Older versions of the map are read leniently, so history and diffs keep working after the format changes. ESM-602, 0.6.1.

## Plan the work

- **Release notes and expected impact.** Each release records what it is for and the metric it should move. Agents mark impact they draft as `draft: true`. ESM-403, 0.4.0. [Release notes and impact](story-map.md#release-notes-and-impact)
- **Estimates in story points.** Each story can carry the team's agreed estimate, and each release lane shows its total, how much is merged and how much is left. ESM-503, 0.7.4. [Estimate effort](story-map.md#estimate-effort)
- **MoSCoW priority.** Tag a story as must, should or could have. Cards show MH, SH or CH. ESM-158, 0.7.6. [Prioritise stories](story-map.md#prioritise-stories)
- **Dependencies.** A story lists the stories it depends on in `dependsOn`. Its card counts those not yet merged or shipped, and its panel lists both directions. ESM-129, 0.7.5. [Record dependencies](story-map.md#record-dependencies)
- **Readiness.** Ready, waiting and at-risk states are worked out from dependencies and shown on the story panel, in `stories --readiness` and in the JSON export, without changing any status. ESM-139, 0.7.6. [See which stories are ready to start](story-map.md#see-which-stories-are-ready-to-start)
- **Link an engineering overview, plans and mockups.** A story's `sources` point to Markdown headings, plans, mockups and designs, and the panel links them. ESM-201, 0.2.0. [Link an engineering overview](story-map.md#link-an-engineering-overview), [Link mockups and designs](story-map.md#link-mockups-and-designs)

### Delivery plans

Delivery plans are opt in: a host chooses once, and the answer is kept in `settings.plans`.

- **A guide to writing plans.** The guide shows the plan structure and the question an agent asks before a host adopts it. ESM-148 and ESM-153, Unreleased. [Write a delivery plan](story-map.md#write-a-delivery-plan)
- **An example plan in the package.** A full plan for the sample map, so the guide's links work in a host. ESM-149, Unreleased.
- **Scaffold a plan.** `story-map plan <ID...>` prints a plan skeleton with each story's title, release, the work it builds on and overlaps, and an effort table. ESM-151, Unreleased. [Scaffold a plan](story-map.md#scaffold-a-plan)
- **Check plans against the map.** `validate --plans` warns when a plan's status line is behind its stories, and checks that a UI mockup section links an HTML file and a PNG that exist. ESM-160 and ESM-161, Unreleased. [Check plan status lines](story-map.md#check-plan-status-lines)
- **Architecture decisions.** Plans answer where the work runs, who consumes it, which boundaries it touches and how to undo it. `validate --plans` reports a missing or placeholder section. ESM-183, ESM-184 and ESM-186, Unreleased. [Record architecture decisions](story-map.md#record-architecture-decisions)

### Personas and jobs to be done

- **Personas in the map file.** The map lists the people the product serves and their jobs to be done, and each story names the jobs it serves. Validate checks the references. ESM-901, 0.7.3. [Personas and jobs to be done](story-map.md#personas-and-jobs-to-be-done)
- **Job statements with a trigger and a stake.** Each job says “When …, I want …, so that …”. ESM-909, 0.7.3. [Write a job statement](story-map.md#write-a-job-statement)
- **Core jobs.** The first job in a persona's list is their core job, and validate warns when it has no stories. ESM-908, 0.7.3. [Mark a core job](story-map.md#mark-a-core-job)
- **Job steps.** A job can list up to 6 steps, each tied to an activity, with gaps marked. ESM-910, 0.7.3. [Break a job into steps](story-map.md#break-a-job-into-steps)
- **Persona context.** What success means to a persona, what they use today and their constraints. Drafts stay marked until a person confirms them. ESM-907, 0.7.3. [Describe a persona's context](story-map.md#describe-a-personas-context)

## The board

The board renders the map in the host product for React 18 or 19 hosts. It works without client-side JavaScript, and the optional `board.js` adds the conveniences noted below.

- **Story map layout.** Activities run across the top and releases down the side, with cards showing each story's ID, title, status, personas, estimate, test count and dependencies. ESM-104, 0.1.0. [Integrate with a product](story-map.md#integrate-with-a-product)
- **Titles that stay in view.** Activity titles stay at the top as the board scrolls, and the release column stays on the left. ESM-157, 0.7.6.
- **Search and filters.** Search, and filter by status (several at once), persona, job or recent change. With `board.js`, filters apply as soon as you choose them. ESM-305, ESM-411, ESM-414 and ESM-903, 0.3.0 to 0.7.3. [Filter by persona](story-map.md#filter-by-persona)
- **Collapsible release lanes.** Collapse a lane to its title and story count. `board.js` remembers which lanes you collapsed. ESM-412, 0.5.0.
- **Story, release and persona panels.** Details open in a full-height panel on the right, without JavaScript. ESM-306 and ESM-912, 0.3.0 and 0.7.4.
- **Permalinks.** Copy a link to any story or release. The link opens its panel even when the filters would hide it. ESM-122, 0.7.4. [Link to a story](story-map.md#link-to-a-story)
- **Who a story is for.** Cards and activities show persona avatars, and the story panel lists the jobs the story serves. ESM-902, 0.7.3.
- **Personas tab.** Each persona gets a page with their context and their jobs as lanes, showing the stories that serve each job and the gaps. An empty map shows how to add personas. ESM-904, ESM-911 and ESM-146, 0.7.3 and 0.7.6. [Personas tab](story-map.md#personas-tab)
- **Actions tab.** Lists what the map is waiting for, such as gaps, drafts to confirm, estimates to agree and tests to tag, says whether each needs a person, and copies the command that fixes it. ESM-128, 0.7.6. [See what the map is waiting for](story-map.md#see-what-the-map-is-waiting-for)
- **Change a story from its panel.** An Actions menu in the story panel picks a status, reason or release and copies the matching `story-map edit` command. ESM-111 and ESM-181, 0.7.6 and Unreleased. [Change a story from the board](story-map.md#change-a-story-from-the-board)
- **Map header and footer.** The header says when the map last changed, by whom and in which releases. The footer shows the library version, with links for internal viewers. ESM-609 and ESM-413, 0.6.1 and 0.5.0.

### Edit on your own machine

- **Save from the local preview.** On `story-map preview`, the story panel's Actions menu saves status and release changes to the map file, with the same checks as `story-map edit --write`. ESM-112, 0.7.6. [Preview the map locally](story-map.md#preview-the-map-locally)
- **Edit personas in place.** On a local board, reword a persona and their jobs, add or delete jobs, and add personas, without opening the YAML. A host's own board running locally can do the same. ESM-147, ESM-154, ESM-155 and ESM-156, 0.7.6. [Edit personas on your machine](story-map.md#edit-personas-on-your-machine)

## Audience and access

- **Uses the product's own sign-in.** The host passes the viewer from its session, and the library builds only what that viewer may see. Engineers and super admins see the internal map by default, and hosts can set their own rules. ESM-103, 0.1.0. [Audience settings](story-map.md#audience-settings)
- **A customer roadmap.** Signed-in customers see only stories approved for them, with customer-facing copy, and no internal notes, blocked or cut stories. A merged story shows as In progress. ESM-103, 0.1.0. [Audience settings](story-map.md#audience-settings)
- **Approved personas for customers.** Customers see a For line on stories whose personas have approved customer copy. ESM-905, 0.7.3. [Share personas with customers](story-map.md#share-personas-with-customers)
- **Safe by default.** `getStoryMapPage` projects for the viewer before it filters, and `storyMapResponseHeaders` gives no-store headers. ESM-605, 0.6.1. [Large maps](story-map.md#large-maps)

## Track delivery

- **Status history from Git.** Each story's history credits who changed it, from commit authors, or whoever merged a bot's work. ESM-307 and ESM-406, 0.3.0 and 0.4.0. [Show status history](story-map.md#show-status-history)
- **Stalled stories.** Stories that stay in progress too long are flagged. ESM-405, 0.4.0. [Flag stalled stories](story-map.md#flag-stalled-stories)
- **Pull requests and commits.** `story-map history` finds merged PRs and commits that name a story, and the panel shows them in a Changes section. History lines link to their PR and commit. ESM-120 and ESM-121, 0.7.4. [Link pull requests and commits to stories](story-map.md#link-pull-requests-and-commits-to-stories)
- **Tests linked to stories.** A test whose name starts with a story ID is indexed by `story-map tests`. Cards show the count, and the panel lists each test with a link to its line. A tagged `describe` block covers every test inside it. ESM-801, ESM-802 and ESM-119, 0.7.0 and Unreleased. [Link tests to stories](story-map.md#link-tests-to-stories)
- **Evidence for a story.** `story-map evidence` reports the branches, commits, plans, tests and broken sources that mention each story, and suggests a status without changing anything. ESM-105, 0.7.5. [Look up the evidence for a story](story-map.md#look-up-the-evidence-for-a-story)
- **Suggest shipped from release tags.** `evidence --shipped-tags` suggests shipped for merged stories that are in a matching release tag. ESM-107, 0.7.5.
- **Tokens used on a story.** `story-map tokens` counts the Claude Code tokens spent on a story and estimates their cost, and `edit --tokens --estimated-cost` records both on the story. ESM-145, 0.7.5. [Record the tokens used on a story](story-map.md#record-the-tokens-used-on-a-story)

## Review changes

- **Validate in CI.** `story-map validate` checks the map, reports problems by line on the PR diff with `--format github`, and prints JSON for scripts. Warnings do not fail CI unless you pass `--strict`. `--check-sources` checks links and headings, and `--tests` checks the story IDs in test names. ESM-102, ESM-303, ESM-401 and ESM-742, 0.1.0 to 0.7.2. [Validate a change](story-map.md#validate-a-change)
- **A rule and a link for every issue.** Each issue carries a stable rule ID and a link to the guide section that explains it. ESM-159, Unreleased. [Validation rules](story-map.md#validation-rules)
- **Summarise map changes.** `story-map diff` lists customer-facing changes first, then blocked and cut stories, then every story, activity and release change. ESM-304, 0.3.0. [Review a map change](story-map.md#review-a-map-change)
- **Changes that need a person.** The diff lists confirmed drafts, estimate changes, removed or renumbered stories, customer copy and settings changes under Needs a person. ESM-162, Unreleased. [Changes that need a person](story-map.md#changes-that-need-a-person)
- **Check pull requests in CI.** `story-map pr-check` fails a PR whose agent commits make a change only a person should make, until a person adds the `map-approved` label. It also fails a PR that marks a story merged without a Tokens used section. ESM-163, Unreleased. [Check a pull request in CI](story-map.md#check-a-pull-request-in-ci)
- **Confirm drafts.** `story-map confirm` shows a drafted job, persona context or impact item as readers see it. With `--write`, it removes `draft: true` only after a person types the ID back at a terminal. ESM-110, 0.7.6. [Confirm a draft](story-map.md#confirm-a-draft)
- **Review code against its story.** The engineering overview and host templates ask what the story promised, what shows it works and what could break, before the repository checks. Each PR records its review. ESM-179, ESM-182 and ESM-186, Unreleased. [Review a change before it is ready](story-map.md#review-a-change-before-it-is-ready)

## For agents

- **Read the map from the command line.** `story-map story`, `stories` and `releases` print text or JSON, with the board's filters and search. ESM-741, 0.7.2. [Read the map from the command line](story-map.md#read-the-map-from-the-command-line)
- **Edit the map from the command line.** `story-map edit`, `add`, `release-impact` and `settings` make named changes and print the diff and validation as a dry run until `--write`. Comments and untouched lines are kept. ESM-744, 0.7.2. [Change the map from the command line](story-map.md#change-the-map-from-the-command-line)
- **Outstanding actions.** `story-map actions` prints what the Actions tab shows, and says which items need a person. ESM-128, 0.7.6. [See what the map is waiting for](story-map.md#see-what-the-map-is-waiting-for)
- **Claim stories.** `story-map claim` records that an agent is on a story, as a Git ref on the remote or a file in a shared folder, so a second agent is told before it starts the same work. Claims expire, and `claims` and `unclaim` list and release them. ESM-106, 0.7.5. [Coordinate several agents](story-map.md#coordinate-several-agents)
- **Agent briefs.** A compact Markdown brief for a story or release: the targets, work already built nearby, work in flight, open decisions, the branch name and the repository's rules. ESM-123, 0.7.5. [Write a brief for an agent](story-map.md#write-a-brief-for-an-agent)
- **Copy or open a brief from the board.** Story and release panels copy the brief, or open it in Claude, ChatGPT or Claude Code on the web when the host turns them on. ESM-124, ESM-125 and ESM-144, 0.7.5. [Copy a brief from the board](story-map.md#copy-a-brief-from-the-board), [Open a brief in a web agent](story-map.md#open-a-brief-in-a-web-agent)
- **Briefs from the command line.** `story-map brief` prints the brief for stories, a release or an activity, with `--full` and `--format json`. ESM-126, Unreleased. [Write a brief from the command line](story-map.md#write-a-brief-from-the-command-line)
- **MCP server.** `story-map mcp` serves the read, validate, evidence, brief, edit and claim commands as MCP tools, with the CLI's safeguards. `--read-only` leaves out the tools that write. ESM-116, 0.7.6. [Serve the map over MCP](story-map.md#serve-the-map-over-mcp)
- **Rules for agents.** `init` writes the map rules into `AGENTS.md`, or into a Claude Code skill with `--skill`. ESM-117, ESM-150 and ESM-152, 0.7.6 and Unreleased. [Populate the first map](story-map.md#populate-the-first-map)

## Set up and upgrade

- **Install with `story-map init`.** Writes a starter map, the guide, an `AGENTS.md` section and a GitHub Actions workflow, without overwriting anything. Simple mode adds every part, and advanced mode adds the ones you choose. ESM-301 and ESM-171, 0.3.0 and Unreleased. [Choose the parts at install](story-map.md#choose-the-parts-at-install)
- **Draft the first map from a repository.** The first-run workflow tells an agent how to draft the map. `story-map survey` lists release tags, changelog versions, docs, plans and TODOs as JSON to start from. ESM-202 and ESM-118, 0.2.0 and 0.7.6. [Survey a repository](story-map.md#survey-a-repository)
- **Preview your map locally.** `story-map preview` serves your own map as a board on your computer, with internal and customer views, before you add the board to a product. ESM-746, 0.7.2. [Preview the map locally](story-map.md#preview-the-map-locally)
- **Review an upgrade.** `story-map upgrade` reports each set-up part's state, the version it came from and what this version changes, in plain words, without writing anything. ESM-166, ESM-167 and ESM-168, Unreleased. [Review the set-up after an upgrade](story-map.md#review-the-set-up-after-an-upgrade)
- **Apply an upgrade.** `upgrade --write` replaces unedited parts, adds missing ones and keeps whatever the host edited. Edited `AGENTS.md` rules are reviewed one at a time. The choice of simple or advanced mode is kept in `settings.upgrade`. ESM-169, ESM-170 and ESM-173, Unreleased. [Apply the changes](story-map.md#apply-the-changes)
- **Reminders when the set-up falls behind.** Validate prints one notice, never failing, when a set-up part comes from an older template. ESM-172, Unreleased.
- **Published with provenance.** The npm package is published with provenance. ESM-302, 0.3.0.

## Export

- **JSON for agents.** Every internal story with its notes, sources, history and tagged tests, plus notes on where the data came from and what it leaves out. ESM-706, 0.7.1. [Export as JSON for agents](story-map.md#export-as-json-for-agents)
- **Visio.** A `.vsdx` file of the internal map, with collapsed lanes, release notes and impact, for Lucidchart, Miro or Visio. ESM-702, 0.7.0. [Export the map](story-map.md#export-the-map)
- **CSV.** One row per story, safe to open in spreadsheets and importable into Miro and Lucidchart. ESM-705, 0.7.0. [Export as CSV](story-map.md#export-as-csv)
- **Personas in every export.** CSV, JSON and Visio carry each story's personas and jobs. ESM-906, 0.7.3.
- **Export from the command line or the board.** `story-map export` writes any format from the YAML file. Internal viewers get an Export menu when the host sets `exportHref`, and lanes they collapsed stay collapsed in the file. ESM-703 and ESM-704, 0.7.0. [Download from the board](story-map.md#download-from-the-board)
- **Spreo.** The Export menu includes a guide to building an interactive story board in Spreo. ESM-137, 0.7.6. [Integrations](integrations.md)

## Robustness and security

- **Hardened inputs.** CLI options never take the next flag as their value, sources cannot reach outside the repository through a symbolic link, and heading anchors and export file names are read in linear time, so a crafted PR cannot stall CI. ESM-606, ESM-610 and ESM-175, 0.6.1 and Unreleased.
- **Quiet PR summaries.** The diff escapes @mentions, so summaries do not notify people. ESM-607, 0.6.1.
- **Resilient rendering.** An unknown locale or time zone falls back to defaults, and long Git names cannot break the history file. ESM-608 and ESM-601, 0.6.1.
- **Property and model tests.** Generated maps check that the customer view never shows internal work and that edits keep IDs, drafts and comments. A model-based test checks that each story has at most one live claim. ESM-164 and ESM-165, Unreleased.
- **Code checks in CI.** Biome lint, a test coverage floor that only goes up, and CodeQL's security-and-quality queries. ESM-176, ESM-177 and ESM-178, Unreleased.

## Planned

These stories are planned in the map, and plans can change. [The changelog](../CHANGELOG.md) records what ships.

- **0.8.1, dependency planning and graph:** explore dependencies as a graph, focus it on a release or story, suggest a delivery order, and list prerequisites in briefs. ESM-140 to ESM-143.
- **0.8.2, map versions, steps and audit:** read, list, compare and switch to earlier versions of the map, expand activities into steps, and audit the map against the code on a schedule. ESM-108, ESM-109 and ESM-113 to ESM-115.
- **0.8.3, delivery visibility:** an Analytics tab with burn-up, burn-down, throughput and velocity reconstructed from Git, and delivery summaries on release lanes. ESM-130 to ESM-134 and ESM-174.
- **0.8.4, delivery intelligence:** lead time, release baselines with scope changes, and cumulative flow. ESM-135, ESM-136 and ESM-138.
