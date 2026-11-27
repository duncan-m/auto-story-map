#!/usr/bin/env node
import actions from "./commands/actions.js";
import { claim, claims, unclaim } from "./commands/claim.js";
import confirm from "./commands/confirm.js";
import diff from "./commands/diff.js";
import { add, edit, releaseImpact, settings } from "./commands/edit.js";
import evidence from "./commands/evidence.js";
import exportMap from "./commands/export.js";
import history from "./commands/history.js";
import init from "./commands/init.js";
import mcp from "./commands/mcp.js";
import plan from "./commands/plan.js";
import preview from "./commands/preview.js";
import { releases, stories, story } from "./commands/read.js";
import { ArgumentError, type Command } from "./commands/shared.js";
import tests from "./commands/tests.js";
import tokens from "./commands/tokens.js";
import survey from "./commands/survey.js";
import validate from "./commands/validate.js";
import { defaultExportMaxStories } from "./export.js";

const usage = `Usage:
  story-map init [--no-ci] [--skill] [--dir <path>]
  story-map validate [--format text|github|json] [--strict] [--check-sources] [--plans <path>] [--tests <path>] <map.yaml> [...]
  story-map diff [--format markdown|json] [--map <path>] <base-ref>
  story-map history [--map <path>] [--ref <ref>] [--out <file>] [--bot-names <names>] [--allow-shallow]
  story-map tests [--tests <path>] [--root <path>] [--out <file>] [<map.yaml>]
  story-map export --format vsdx|csv|json [--output <file>] [--history <file>] [--tests-index <file>] [--collapsed <release IDs>] [--max-stories <n>] [<map.yaml>]
  story-map story [--format text|json] [--map <path>] [--history <file>] [--tests-index <file>] <ID> [...]
  story-map stories [--format text|json] [--map <path>] [--status <status>] [--release <ID>] [--activity <ID>] [--persona <ID>] [--job <ID>] [--readiness <state>] [--query <text>] [--changed-within <days>] [--history <file>] [--tests-index <file>]
  story-map releases [--format text|json] [--map <path>] [--history <file>] [--tests-index <file>] [<release ID> ...]
  story-map actions [--format text|json] [--map <path>] [--kind <kind>] [--item-type <type>] [--release <ID>] [--needs-person] [--tests <path> | --tests-index <file>] [--root <path>]
  story-map evidence [--format text|json] [--map <path>] [--root <path>] [--default-branch <name>] [--plans <path>] [--tests <path>] [--history <file>] [--shipped-tags <pattern>] [--claims] [--claims-remote <name>] [--claims-store <dir>] [<ID> ...]
  story-map survey [--format text|json] [--root <path>] [--tags <pattern>] [--changelog <file>] [--docs <path>] [--plans <path>]
  story-map claim [--format text|json] [--map <path>] [--remote <name>] [--store <dir>] --agent <name> [--ttl <duration>] [--branch <name>] [--renew | --take-over] <ID>
  story-map claims [--format text|json] [--remote <name>] [--store <dir>]
  story-map unclaim [--format text|json] [--remote <name>] [--store <dir>] [--agent <name>] <ID>
  story-map tokens [--format text|markdown|json] [--map <path>] [--logs <path>] [--branch <name>] [--session <ID>] [--prices <file>] <ID>
  story-map edit <ID> [--status <status> [--reason <text>]] [--release <ID>] [--activity <ID>] [--title <text>] [--summary <text>] [--notes <text>] [--add-source <source>] [--remove-source <source>] [--add-job <ID>] [--remove-job <ID>] [--add-persona <ID>] [--remove-persona <ID>] [--add-dependency <ID>] [--remove-dependency <ID>] [--customer-title <text>] [--customer-summary <text>] [--priority must|should|could|none] [--tokens <n>] [--estimated-cost <usd>] [common edit options]
  story-map edit --from <edits.json> [common edit options]
  story-map add --title <text> --activity <ID> --release <ID> [--id <ID>] [--status <status> [--reason <text>]] [--summary <text>] [--notes <text>] [--source <source>] [--job <ID>] [--persona <ID>] [--dependency <ID>] [common edit options]
  story-map release-impact <release ID> --metric <text> --expected <text> [--solves <text>] [common edit options]
  story-map settings --plans <folder>|off [common edit options]
  story-map plan [--map <path>] [--release <ID>] [<ID> ...]
  story-map confirm [--format text|json] [--map <path>] [--write] <job ID> | <persona ID> | <release ID> --impact <n> | --all-in <persona ID>
  story-map preview [--port <n>] [--history <file>] [--tests-index <file>] [--source-base-url <url>] [--read-only] [<map.yaml>]
  story-map mcp [--root <path>] [--map <path>] [--read-only]
  story-map help [<command>]

init
  Sets up a host repository: a starter product/story-map.yaml, the story map
  guide in docs/story-map.md, a story map section in AGENTS.md and a GitHub
  Actions workflow that validates the map. Existing files are never overwritten.
  --skill writes the rules to .claude/skills/story-map/SKILL.md instead, with a
  short pointer to it in AGENTS.md.

  --no-ci          Skip the GitHub Actions workflow.
  --dir <path>     Repository root. Defaults to the current directory.

validate
  Errors make the map invalid and exit 1. Warnings, such as a blocked story
  with no statusReason, are printed but exit 0 unless --strict is set.
  Notices, such as delivery plans not chosen yet, are questions for a person
  and never fail, even with --strict.

  --format text      Print file:line:column: problem (default).
  --format github    Print GitHub Actions annotations so problems appear on the PR diff.
  --format json      Print one JSON document with each map's result and every
                     issue's severity, file, line, column, YAML path and message.
  --strict           Treat warnings as errors.
  --check-sources    Check that repository-relative sources exist and that
                     Markdown #heading fragments match a heading, and the
                     story IDs in the settings.plans folder when it is set.
  --plans <path>     Check that story IDs mentioned in Markdown files under
                     <path> exist in the map. Repeat for several paths.
  --tests <path>     Check story IDs in the names of tests under <path>: an
                     error for an ID that is not in the map, and a warning for
                     an in-progress or merged story with no tagged tests.
                     Repeat for several paths.
  --root <path>      Repository root for sources, plans and tests. Defaults to
                     the current directory.

diff
  Compares the map with its version at <base-ref>, such as origin/main, and
  prints a Markdown summary for a pull request. Customer-facing changes come first.

  --map <path>       Map to compare. Defaults to product/story-map.yaml.
  --format json      Print the comparison as JSON instead.

history
  Reads the map's Git history and writes when each story was added, each
  status change and each story's last edit, who made it and who merged it, as
  JSON for the board. Run it when building the product, from a full clone.

  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --ref <ref>        Branch whose history to read. Defaults to HEAD.
  --out <file>       Write to a file instead of printing.
  --bot-names <names>
                     Comma-separated commit authors that are bots. Their edits
                     are credited to whoever merged them. Authors ending in
                     [bot] are always treated as bots. Repeat to add more.
  --allow-shallow    Build a partial history from a shallow clone instead of failing.

tests
  Finds tests whose names contain a story ID, such as
  test("ESM-702: exports a valid Visio package", …), and writes them as JSON
  for the board. It reads the source text only, so no test code runs. The map
  is validated first, and defaults to product/story-map.yaml.

  --tests <path>     A test file, or a folder whose *.test.*, *.spec.* files
                     and test/, tests/ and __tests__/ folders are read.
                     Repeat for several paths. Defaults to the whole root.
  --root <path>      Repository root. Defaults to the current directory.
  --out <file>       Write to a file instead of printing.

export
  Writes the whole internal map as a file to import into Lucidchart, Miro,
  Visio or a spreadsheet, or as JSON for an agent to review. The map is
  validated first, and errors exit 1. The map defaults to
  product/story-map.yaml.

  --format vsdx|csv|json
                     Required. vsdx writes a Visio file, csv a row per story,
                     and json every story's details with notes on where the
                     data came from and what is left out.
  --output <file>    Defaults to story-map.<format>. Use - to write to stdout.
  --history <file>   History from story-map history, used to choose the most
                     recently changed stories when there are too many, and
                     included in json.
  --tests-index <file>
                     Tests index from story-map tests, included in json.
  --collapsed <release IDs>
                     Comma-separated releases to export as a header and a
                     story count, without their stories. Repeat to add more.
                     Ignored by json, which includes every release.
  --max-stories <n>  Most stories to export. Defaults to ${defaultExportMaxStories}, or
                     every story for json.

story
  Prints one or more stories in full: status, release, activity, estimate,
  who it is for, the jobs it serves, whether it is ready to start and which
  prerequisites are not merged yet, summary, notes and sources, with history
  and tagged tests when their files are given. An ID that is not in the map exits 1 and suggests close matches.
  Reads are always the internal view.

  --format json      Print the stories in the JSON export's story shape.
  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --history <file>   History from story-map history, for dates and changes.
  --tests-index <file>
                     Tests index from story-map tests, for tagged tests.

stories
  Lists stories with the board's filters, one line per story: ID, status,
  release and title. As on the board, blocked and cut stories are hidden
  unless --status chooses them. Takes the same options as story, plus:

  --status <status>  planned, in-progress, merged, shipped, blocked, cut,
                     stalled or all. Repeat, or separate with commas.
  --release <ID>     Only stories in this release. Repeat for several.
  --activity <ID>    Only stories under this activity. Repeat for several.
  --persona <ID>     Only stories for this persona, from their jobs or their
                     own personas. Repeat for several.
  --job <ID>         Only stories that serve this job. Repeat for several.
  --readiness <state>
                     Only planned and in-progress stories that are ready,
                     waiting or at-risk, from their dependsOn links.
                     Repeat, or separate with commas.
  --query <text>     Search IDs, titles, summaries, notes, status reasons,
                     persona titles and job statements, as the board's
                     search does. Use it to find an existing
                     story before adding one.
  --changed-within <days>
                     Only stories added or changed in 1, 7, 14 or 30 days.
                     Needs --history, as does --status stalled.

releases
  Lists releases, or the ones named, with story counts by status, estimates,
  notes and expected impact. Impact items drafted by an agent are marked
  [draft]. Takes the same options as story.

actions
  Lists what the map is waiting for, as the board's Actions tab does: every
  validate warning about the map, grouped by kind, each with its line and the
  command that fixes it. Kinds marked "needs a person", such as drafts to
  confirm and estimates to agree, are for people only. Agents act on the
  others and leave these alone. Exits 0 whatever it finds.

  --format json      Print the groups and actions as JSON.
  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --kind <kind>      Only actions of this kind, such as missing-estimate.
  --item-type <type> Only actions on a persona, story, release or the map.
  --release <ID>     Only actions on this release or its stories.
  --needs-person     Only actions a person must take.
  --tests <path>     Scan tests under <path>, as validate --tests does, so
                     in-progress and merged stories with no tagged tests are
                     listed too. Repeat for several paths.
  --tests-index <file>
                     Read the tests from story-map tests output instead.
  --root <path>      Repository root for --tests. Defaults to the current directory.

evidence
  Reports what has already happened on each story, or on every active story
  when no ID is given, and suggests a status without changing anything:
  branches whose names contain the ID, commits on the default branch that
  mention it, Markdown files that mention it, tagged tests and sources that no
  longer exist. A commit suggests merged only when it changes more than
  Markdown, the map and files under --plans. It never suggests moving a story
  back from merged or shipped, never changes a cut story and never suggests
  shipped unless --shipped-tags is given. It reads the checkout only, with no
  network calls unless --claims is given. An ID that is not in the map exits 1.

  --format json      Print the evidence as JSON, for agents and scripts.
  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --root <path>      Repository root. Defaults to the current directory.
  --default-branch <name>
                     Branch to read merged commits from. Defaults to
                     origin/HEAD, then origin/main, main, origin/master and
                     master.
  --plans <path>     Where to look for Markdown that mentions the story.
                     Repeat for several. Defaults to docs, or the whole root
                     when there is no docs folder.
  --tests <path>     Where to look for tagged tests. Repeat for several.
                     Defaults to the whole root.
  --history <file>   History from story-map history, to flag stalled stories.
  --shipped-tags <pattern>
                     Tags that mark a release going out, such as 'v*'. A
                     merged story whose merging commit is in a matching tag
                     is suggested as shipped, with the tag as evidence.
  --claims           Also read claims from origin, which needs the network.
                     A claim on a merged, shipped or cut story is reported as
                     stale. Claims never change the suggested status.
  --claims-remote <name>, --claims-store <dir>
                     Read claims from this remote or claim store instead.

survey
  Collects the facts an agent needs to draft a first map for a repository
  that already has history, without changing anything and without a map:
  release tags and CHANGELOG.md versions, with dates, as suggested releases;
  Markdown docs and their headings, as candidate sources; and plan docs that
  are not finished and TODO and FIXME comments, with file and line, as planned
  work. It reads and suggests only: the agent still drafts the stories. It
  reads the checkout only, with no network calls.

  --format json      Print the survey as JSON, for agents and scripts.
  --root <path>      Repository root. Defaults to the current directory.
  --tags <pattern>   Release tags to read, such as 'v*'. Defaults to every tag.
  --changelog <file> Changelog to read. Defaults to CHANGELOG.md at the root.
  --docs <path>      Where to look for Markdown docs. Repeat for several.
                     Defaults to the whole root.
  --plans <path>     Where to look for plans. Repeat for several. Defaults to
                     docs in plans, rfcs, proposals, adr or decisions folders,
                     and roadmaps.

claim
  Records that an agent is on a story, before any branch or pull request
  exists, so a second agent is told before it starts the same work. Opt-in,
  for teams running several agents on one map. Each claim is a Git ref,
  refs/story-map/claims/<ID>, on the remote, pointing at a commit with no
  parents whose message is the claim as JSON: agent, branch, when it was
  claimed and when it expires. The push only succeeds if the ref does not
  exist yet, so of two agents claiming at once exactly one wins. The other
  exits 3 and is told who holds the claim. The map is never changed.

  --agent <name>     Required. Who is claiming, such as audit-bot. Never an
                     email address: everyone who can read the remote sees it.
  --ttl <duration>   How long the claim lasts, such as 30m, 4h or 2d. Defaults
                     to 4h, and is at most 30d.
  --branch <name>    The branch the work is on. Defaults to the current branch.
  --renew            Extend your own claim, from now.
  --take-over        Replace a claim that has expired.
  --remote <name>    The remote that holds claims. Defaults to origin.
  --store <dir>      Keep claims as files in this folder inside the
                     repository instead, using exclusive file creation for
                     the same guarantee, for agents on one machine that
                     cannot push refs.
  --map <path>       Map to read. Defaults to product/story-map.yaml. A story
                     that is not in it, or is merged, shipped or cut, cannot
                     be claimed.
  --format json      Print the claim as JSON.

  Exit codes: 0 claimed, 1 an unknown or finished story or a Git failure,
  2 a usage error, 3 someone else holds the claim.

claims
  Lists the claims on the remote, or in --store, marking expired ones. Takes
  --remote, --store and --format json.

unclaim
  Releases a claim by deleting its ref or file. Opening the story's pull
  request does not release it: release it once the work merges, or let it
  expire. With --agent, it refuses, with exit 3, a claim another agent holds.
  Takes --remote, --store and --format json.

tokens
  Counts the model tokens Claude Code used on a story, from its session logs
  on this machine, for the pull request that finishes the story. A response
  counts when it was made on a branch whose name contains the story ID, such
  as feat/esm-145-tokens, or on a branch or in a session named below. Input,
  output and cache tokens are all counted, each response once, and priced by
  the model each response names at API list prices, built in and dated, to
  estimate the cost. It reads the logs only and changes nothing: record the
  results with story-map edit <ID> --tokens <n> --estimated-cost <usd>.
  Exits 1 when nothing was found, rather than reporting 0.

  --format markdown  Print the Tokens used section for the pull request.
  --format json      Print the counts as JSON, for agents and scripts.
  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --logs <path>      Folder of session logs. Defaults to
                     $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects.
  --branch <name>    Also count this branch, such as one named before the
                     story ID was known. Repeat for several.
  --session <ID>     Also count this whole session. Repeat for several.
  --prices <file>    JSON of prices to use instead, in US dollars per million
                     tokens, such as {"claude-opus-5-5": {"input": 4,
                     "output": 20, "cacheRead": 0.2}}. cacheWrite5m and
                     cacheWrite1h default to 1.25 and 2 times input.

edit
  Changes a story with named edits instead of editing the YAML by hand. By
  default it is a dry run: it prints the line diff of the YAML, the story-map
  diff summary and any problems the edit introduces, and writes nothing.
  Comments and every line outside the changed fields are kept as they are.

  --status <status>  planned, in-progress, merged, shipped, blocked or cut.
                     blocked and cut need --reason, which says why.
  --release, --activity, --title, --summary, --notes
                     Set that field.
  --add-source, --remove-source <source>
                     Add or remove a source. Repeat for several.
  --add-job, --remove-job <ID>
                     Add or remove a job to be done the story serves, by its
                     ID from the map's personas. Repeat for several.
  --add-persona, --remove-persona <ID>
                     Add or remove a persona the story helps without serving
                     one of their jobs.
  --add-dependency, --remove-dependency <ID>
                     Add or remove a story that must land before this one.
                     Repeat for several.
  --customer-title, --customer-summary <text>
                     Customer-facing copy. Needs --customer.
  --priority <must|should|could|none>
                     Set the story's MoSCoW priority, shown on internal
                     cards as MH, SH or CH. none removes it.
  --tokens <n>       Record the model tokens used to deliver the story, in
                     the pull request that finishes it. story-map tokens
                     counts them from Claude Code's logs.
  --estimated-cost <usd>
                     Record their estimated cost in US dollars, such as
                     14.27, from story-map tokens.
  --from <file>      A JSON list of edits, such as
                     [{"op": "status", "id": "ESM-744", "status": "merged"}],
                     applied all or none. The ops are status, release,
                     activity, title, summary, notes, priority, tokens,
                     estimated-cost, add-source,
                     remove-source, add-job, remove-job, add-persona,
                     remove-persona, add-dependency, remove-dependency,
                     customer-title, customer-summary, add,
                     release-impact and plans.

  Common edit options:
  --write            Save the change, only when the edited map is valid.
  --format json      Print the line diff, summary and validation as JSON.
  --map <path>       Map to edit, inside the current directory. Defaults to
                     product/story-map.yaml.
  --customer         Allow customer-facing copy, once it is approved.
  --updated-by <name>
                     Credit this person on each story the edit touches, when
                     you edit on their behalf. Git credits the author otherwise.
  --check-sources    Also check that sources exist.

  There is no delete: cut a story with --status cut --reason <text>. Exit
  codes: 0 for a valid result, 1 for a refused edit or an invalid result,
  2 for a usage error.

add
  Adds a story, as planned unless --status says otherwise, after the last
  story in its release. It takes the next ID in sequence, one after the highest
  in the whole map, counting cut stories so an ID is never reused, or --id. Takes
  --source for each source, --job for each job it serves, --persona for each
  persona it helps, --dependency for each story that must land first, and the
  common edit options in story-map help edit.

release-impact
  Adds an expected impact item to a release, always with draft: true. Only a
  person confirms it, with story-map confirm. Takes the common edit options
  in story-map help edit.

settings
  Records the person's answer to whether to use delivery plans, in the map's
  settings.plans. Only record an answer they gave: "not now" changes nothing,
  so the question is asked again. A dry run unless --write is given. Takes the
  common edit options in story-map help edit.

  --plans <folder>   Keep delivery plans in this repository-relative folder,
                     such as docs/plans. validate --check-sources then checks
                     the story IDs in it.
  --plans off        Do not use delivery plans. Nothing asks again.

plan
  Prints a delivery plan skeleton for the stories given, in the structure
  from Write a delivery plan in docs/story-map.md: a status line, a numbered
  item for each story, the stories it builds on and overlaps, empty UI
  mockup, Decisions to make and Not now sections, and an effort table with
  agreed estimates. It writes nothing, so pipe it into a new file. It never
  sets an estimate. An ID that is not in the map exits 1.

  --map <path>       Map to read. Defaults to product/story-map.yaml.
  --release <ID>     Every planned and in-progress story in this release,
                     in place of IDs.

confirm
  Confirms a draft by removing its draft: true: a job by its ID, a persona's
  context by the persona's ID, or a release's impact item by its number. It
  prints each draft as the reader sees it, such as the job's “When …, I want
  …, so that …” statement, then the line diff. Nothing is written without
  --write. Comments and other lines are kept.

  --impact <n>       Confirm the nth impact item of the release, from 1.
  --all-in <persona ID>
                     Confirm every drafted job of the persona.
  --write            Save, after you type the ID back. It needs a terminal,
                     so it refuses when standard input is not one. Agents
                     must never confirm drafts, and there is no way to skip
                     the prompt.
  --format json      Print the drafts and the change as JSON. Never writes.
  --map <path>       Map to edit. Defaults to product/story-map.yaml.

  Exit codes: 0 for a dry run or a confirmed draft, 1 for a refusal or a
  wrong ID typed back, 2 for a usage error.

preview
  Serves the map as a board on http://127.0.0.1:4173/story-map, with
  internal and signed-in customer views, so you can check a map before adding
  the board to your product. It reads the map on every request, so an edit
  shows on reload, and shows validation errors on the page. It listens on
  127.0.0.1 only and is never for deploying. Needs react and react-dom. The
  map defaults to product/story-map.yaml.

  --port <n>         Port to listen on. Defaults to 4173. 0 picks a free one.
  --history <file>   History from story-map history, for dates and changes.
  --tests-index <file>
                     Tests index from story-map tests, for tagged tests.
  --source-base-url <url>
                     Base URL for repository-relative sources, such as
                     https://github.com/<owner>/<repo>/blob/main/
  --read-only        Turns off editing. By default you can edit personas,
                     their context and job statements in place on the
                     Personas tab, and save a story's status, reason and
                     release from its panel, and the edits save to the
                     map file. Drafts stay drafts.

mcp
  Runs a Model Context Protocol server over standard input and output, for
  agents that call tools rather than run commands. Its tools wrap story,
  stories, releases, validate, evidence, edit --from and claim, with the same
  safeguards: edits are dry runs unless the call sets write, there is no
  delete and no tool to confirm drafts, and every path stays inside the root.
  It has no network listener. Needs @modelcontextprotocol/sdk.

  --root <path>      Repository root. Defaults to the current directory.
  --map <path>       Map the tools read, relative to the root. Defaults to
                     product/story-map.yaml.
  --read-only        Leaves out propose_edit and claim_story.

help
  Prints this text, or just the section for <command>.`;

const commands: Record<string, Command<any>> = { init, validate, diff, history, tests, export: exportMap, story, stories, releases, actions, evidence, survey, claim, claims, unclaim, tokens, preview, mcp, edit, add, "release-impact": releaseImpact, settings, plan, confirm };

/** The usage line and section for one command, or null for an unknown one. */
function commandUsage(name: string): string | null {
  const lines = usage.split("\n").filter(text => text.startsWith(`  story-map ${name} `) || text === `  story-map ${name}`);
  if (!lines.length) return null;
  const start = usage.indexOf(`\n\n${name}\n`);
  const section = start === -1 ? "" : usage.slice(start + 2).split(/\n\n(?=[a-z][a-z-]*\n)/)[0];
  return `Usage:\n${lines.join("\n")}\n\n${section}`.trimEnd();
}

const [command, ...rest] = process.argv.slice(2);
const chosen = Object.hasOwn(commands, command ?? "") ? commands[command] : undefined;
if (command === "help" || command === "--help" || command === "-h") {
  const section = rest[0] ? commandUsage(rest[0]) : usage;
  if (section) {
    console.log(section);
  } else {
    console.error(`story-map: there is no ${rest[0]} command\n\n${usage}`);
    process.exitCode = 2;
  }
} else if (!chosen) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let options: unknown = null;
  try {
    options = chosen.parse(rest);
  } catch (error) {
    if (!(error instanceof ArgumentError)) throw error;
    console.error(`story-map: ${error.message}\n`);
  }
  if (options) {
    await chosen.run(options);
  } else {
    console.error(commandUsage(command) ?? usage);
    process.exitCode = 2;
  }
}
