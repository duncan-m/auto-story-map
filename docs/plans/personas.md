# Plan: personas on the story map

Status: ESM-901 to ESM-906 are merged, ready for the 0.7.3 release, in the **0.7.3: Personas** release of the map. ESM-907 to ESM-909 are planned for the same release, and ESM-910 for **0.7.6: PM improvements**. The release's notes and expected impact are in the map.

A story map answers “what do we build, in what order”. It does not yet say **who each story is for**, or **which need it meets**. Personas and their jobs to be done add that: the map file names the people the product serves and the jobs each of them is trying to get done, each story says which jobs it serves, and the board lets viewers read the map one persona at a time and see which jobs have no stories.

Items are numbered in the order they should be built, and each section uses the same number:

1. [Define personas in the map file](#1-define-personas-in-the-map-file) · ESM-901
2. [Show who a story is for](#2-show-who-a-story-is-for) · ESM-902
3. [Filter the board by persona](#3-filter-the-board-by-persona) · ESM-903
4. [Open a persona to see jobs and coverage](#4-open-a-persona-to-see-jobs-and-coverage) · ESM-904
5. [Share approved personas with customers](#5-share-approved-personas-with-customers) · ESM-905
6. [Include personas in exports](#6-include-personas-in-exports) · ESM-906
7. [Describe a persona's context](#7-describe-a-personas-context) · ESM-907
8. [Mark a persona's core job](#8-mark-a-personas-core-job) · ESM-908
9. [Write job statements with a trigger and a stake](#9-write-job-statements-with-a-trigger-and-a-stake) · ESM-909
10. [Break a job into steps](#10-break-a-job-into-steps) · ESM-910

Items 7 to 10 came from comparing the format with a fuller persona template: a role with what the persona is judged on, their daily tools, their constraints, one core job story, and the workflow steps of that job. Items 7 to 9 are small and fit 0.7.3, which has not shipped. Item 10 changes the persona panel and its coverage, so it waits for 0.7.6, next to activity steps (ESM-501).

All stories are internal. Item 5 changes what customers can see, but only for personas whose customer copy has been approved, as for stories today. Jobs are internal only.

## UI mockup

![Mockup of the board filtered to the Product manager persona, with the story and persona panels](personas-mockup.png)

The mockup is [personas-mockup.html](personas-mockup.html), built on the real `styles.css`. To refresh the image, open it in a browser at 1360 px wide and take a full-page screenshot. The cards are real stories with illustrative persona tags. Each persona story links to this section from its `sources`, and the 0.7.3 release notes name it.

What it shows:

1. **Persona strip** under the toolbar. One chip per persona, with initials, a colour and the number of active stories for them. A chip is a link to `?persona=<id>`, so it works without JavaScript.
2. **Persona filter** in the toolbar, next to status and “Changed in”. The chip strip and the select set the same parameter.
3. **Activity avatars**: who each step of the journey serves, derived from the stories under it.
4. **Card avatars** beside the story ID: up to three, then “+N”.
5. **“For” row** in the story panel, first in the context list.
6. **Persona panel**: the summary and the persona's jobs to be done, each with the stories that serve it, worked out from the map. A job with no stories stands out, and drafted jobs are labelled **Draft**.
7. **Jobs row** in the story panel: the job statements the story serves, each with its persona.

When a persona is chosen, releases with no matching stories are hidden, as the other filters do now. A rejected alternative was to dim non-matching cards instead of hiding them. It keeps the shape of the map, but on large maps the persona's stories are hard to find among the dimmed ones. It could come back as a “Highlight” option later.

## Persona context mockup

![Mockup of the persona panel before and after items 7 to 10, for a Revenue Operations Manager persona](persona-context-mockup.png)

The mockup is [persona-context-mockup.html](persona-context-mockup.html), built on the real `styles.css` like the one above. It shows the persona panel for a Revenue Operations Manager in a host product, as it is today and with items 7 to 10: context, a core job, a fuller job statement and the core job's steps. Story counts are illustrative. ESM-907 to ESM-910 link to this section from their `sources`.

## The format

```yaml
personas:
  - id: pm
    title: Product manager
    summary: Owns the roadmap and decides what goes in each release.
    jobs:
      - id: plan-release
        situation: a release is being planned
        motivation: to agree its scope in the PR that changes the map
        outcome: engineers and product start from the same list
      - id: answer-whats-next
        situation: someone asks what is in the next release
        motivation: to open the map inside the product
        outcome: I can answer without asking engineering
      - id: share-roadmap
        situation: customers ask what is coming
        motivation: to show them approved stories only
        outcome: I can answer without leaking internal work
        draft: true       # drafted by an agent; only a person removes it
    customer:            # optional, approved wording only
      title: Product teams
stories:
  - id: ESM-104
    title: Render the map as a board in the product
    activity: explore
    release: v0-1
    personas: [customer]
    jobs: [answer-whats-next, review-in-context]   # review-in-context is an Engineer job
```

ESM-104's personas resolve to Product manager and Engineer, from its jobs, and Product customer, from `personas`.

The board reads each job as a job statement: “**When** a release is being planned, **I want** to agree its scope in the PR that changes the map, **so** engineers and product start from the same list.”

- `personas` on the map is optional, up to 12 entries. Each has the usual `id`, `title`, `summary` and `customer`, plus optional `jobs`.
- `jobs` on a persona is optional, up to 8 entries. Each job has an `id`, unique across the map, and three required fields of up to 200 characters: `situation` (“When …”), `motivation` (“I want …”) and `outcome` (“so …”). Write each without its lead word, which the board adds. `draft: true` marks a job an agent drafted and nobody has confirmed. Only a person removes it, as for release impact.
- `jobs` on a story is optional: up to 4 job IDs, in order of importance. A story's personas are the owners of its jobs plus any listed in its own `personas`, so a story that names its jobs does not need to repeat their personas.
- `personas` on a story is optional: up to 4 persona IDs, for a story that helps a persona but no single job of theirs. The first persona, from either list, is the primary one.
- Initials come from the title (“Product manager” → PM), and the colour from the persona's position in the list, so neither is stored. A six-colour palette is enough for 12 personas, because initials and colour together tell them apart.
- Activities and releases get no `personas` field. Activity avatars are derived, so there is nothing to keep in sync.

## Decisions to make

| Question | Recommendation | Alternatives |
| --- | --- | --- |
| A. Where personas live | In `story-map.yaml`, next to activities and releases | A separate `personas.yaml`. Rejected: one file is the source of truth, and validation would need two |
| B. Can a story have several personas | Yes, up to 4, first is primary | One persona per story. Simpler, but forces a choice for shared stories such as search |
| C. Untagged stories | Allowed. The filter has no “Untagged” option at first, and validate warns only when the map has personas and more than half of the active stories are untagged | Make `personas` required once the map defines any. Too strict for existing maps |
| D. What a persona filter keeps | Stories tagged with any chosen persona. Several personas can be chosen, like statuses | Primary persona only |
| E. Persona fields | `id`, `title`, `summary`, `jobs`, `customer`, and from item 7 an internal `context` with accountability, tools and constraints | Add `pains`, `quote` or an image. Still deferred; images also raise hosting and privacy questions. Item 7 reopens this decision for context only, because constraints change what a story can assume |
| J. Which job is the core job | The first job in the persona's list (item 8) | A `core: true` field. Explicit, but two ways to say the same thing, and validation would need to allow only one |
| F. Customer view | Show approved personas as a “For” line in the story panel only | No personas for customers at all. Also fine; item 5 can be dropped without affecting the rest |
| G. Release | Decided: a new **0.7.3: Personas** release, after the export work and the CLI to read and edit the map | — |
| H. Jobs to be done | Decided: structured jobs on each persona, with IDs that stories reference, in place of free-text goals | Job statements as free text, which cannot be checked. Jobs as their own list, shared between personas: more to maintain and show, for a case that is rare until teams ask |
| I. Who writes jobs | Agents may draft jobs from the product's docs, issues and research, marked `draft: true`. A person confirms each by removing `draft` | Only people write jobs. Safer, but slows the first map down |

### Assumptions to confirm

- **Search matches persona titles** for internal viewers, so searching “agent” finds stories for the Coding agent persona.
- **Persona counts on chips** count active stories only, like the release counts, and ignore the other filters so the numbers do not jump as you filter.
- **Removing a persona or job** that stories still use is an error, like removing an activity. Renaming one keeps its ID.
- **Moving a job to another persona** keeps its ID, so stories follow it without an edit.
- **Jobs are not shown on cards**, only in the story and persona panels, so cards stay short.
- **No change to the status history**. A persona change counts as an edit to the story for “last updated”, because the history already compares whole stories.

## Suggested order

| Item | Name | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Define personas in the map file | M | — |
| 2 | Show who a story is for | M | 1 |
| 3 | Filter the board by persona | S | 2 |
| 4 | Open a persona to see jobs and coverage | M | 2 |
| 6 | Include personas in exports | S | 1 |
| 5 | Share approved personas with customers | S | 2 |
| 7 | Describe a persona's context | S | 4 |
| 8 | Mark a persona's core job | S | 4 |
| 9 | Write job statements with a trigger and a stake | S | 1 |
| 10 | Break a job into steps | M | 4, and ESM-501 if steps should point to activity steps |

Items 1 and 2 can share a PR if the first is small. Every PR follows the repository's rules: update `product/story-map.yaml` in the same PR, run `npm run validate` and `npm test`, add a `## Unreleased` entry to `CHANGELOG.md`, and include the `story-map diff origin/main` summary in the PR description. Tag new tests with the story ID, such as `test("ESM-901: rejects an unknown persona", …)`.

---

## 1. Define personas in the map file

**Change.**

- `src/schema.ts`: add the `persona` and `job` objects and the optional `personas` list to the map, and `personas` and `jobs` to the story. The lenient schema drops them for older maps, as it does for other fields.
- Cross-reference checks: duplicate persona IDs, duplicate job IDs across the map, unknown persona or job IDs on a story, the same persona or job twice on a story, and a customer-facing persona used on a story that has no customer copy (allowed, but the persona is not shown).
- Warnings:
  - a persona no story uses, and the untagged-stories rule from decision C;
  - a job no active story serves, such as “Job share-roadmap (Product manager) has no stories”;
  - an active story tagged with a persona that has jobs, but serving none of them: it may not match a known need;
  - a drafted job whose stories have shipped, as for drafted impact.
- A shared helper resolves a story's personas from its `jobs` and `personas`, so the view, filter and exports agree.
- `story-map.schema.json` is rebuilt, so editors complete persona IDs.
- `src/diff.ts`: report added, removed and renamed personas and jobs, changed job statements, and persona and job changes on stories, such as “ESM-104: serves answer-whats-next (was plan-release)”. Customer-facing persona copy is called out like other customer copy.
- `src/init.ts` and `templates/`: the starter map gets one example persona with one job.
- Dogfood: add personas and their jobs to this repository's map (Product manager, Engineer, Coding agent, Product customer) and tag existing stories with the jobs they serve.

**Docs.** A **Personas** section in `docs/story-map.md`, a row in [Where an edit belongs](../story-map.md#where-an-edit-belongs), and a step in the [first-run workflow](../story-map.md#populate-the-first-map): the agent drafts personas from the host product's roles, sign-in roles and docs, and their jobs from docs, issues and research, marks each job `draft: true`, keeps them internal, and asks a person to confirm them. The section explains job statements and how to write each field. `AGENTS.md` gets one sentence: tag new stories with the existing jobs they serve, never invent a persona or job without marking it `draft: true` and saying so in the PR, and never remove `draft` yourself.

**Tests.** Valid and invalid persona and job maps, each warning, the diff lines, the resolved personas of a story with jobs, and a property test that every persona and job reference survives `parseStoryMap` round trips.

## 2. Show who a story is for

**Change.**

- `src/view.ts`: the internal view gains `personas: PersonaLabel[]` (id, title, summary, jobs, initials, colour index) and each story card gains `personas: string[]`, resolved from its jobs and personas, and `jobs: string[]`.
- `src/react.tsx`:
  - `PersonaAvatar` and `PersonaAvatars` components, with the persona title as accessible text (“For Product manager and Coding agent”), so screen readers do not read initials.
  - Card avatars in a new `esm-card-head` row beside the ID.
  - Activity avatars from the union of the personas of the activity's active stories.
  - A **For** row first in the story panel's context list, then a **Jobs** row with each job statement and its persona.
- `styles.css`: `--esm-persona-0` to `--esm-persona-5` with matching backgrounds, in light, dark and auto themes. Check each pair for 4.5:1 contrast.
- Narrow screens: avatars stay on cards; activity avatars are hidden with the activity row, as now.

**Tests.** Rendering with and without personas, accessible names, the “+N” overflow, and that a map without personas renders exactly as before.

## 3. Filter the board by persona

**Change.**

- `src/filter.ts`: `StoryMapFilters.persona?: readonly string[]` and `job?: readonly string[]`, read from repeated `persona` and `job` parameters. Unknown IDs are ignored. `filter.persona` and `filter.job` are set on the view when they narrow anything. The job filter has no toolbar control: the persona panel's **Show stories** links set it, and the filter summary names the job with a link to clear it.
- Search also matches persona titles and job statements (internal only).
- `src/react.tsx`: the persona strip under the toolbar and a persona menu in the toolbar, built like the status menu (`<details>` with checkboxes). The strip is hidden when the map has no personas.
- `src/board.js`: apply persona changes as they happen, like the other filters.
- Persona chips keep the other parameters, through `preservedParams`, like the other filter links.

**Tests.** URL reading, combined filters, a persona or job with no stories, that customers' persona parameters only match customer-facing personas, and that customers' job parameters are ignored.

## 4. Open a persona to see jobs and coverage

**Change.** A `PersonaDetail` popover, opened from a chip, an avatar or the story panel's **For** row, using the same popover pattern as `ReleaseDetail`. It shows:

- the summary;
- **Jobs to be done**: each job statement, a **Draft** label on drafted jobs, a bar and count of the stories that serve it by status, and a **Show stories** link that applies the job filter. A job with no active stories says **No stories yet**, which is the gap the 0.7.3 impact asks teams to close;
- a link that applies the persona filter.

Coverage uses the unfiltered view so it does not change with filters.

**Tests.** Counts per job, cut and blocked stories left out of the bar, the no-stories state, the draft label, and that the panel works without JavaScript.

## 5. Share approved personas with customers

**Change.** The customer projection keeps only personas with `customer` copy that at least one published story uses, renumbered like activities (`persona-1`, …) so internal IDs never leak. Customer cards show no avatars; the story panel shows a **For** line with the customer titles. The persona filter is offered to customers only when two or more personas are visible.

The customer view never includes jobs, even for customer-facing personas. A story whose personas come only from its jobs still gets a **For** line when those personas are customer-facing.

**Tests.** Internal-only personas and all jobs never appear in the customer view or its JSON, IDs are replaced, and a story tagged only with internal personas shows no **For** line.

## 6. Include personas in exports

**Change.**

- CSV: `Personas` and `Jobs` columns, with persona titles and job IDs joined by “; ”.
- JSON for agents: the map's `personas` with their jobs and statements, and each story's `personas` and `jobs`, so an agent can find jobs with no stories and stories that serve no job, and suggest work for them.
- Visio: `Personas` and `Jobs` fields in each card's shape data, so Lucidchart can filter by them. No avatars on the exported cards for now.

**Tests.** Each export with and without personas and jobs; CSV escaping of persona titles.

## 7. Describe a persona's context

The summary says who a persona is, but not what they are judged on, what they work with or what holds them back. Those constraints shape what a story can assume, such as “no engineering support for integrations”, so the team and agents should see them when they plan.

```yaml
personas:
  - id: pm
    title: Product manager
    summary: Owns the roadmap and decides what goes in each release.
    context:
      accountability: Judged on whether releases land with the scope agreed at planning.
      tools: [GitHub, Linear, Slack, Figma]
      constraints:
        - Cannot change code, so relies on engineers or agents to edit the map
        - Shares plans with customers only through approved copy
      draft: true
```

**Change.**

- `src/schema.ts`: an optional `context` on a persona, with `accountability` (up to 200 characters), `tools` (up to 8 names of up to 60 characters), `constraints` (up to 6, of up to 200 characters) and `draft`. All parts are optional, but `context` needs at least one of the first three. `draft: true` works as for jobs: agents set it, and only a person removes it.
- `src/view.ts`: the internal persona label carries `context`. The customer projection drops it, even for a customer-facing persona.
- `src/react.tsx`: the persona panel shows **Accountable for**, **Tools** and **Constraints** between the summary and the jobs, with a **Draft** label on drafted context.
- `src/diff.ts`: report added, removed and changed context under **Personas and jobs**, and a confirmed draft.
- JSON export: each persona's `context`. `story-map stories --query` and board search do not match it, so results stay about stories.
- Validate warns about drafted context on a persona that a shipped story is for, as for drafted jobs.
- Dogfood: draft context for this repository's four personas, marked `draft: true`.

**Docs.** The fields in [Personas and jobs to be done](../story-map.md#personas-and-jobs-to-be-done), and a sentence in the first-run workflow: draft context from the product's docs and research, mark it `draft: true`, and leave out what you cannot support with a source.

**Tests.** Valid and invalid context, the customer view never including it, the panel with and without it, and the diff lines.

## 8. Mark a persona's core job

A persona usually has one job that matters most, and the rest support it. Today the order of jobs means nothing, so the board cannot show which job to cover first.

**Change.**

- The first job in a persona's `jobs` is their core job. No new field (decision J).
- `src/react.tsx`: the persona panel labels it **Core job** and sets it apart from the others, with “When”, “I want” and “so” each starting a new line, the lead words in a column of their own. The story panel's **Jobs** row marks it too.
- Validate: a core job with no active stories gets its own warning, such as “Core job plan-release (Product manager) has no stories”, in place of the usual one.
- `src/diff.ts`: report a change of core job when jobs are reordered, such as “Product manager's core job: plan-release → track-progress”.
- JSON export: `core: true` on the first job of each persona, so agents need not know the rule.
- Dogfood: put each persona's core job first in this repository's map.

**Docs.** The rule in the field table and the job-writing advice, and that reordering jobs changes the core job.

**Tests.** The label, the warning, the diff line on reorder, and that a persona with one job treats it as core.

## 9. Write job statements with a trigger and a stake

The format already reads as “When …, I want …, so …”, but drafts such as “When I start a task” say little. A good statement names the moment and what makes it hard, and the outcome names what is at stake: “When I'm preparing the Monday forecast and spot conflicting numbers between our CRM and billing tools, I want to quickly trace and reconcile the discrepancies, so I can present numbers I can defend to leadership without losing my Sunday evening to spreadsheets.”

**Change.**

- [Personas and jobs to be done](../story-map.md#personas-and-jobs-to-be-done): `situation` names the trigger and the complication, not only the moment. `outcome` names what gets better and what it costs today. One full example, and a weak and a strong version side by side.
- `src/schema.ts`: the field descriptions say the same, so editors and agents see it.
- First-run workflow: agents write jobs this way and cite the research or issue each one comes from in the PR.
- Dogfood: rewrite this repository's drafted jobs to this standard, keeping their IDs and `draft: true`, so stories keep their tags and a person still confirms each one.

No validation changes. A rule on length or wording would flag good short statements, so this is guidance only.

**Tests.** None beyond validation of the rewritten map.

## 10. Break a job into steps

A job is done in steps, such as gather, audit, verify and brief. Steps show which part of a job the stories help with, and where the gaps are. They are also what a story map's activities describe, so each step can point to the activity where its stories live.

```yaml
jobs:
  - id: plan-release
    situation: …
    steps:
      - title: Gather
        summary: Collect the candidate stories and the evidence for each
        activity: plan
      - title: Agree scope
        summary: Settle what is in and out in the PR that changes the map
        activity: review
```

**Change.**

- `src/schema.ts`: optional `steps` on a job, up to 6, in order. Each has a `title` (up to 60 characters), an optional `summary` and an optional `activity` ID. An unknown activity is an error, as for stories.
- Coverage: the stories for a step are those that serve the job and sit in the step's activity. A step without an activity has no coverage of its own.
- `src/react.tsx`: the persona panel lists a job's steps in order, each with its count of active stories, and **No stories yet** for a step with an activity but no stories. A **Show stories** link per step sets `job` and `activity`.
- Validate warns about a step whose activity has no active stories for its job.
- `src/diff.ts` and the JSON export: steps and their coverage.
- Once activity steps land (ESM-501), a step can point to an activity step instead. Settle the shape with ESM-501 before building either.

**Docs.** Steps in the persona section, and how they relate to activities.

**Tests.** Valid and invalid steps, coverage per step, the warning, and the panel with and without steps.

## Later

- **Persona swimlanes**: an option to group rows by persona instead of release, for discovery workshops.
- **Gaps in the audit**: the scheduled map audit lists jobs with no planned stories and proposes stories for them.
- **Job outcomes**: record whether a shipped story got the job done, alongside release impact.
- **Highlight mode**: dim rather than hide stories for other personas.
