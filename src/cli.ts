#!/usr/bin/env node
import diff from "./commands/diff.js";
import exportMap from "./commands/export.js";
import history from "./commands/history.js";
import init from "./commands/init.js";
import preview from "./commands/preview.js";
import { releases, stories, story } from "./commands/read.js";
import { ArgumentError, type Command } from "./commands/shared.js";
import tests from "./commands/tests.js";
import validate from "./commands/validate.js";
import { defaultExportMaxStories } from "./export.js";

const usage = `Usage:
  story-map init [--no-ci] [--dir <path>]
  story-map validate [--format text|github|json] [--strict] [--check-sources] [--plans <path>] [--tests <path>] <map.yaml> [...]
  story-map diff [--format markdown|json] [--map <path>] <base-ref>
  story-map history [--map <path>] [--ref <ref>] [--out <file>] [--bot-names <names>] [--allow-shallow]
  story-map tests [--tests <path>] [--root <path>] [--out <file>] [<map.yaml>]
  story-map export --format vsdx|csv|json [--output <file>] [--history <file>] [--tests-index <file>] [--collapsed <release IDs>] [--max-stories <n>] [<map.yaml>]
  story-map story [--format text|json] [--map <path>] [--history <file>] [--tests-index <file>] <ID> [...]
  story-map stories [--format text|json] [--map <path>] [--status <status>] [--release <ID>] [--activity <ID>] [--query <text>] [--changed-within <days>] [--history <file>] [--tests-index <file>]
  story-map releases [--format text|json] [--map <path>] [--history <file>] [--tests-index <file>] [<release ID> ...]
  story-map preview [--port <n>] [--history <file>] [--tests-index <file>] [--source-base-url <url>] [<map.yaml>]
  story-map help [<command>]

init
  Sets up a host repository: a starter product/story-map.yaml, the story map
  guide in docs/story-map.md, a story map section in AGENTS.md and a GitHub
  Actions workflow that validates the map. Existing files are never overwritten.

  --no-ci          Skip the GitHub Actions workflow.
  --dir <path>     Repository root. Defaults to the current directory.

validate
  Errors make the map invalid and exit 1. Warnings, such as a blocked story
  with no statusReason, are printed but exit 0 unless --strict is set.

  --format text      Print file:line:column: problem (default).
  --format github    Print GitHub Actions annotations so problems appear on the PR diff.
  --format json      Print one JSON document with each map's result and every
                     issue's severity, file, line, column, YAML path and message.
  --strict           Treat warnings as errors.
  --check-sources    Check that repository-relative sources exist and that
                     Markdown #heading fragments match a heading.
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
  summary, notes and sources, with history and tagged tests when their files
  are given. An ID that is not in the map exits 1 and suggests close matches.
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
  --query <text>     Search IDs, titles, summaries, notes and status reasons,
                     as the board's search does. Use it to find an existing
                     story before adding one.
  --changed-within <days>
                     Only stories added or changed in 1, 7, 14 or 30 days.
                     Needs --history, as does --status stalled.

releases
  Lists releases, or the ones named, with story counts by status, estimates,
  notes and expected impact. Impact items drafted by an agent are marked
  [draft]. Takes the same options as story.

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

help
  Prints this text, or just the section for <command>.`;

const commands: Record<string, Command<any>> = { init, validate, diff, history, tests, export: exportMap, story, stories, releases, preview };

/** The usage line and section for one command, or null for an unknown one. */
function commandUsage(name: string): string | null {
  const line = usage.split("\n").find(text => text.startsWith(`  story-map ${name} `) || text === `  story-map ${name}`);
  if (!line) return null;
  const start = usage.indexOf(`\n\n${name}\n`);
  const section = start === -1 ? "" : usage.slice(start + 2).split(/\n\n(?=[a-z]+\n)/)[0];
  return `Usage:\n${line}\n\n${section}`.trimEnd();
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
