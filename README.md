# Auto Story Map
A live, Git-backed user story map that lives inside your app and stays up to date as you ship. Built in TypeScript, it maps your core user journey and stacks release slices from top to bottom—no separate whiteboard or manual grooming required.

Because it sits directly inside your product, there are no extra accounts to manage. Access hooks straight into your existing sign-in, exposing the full internal map to engineer and super-admin roles out of the box with customizable permission rules.

Export the map as JSON and an agent can review your stories and tests and suggest what to build next, with notes in the file on where the data came from and what it leaves out. You can also export it to Lucidchart, Miro, Visio or a spreadsheet. See [Export the map](#export-the-map).

[Try the live demo](https://autostorymap.com/demo), which shows this library's own story map.

## Code checks

[![Dependency Scan](https://github.com/duncan-m/auto-story-map/actions/workflows/dependency-scan.yml/badge.svg?branch=main)](https://github.com/duncan-m/auto-story-map/actions/workflows/dependency-scan.yml) - [![CodeQL](https://github.com/duncan-m/auto-story-map/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/duncan-m/auto-story-map/actions/workflows/codeql.yml) - [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/duncan-m/auto-story-map/badge)](https://scorecard.dev/viewer/?uri=github.com/duncan-m/auto-story-map)

## Screenshot

![This library's own story map in the demo, as a super admin sees it. Under the title, a line says when the map was last updated, by whom, and which releases recent changes focused on. Story map and Personas tabs sit above the search, status, persona and time filters and an Export menu. Activities from setting up to tracking delivery run across the top, each with avatars for the personas it serves, with a lane for each release and its expected impact, and story cards showing each story's ID, title, status and persona avatars.](https://raw.githubusercontent.com/duncan-m/auto-story-map/main/story-map-screenshot.png)

![Close-ups of the board: a story card for ESM-115 with persona avatars, an 8-point estimate, its status and dependency count; the story panel's dependencies list and its activity, release, tokens used and estimated cost; the Personas tab showing the Solo Builder's jobs to be done and the stories that serve them; and the Share menu with Copy link, Copy brief, and Open in Claude, Claude Code or ChatGPT.](https://raw.githubusercontent.com/duncan-m/auto-story-map/main/story-map-features.webp)

## Features

**Map and board**

- The story map is a validated YAML file in your repo, with a JSON Schema for editor autocomplete.
- A board for React hosts puts activities across the top and releases down the side, with cards showing each story's status, personas and estimate.
- Search, filter by status, persona, job or recent change, collapse release lanes, and share permalinks to stories and releases.
- The board works without client-side JavaScript. The optional `board.js` applies filters as soon as you choose them.

**Audience and access**

- The board uses your product's existing sign-in. Engineers and super admins see the internal map by default, and you can set your own permission rules.
- Signed-in customers see a roadmap of only the stories approved for them, with no internal notes, blocked or cut stories.

**Delivery tracking**

- Status history from Git credits who changed each story, and flags stories stalled in progress.
- Each story links to the pull requests and commits that name it, and to the tests tagged with its ID.
- Releases record their notes and expected impact, and stories their estimate in story points.
- Personas and their jobs to be done, with a Personas tab showing each job's steps, the stories that serve it and the gaps.

**For agents**

- A CLI reads the map (`story`, `stories`, `releases`), validates it and edits it, with JSON output and a dry run before each write.
- `story-map init` sets up the map, the guide, the rules in `AGENTS.md` and a GitHub Actions check that summarises story changes on each PR.
- A JSON export, with notes on its provenance and completeness, lets an agent review the map against the code.
- `story-map preview` shows your own map as a board on your computer.
- `story-map mcp` serves the read, validate, evidence, edit and claim commands as MCP tools, with the same safeguards.

**Export**: JSON, Visio (`.vsdx`, for Lucidchart, Miro or Visio) and CSV.

**Requirements**: Node.js 20 or newer and a TypeScript or JavaScript backend. The board needs React 18 or 19.

## Roadmap

Merged, coming in the next release:

- **Agent briefs**: copy a ready-made prompt for a story or release from its panel, or open it in Claude or ChatGPT.
- **Story dependencies**: record which stories a story depends on, and see them on its card and panel.

Planned:

- **Evidence and claims**: look up the evidence for a story, suggest shipped from release tags, and let several agents claim stories without clashing.
- **Update the map from the board**: confirm drafts and triage stories without editing the YAML, and list what validation flags on an Actions tab.
- **Map versions and audit**: view and compare earlier versions of the map, split activities into steps, and run a scheduled audit that proposes corrections from the code.
- **Agent integration**: an MCP server, an installable skill, a `story-map brief` command, and a survey that drafts a first map from a repo's history.
- **Delivery metrics**: burn-up, throughput, velocity, lead time and cumulative flow from Git history, with no sprints to maintain.

The full plan, story by story, is in [this library's own map][example-map]. Plans can change, and [the changelog][changelog] records what shipped.

## Try the demo

The [live demo](https://autostorymap.com/demo) needs no install. To run it locally, use Node.js 20 or newer. Run these commands from a checkout of the [source repository][source].

```sh
npm ci
npm run validate
npm test
npm run demo
```

The demo shows this library’s own story map, `product/story-map.yaml`. It covers what each release delivered, what is merged for the next one, and what is planned.

Open [the local story map](http://127.0.0.1:4173/story-map). It starts as **Super admin**, who sees the full internal map.

Things to try:

- Select **Link stories to their engineering overview** to open its details, then follow the **Engineering overview** link into these docs.
- Select the **0.4.0: Delivery tracking** release title to see its notes, expected impact and progress.
- Search for “history”, filter by status, or use **Changed** to see recent changes.
- Tick **Blocked** and **Cut** in the status filter to see the cut stories and their reasons. They are hidden by default.
- Open the **Personas** tab to see each persona, their jobs to be done and the stories that serve them.

The demo reads this repository’s Git history to show when each story changed and who changed it.

### Viewer roles

- **Super admin** sees the full internal map.
- **Regular user** sees the customer roadmap, where merged stories read as in progress.
- **Engineer**, **Product manager** and **Guest** views are also available. Product managers see the internal map because the demo host passes its own `canViewInternal` rule.

The demo listens on loopback and serves the same view as JSON at `/api/story-map`.

### Preview your own map

In a product that installs the library, `npx story-map preview` serves your own `product/story-map.yaml` as a board at `http://127.0.0.1:4173/story-map`, with internal and customer views, before you add the board to your product. It reads the map on every reload and shows validation errors on the page. See [Preview the map locally](docs/story-map.md#preview-the-map-locally).

## Embed it in a product

Install the package in your host product, then set it up:

```sh
npm install auto-story-map
npx story-map init
```

The core can run in a TypeScript or JavaScript backend. A React host can also use the board and stylesheet. To try unreleased changes, run `npm ci` and `npm pack` in a source checkout and install the resulting tarball instead.

| Import | Use |
| --- | --- |
| `auto-story-map` | Parse the YAML, select the viewer’s view and apply search filters on the server, and export it as JSON, Visio or CSV. |
| `auto-story-map/react` | Render a view with `<StoryMapBoard map={view} />`. |
| `auto-story-map/styles.css` | Style the board using namespaced CSS. |
| `auto-story-map/schema.json` | Give editors autocomplete and inline checks for the YAML. |

[The host integration][host] shows how a product can serve the board and JSON with the same audience rules. [The example delivery plan][delivery-plan] shows how plans reference stories by ID, using the builder estimates sample map in `test/fixtures/builder-estimates.yaml`.

The map lives in the product repo. The deployed product renders the file included in that revision. Use the host app’s verified session to resolve the viewer on the server and supply the projected view to the board.

## Upgrade an existing install

In your host repo:

1. Run `npm install auto-story-map@0.7.4`.
2. Keep your existing `product/story-map.yaml`.
3. Rebuild the app with the updated stylesheet.

What each version needs from you:

| Version | What it adds | Upgrade steps |
| --- | --- | --- |
| 0.7.4 | CLI commands, personas, links to code and estimates | None |
| 0.7.1 | JSON export for agents | None |
| 0.7.0 | Visio and CSV export, tests linked to stories, and a status filter with several choices | Host code that reads `filter.status` must treat it as an array. Follow the [0.7.0 upgrade steps][upgrade]. |

Upgrading from an older version? Follow these steps first, oldest first:

- From 0.2.0 or earlier: the [0.3.0 upgrade steps](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-030).
- From 0.3.0 or earlier: the [0.4.0 upgrade steps](https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-040).

See [the changelog][changelog] for the details of each version.

## Populate the first map

Run `npx story-map init` in the host repo. It creates:

- a starter `product/story-map.yaml` that points editors at the JSON Schema,
- [the story map guide][guide] in `docs/story-map.md`,
- a story map section at the end of `AGENTS.md`, keeping any existing instructions,
- a GitHub Actions workflow in `.github/workflows/story-map.yml` that validates the map and its sources on each PR and adds a summary of the story changes, starting with what customers will see. Pass `--no-ci` to skip it. The workflow is written only when the repo uses npm.

Pass `--skill` to put the rules and common commands in a skill at `.claude/skills/story-map/SKILL.md` instead. `AGENTS.md` then gets a short pointer to the skill, so agents read the full rules only when a task needs them. The skill and the full section come from the same template.

It never overwrites an existing file, so it is safe to run again. [This library’s own map][example-map] shows a fuller map.

For a repo that already has history, `npx story-map survey --format json` lists its release tags and changelog versions, its docs and their headings, and its open plans and `TODO` comments, for the agent to draft the map from. It reads and suggests only. See [Survey a repository](docs/story-map.md#survey-a-repository).

Start an agent in the host repo and give it this task.

> Populate `product/story-map.yaml` for this product using the [first-run workflow][first-run]. Survey the repository first, then start with the primary user journey and cite the evidence for each story. Use a [Markdown heading link][engineering-overview] where an engineering overview exists. Validate the map, open a few story cards if the host renders the board, and flag any uncertain release or status decisions for review.

## Read the map from the command line

Agents and people can read the map without opening the YAML file. Each command prints text, or JSON with `--format json`:

```sh
npx story-map stories --query "export" --status all
npx story-map story ESM-741
npx story-map releases
npx story-map evidence ESM-105
npx story-map claim ESM-106 --agent audit-bot
npx story-map validate --format json product/story-map.yaml
```

`stories` takes the board's filters, `evidence` reports the branches, merged commits, plans, tests and broken sources that mention a story and suggests a status, `claim` tells a second agent that someone is already on a story, and `story-map help <command>` lists each command's options. See [Read the map from the command line](docs/story-map.md#read-the-map-from-the-command-line).

Change it the same way. Each edit is a dry run that prints the YAML diff, the PR summary and any problems it causes, until you add `--write`. Comments and untouched lines stay exactly as they were:

```sh
npx story-map edit ESM-744 --status in-progress
npx story-map add --activity review --release v0-7-5 --title "Check claims in CI" --write
```

See [Change the map from the command line](docs/story-map.md#change-the-map-from-the-command-line).

Agents that call tools rather than run commands can use the same reads, edits and claims over MCP with `npx story-map mcp`, after installing `@modelcontextprotocol/sdk`. See [Serve the map over MCP](docs/story-map.md#serve-the-map-over-mcp).

## Export the map

Exports are a one-way snapshot of the internal map. The YAML file stays the source of truth, and edits made elsewhere do not come back. Customers can never export the map.

### Review it with an agent

The JSON export is made for agents. It holds every activity and release, with their notes and expected impact, and every story with its summary, status, engineering notes, sources, status history and tagged tests. Two sections tell the agent how far to trust it:

- `provenance` says which version of the library wrote the file, when the history and tests were gathered, and that statuses are recorded in PRs and can lag behind the code.
- `completeness` counts the stories included and left out, and says what the agent cannot see, such as tests that do not name a story or a history built from a shallow clone.

Build the history and tests index, then export:

```sh
npx story-map history --out story-map-history.json
npx story-map tests --tests test --out story-map-tests.json
npx story-map export --format json --history story-map-history.json --tests-index story-map-tests.json --output story-map.json
```

Unlike the other formats, the JSON file includes every story and every release, even ones collapsed on the board. Give it to an agent with a task such as:

> Read `story-map.json`, starting with its `provenance` and `completeness` notes. Review the stories and their tests: flag merged or shipped stories with no tagged tests, statuses that look out of step with the code, and impact that is still a draft. Then suggest up to five features or improvements that fit the user journey, citing the story IDs each one builds on. Check anything you rely on against the repository before you recommend it.

The file includes internal notes and the names of people who edited the map, so keep it within the team. Internal viewers can also download it from the board's **Export** menu, as **JSON, for agents and scripts**, when the host sets `exportHref`, and a host can build it with `storyMapToJson`. The JSON export is new in 0.7.1. See [Export as JSON for agents][json-export] for the full format.

### Open it in other tools

- **Visio (`.vsdx`)**, for Lucidchart, Miro or Visio: one page laid out like the board, with each release's notes and impact and a card per story.
- **CSV**, for Miro or a spreadsheet: a row per story with its activity, release, ID and title.

Use `npx story-map export --format vsdx` or `--format csv`, or the board's **Export** menu. These formats include at most the 200 most recently changed stories, and keep the lanes collapsed on the board collapsed. See [Export the map][export] for host routes and options.

## Limitations

The deployed board is read-only. Every change to the map, including release notes and expected impact, is made in `product/story-map.yaml` through a PR, usually by an agent working in the host repo, and appears once that PR is merged and deployed.

You can’t edit the map in the deployed app. The map ships with each deployment, so an edit saved from the board would only appear after a merge and redeploy, and could overwrite newer changes on the default branch. Editing in the app would need the map stored on a separate hosted service instead of in the product repo. That isn’t part of this library. While you run the app on your own machine, the Personas tab can [edit personas][edit-personas] and save them to your checkout, ready for a PR.

## Changes and releases

See [the changelog][changelog] for what changed in each version and [the release steps][releasing] for publishing a new one. To work on the library itself, start with [the engineering overview][overview].

## Licence

Copyright (C) 2026 Duncan Malcolm.

Auto Story Map is licensed under the [GNU Affero General Public License, version 3 only][license] (`AGPL-3.0-only`).

## Disclaimer

Auto Story Map is pre-1.0 software. Until 1.0.0, any minor version, such as 0.4.0 to 0.5.0, can include breaking changes to the map format, the API, the CLI, or the board’s markup and class names. Each breaking change is marked **Breaking** in [the changelog][changelog] with its upgrade steps. Pin the version you install, read the changelog before you upgrade, and check the board and your CI after each upgrade.

This software and its documentation are provided “as is”, without warranties or conditions of any kind, either express or implied, including any warranties or conditions of title, non-infringement, merchantability or fitness for a particular purpose. No guarantee is made that the software will work as described, be free of errors or security vulnerabilities, or stay compatible with your product, its dependencies or future versions.

In no event shall the author or contributors be liable for any damages arising from the use of, or inability to use, this software, including direct, indirect, special, incidental or consequential damages, data loss, exposure of information, service interruption or lost profits, however caused and whether in contract, strict liability or tort (including negligence), even if advised of the possibility of such damages.

You use the software at your own risk and are responsible for reviewing, testing and securing it before using it in your product. That includes deciding who can see the map: the library decides what each viewer sees, but your product must sign viewers in, pass their roles from a verified session, and keep internal content out of public pages and caches.

The [GNU Affero General Public License, version 3][license], in particular its sections 15 (Disclaimer of Warranty) and 16 (Limitation of Liability), governs your use of this software. Where this summary and the licence differ, the licence applies.

[source]: https://github.com/duncan-m/auto-story-map
[example-map]: https://github.com/duncan-m/auto-story-map/blob/main/product/story-map.yaml
[guide]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md
[first-run]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#populate-the-first-map
[upgrade]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#upgrade-to-070
[engineering-overview]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#link-an-engineering-overview
[delivery-plan]: https://github.com/duncan-m/auto-story-map/blob/main/docs/example-builder-estimate-plan.md
[host]: https://github.com/duncan-m/auto-story-map/blob/main/example/host.mjs
[changelog]: https://github.com/duncan-m/auto-story-map/blob/main/CHANGELOG.md
[releasing]: https://github.com/duncan-m/auto-story-map/blob/main/docs/releasing.md
[overview]: https://github.com/duncan-m/auto-story-map/blob/main/docs/ENGINEERING-OVERVIEW.md
[license]: https://github.com/duncan-m/auto-story-map/blob/main/LICENSE
[export]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#export-the-map
[edit-personas]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#edit-personas-on-your-machine
[json-export]: https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#export-as-json-for-agents
