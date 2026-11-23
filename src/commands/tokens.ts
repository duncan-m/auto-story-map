import { closestIds } from "../read.js";
import { countStoryTokens, type StoryTokenUsage } from "../tokens.js";
import { ArgumentError, count, defineCommand, escapeText, loadMapOrReport, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "markdown", "json"] as const;

interface TokensOptions {
  format: (typeof formats)[number];
  map: string;
  logs?: string;
  branches: string[];
  sessions: string[];
  id: string;
}

const number = (value: number) => value.toLocaleString("en-US");

const breakdown = (usage: StoryTokenUsage) =>
  `input ${number(usage.input)} · output ${number(usage.output)} · cache writes ${number(usage.cacheWrite)} · cache reads ${number(usage.cacheRead)}`;

/** The `## Tokens used` section for the pull request that finishes the story. */
export function tokensMarkdown(usage: StoryTokenUsage): string {
  return [
    "## Tokens used",
    "",
    `${usage.id}: **${number(usage.total)} tokens** in ${count(usage.sessions.length, "Claude Code session", "Claude Code sessions")} (${breakdown(usage)}).`,
    "",
    `Branches: ${usage.branches.map(branch => `\`${branch.replace(/`/g, "")}\``).join(", ")}`,
    "",
  ].join("\n");
}

function tokensText(usage: StoryTokenUsage, recorded: number | undefined): string {
  const lines = [
    `${escapeText(usage.id)}  ${number(usage.total)} tokens in ${count(usage.messages, "response", "responses")} across ${count(usage.sessions.length, "session", "sessions")}`,
    `  Input:         ${number(usage.input)}`,
    `  Output:        ${number(usage.output)}`,
    `  Cache writes:  ${number(usage.cacheWrite)}`,
    `  Cache reads:   ${number(usage.cacheRead)}`,
    `  Branches:      ${usage.branches.map(escapeText).join(", ")}`,
  ];
  if (usage.firstAt && usage.lastAt) lines.push(`  From:          ${escapeText(usage.firstAt.slice(0, 16).replace("T", " "))} to ${escapeText(usage.lastAt.slice(0, 16).replace("T", " "))} UTC`);
  if (recorded !== undefined) lines.push(`  In the map:    ${number(recorded)}`);
  return lines.join("\n");
}

export default defineCommand({
  parse(rest: string[]): TokensOptions | null {
    const options: Omit<TokensOptions, "id"> = { format: "text", map: "product/story-map.yaml", branches: [], sessions: [] };
    const ids: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (["--format", "--map", "--logs", "--branch", "--session"].includes(name)) {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--format") options.format = readFormat(value, formats);
        else if (name === "--map") options.map = value;
        else if (name === "--logs") options.logs = value;
        else if (name === "--branch") options.branches.push(value);
        else options.sessions.push(value);
      } else if (arg.startsWith("-")) {
        return null;
      } else {
        ids.push(arg);
      }
    }
    if (ids.length > 1) throw new ArgumentError("give one story ID: tokens are recorded per story");
    if (ids.length !== 1) return null;
    return { ...options, id: ids[0] };
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    const story = loaded.map.stories.find(item => item.id === options.id);
    if (!story) {
      const suggestions = closestIds(options.id, loaded.map.stories.map(item => item.id));
      console.error(`${escapeText(options.id)}: no story with this ID in ${escapeText(options.map)}.${suggestions.length ? ` Did you mean ${suggestions.map(escapeText).join(", ")}?` : ""}`);
      process.exitCode = 1;
      return;
    }
    const usage = await countStoryTokens(story.id, { logs: options.logs, branches: options.branches, sessions: options.sessions });
    // Nothing counted is not the same as zero tokens, so it fails rather than suggesting 0.
    if (!usage.messages) process.exitCode = 1;

    if (options.format === "json") {
      printJson("tokens", { ...usage, ...(story.tokens !== undefined ? { recorded: story.tokens } : {}) });
      return;
    }
    if (!usage.messages) {
      const where = usage.files ? `in ${count(usage.files, "log file", "log files")} under ${escapeText(usage.logs)}` : `under ${escapeText(usage.logs)}: there are no Claude Code logs there`;
      console.error(`${escapeText(story.id)}: found no Claude Code usage on a branch named for it ${where}.`);
      console.error("Name the branch with --branch or the session with --session, or record a count from another agent with story-map edit --tokens.");
      return;
    }
    if (options.format === "markdown") {
      process.stdout.write(tokensMarkdown(usage));
      return;
    }
    console.log(tokensText(usage, story.tokens));
    console.error(`\nRecord it in the pull request that finishes the story:\n  story-map edit ${escapeText(story.id)} --tokens ${usage.total} --write`);
  },
});
