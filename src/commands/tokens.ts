import { readFile } from "node:fs/promises";
import { closestIds } from "../read.js";
import { countStoryTokens, defaultTokenPricesDate, type StoryTokenUsage, type TokenPrice, type TokenPrices } from "../tokens.js";
import { ArgumentError, count, defineCommand, escapeText, loadMapOrReport, optionValue, printJson, readFormat, reportFile } from "./shared.js";

const formats = ["text", "markdown", "json"] as const;

interface TokensOptions {
  format: (typeof formats)[number];
  map: string;
  logs?: string;
  branches: string[];
  sessions: string[];
  prices?: string;
  since?: Date;
  until?: Date;
  id: string;
}

/** Reads a --since or --until time, such as 2026-11-20T10:42:00Z. */
function readTime(name: string, value: string): Date {
  const time = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(time.getTime())) throw new ArgumentError(`${name} must be a time such as 2026-11-20T10:42:00Z, not ${value}`);
  return time;
}

/** The range a count was limited to, such as "from 2026-11-20 10:42 to now UTC". */
const rangeText = (usage: StoryTokenUsage) =>
  `from ${usage.since ? usage.since.slice(0, 16).replace("T", " ") : "the start"} to ${usage.until ? usage.until.slice(0, 16).replace("T", " ") : "now"} UTC`;

const number = (value: number) => value.toLocaleString("en-US");

const usd = (value: number) => `$${value.toFixed(2)}`;

/** “$14.27 at API list prices”, saying what it leaves out. */
/** True when at least some tokens had a price, so there is a cost to record. */
const priced = (usage: StoryTokenUsage) => usage.cost.unpricedTokens < usage.total;

function costText(usage: StoryTokenUsage, pricesFrom: string): string {
  const { cost } = usage;
  if (!priced(usage)) return `unknown: ${cost.unpricedModels.join(", ")} ${cost.unpricedModels.length === 1 ? "has" : "have"} no price in ${pricesFrom}`;
  const missing = cost.unpricedTokens ? `, leaving out ${number(cost.unpricedTokens)} tokens from ${cost.unpricedModels.join(", ")}, which have no price` : "";
  return `${usd(cost.usd)} at ${pricesFrom}${missing}`;
}

const breakdown = (usage: StoryTokenUsage) =>
  `input ${number(usage.input)} · output ${number(usage.output)} · cache writes ${number(usage.cacheWrite)} · cache reads ${number(usage.cacheRead)}`;

/** The `## Tokens used` section for the pull request that finishes the story. */
export function tokensMarkdown(usage: StoryTokenUsage, pricesFrom = defaultPricesFrom): string {
  return [
    "## Tokens used",
    "",
    `${usage.id}: **${number(usage.total)} tokens** in ${count(usage.sessions.length, "Claude Code session", "Claude Code sessions")} (${breakdown(usage)}).`,
    "",
    priced(usage)
      ? `Estimated cost: **${usd(usage.cost.usd)}**${costText(usage, pricesFrom).slice(usd(usage.cost.usd).length)}. Not what was billed: a subscription or discount changes that.`
      : `Estimated cost: ${costText(usage, pricesFrom)}.`,
    "",
    `Branches: ${usage.branches.map(branch => `\`${branch.replace(/`/g, "")}\``).join(", ")}`,
    "",
  ].join("\n");
}

const defaultPricesFrom = `API list prices as of ${defaultTokenPricesDate}`;

/** A Review cost line for the pull request's Review section, from a count limited with --since or --until. */
export function reviewCostMarkdown(usage: StoryTokenUsage, pricesFrom = defaultPricesFrom): string {
  const cost = priced(usage) ? `estimated ${usd(usage.cost.usd)}${costText(usage, pricesFrom).slice(usd(usage.cost.usd).length)}` : `estimated cost ${costText(usage, pricesFrom)}`;
  return `- Review cost: **${number(usage.total)} tokens**, ${cost}, on ${usage.id} ${rangeText(usage)}, in ${count(usage.sessions.length, "Claude Code session", "Claude Code sessions")}.\n`;
}

function tokensText(usage: StoryTokenUsage, recorded: { tokens?: number; usd?: number }, pricesFrom: string): string {
  const lines = [
    `${escapeText(usage.id)}  ${number(usage.total)} tokens in ${count(usage.messages, "response", "responses")} across ${count(usage.sessions.length, "session", "sessions")}`,
    `  Input:         ${number(usage.input)}`,
    `  Output:        ${number(usage.output)}`,
    `  Cache writes:  ${number(usage.cacheWrite)}`,
    `  Cache reads:   ${number(usage.cacheRead)}`,
    `  Est. cost:     ${escapeText(costText(usage, pricesFrom))}`,
  ];
  for (const row of usage.cost.models) {
    lines.push(`    ${escapeText(row.model)}${row.fast ? " (fast)" : ""}: ${number(row.total)} tokens, ${row.usd === undefined ? "no price" : usd(row.usd)}`);
  }
  lines.push(`  Branches:      ${usage.branches.map(escapeText).join(", ")}`);
  if (usage.since || usage.until) lines.push(`  Counted:       ${rangeText(usage)}`);
  if (usage.firstAt && usage.lastAt) lines.push(`  From:          ${escapeText(usage.firstAt.slice(0, 16).replace("T", " "))} to ${escapeText(usage.lastAt.slice(0, 16).replace("T", " "))} UTC`);
  if (recorded.tokens !== undefined || recorded.usd !== undefined) {
    lines.push(`  In the map:    ${[recorded.tokens !== undefined ? `${number(recorded.tokens)} tokens` : "", recorded.usd !== undefined ? usd(recorded.usd) : ""].filter(Boolean).join(", ")}`);
  }
  return lines.join("\n");
}

export default defineCommand({
  parse(rest: string[]): TokensOptions | null {
    const options: Omit<TokensOptions, "id"> = { format: "text", map: "product/story-map.yaml", branches: [], sessions: [] };
    const ids: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (["--format", "--map", "--logs", "--branch", "--session", "--prices", "--since", "--until"].includes(name)) {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--format") options.format = readFormat(value, formats);
        else if (name === "--map") options.map = value;
        else if (name === "--logs") options.logs = value;
        else if (name === "--branch") options.branches.push(value);
        else if (name === "--prices") options.prices = value;
        else if (name === "--since" || name === "--until") options[name === "--since" ? "since" : "until"] = readTime(name, value);
        else options.sessions.push(value);
      } else if (arg.startsWith("-")) {
        return null;
      } else {
        ids.push(arg);
      }
    }
    if (ids.length > 1) throw new ArgumentError("give one story ID: tokens are recorded per story");
    if (ids.length !== 1) return null;
    if (options.since && options.until && options.since > options.until) throw new ArgumentError("--since must be before --until");
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
    let prices: TokenPrices | undefined;
    if (options.prices) {
      try {
        prices = parsePrices(JSON.parse(await readFile(options.prices, "utf8")));
      } catch (error) {
        reportFile(options.prices, error);
        process.exitCode = 1;
        return;
      }
    }
    const pricesFrom = options.prices ? `the prices in ${options.prices}` : defaultPricesFrom;
    const usage = await countStoryTokens(story.id, { logs: options.logs, branches: options.branches, sessions: options.sessions, prices, since: options.since, until: options.until });
    const ranged = !!(options.since || options.until);
    // Nothing counted is not the same as zero tokens, so it fails rather than suggesting 0.
    if (!usage.messages) process.exitCode = 1;

    if (options.format === "json") {
      printJson("tokens", {
        ...usage,
        prices: options.prices ?? `default, ${defaultTokenPricesDate}`,
        ...(story.tokens !== undefined ? { recorded: story.tokens } : {}),
        ...(story.estimatedCostUsd !== undefined ? { recordedCostUsd: story.estimatedCostUsd } : {}),
      });
      return;
    }
    if (!usage.messages) {
      const where = usage.files ? `in ${count(usage.files, "log file", "log files")} under ${escapeText(usage.logs)}` : `under ${escapeText(usage.logs)}: there are no Claude Code logs there`;
      console.error(`${escapeText(story.id)}: found no Claude Code usage on a branch named for it ${ranged ? `${rangeText(usage)} ` : ""}${where}.`);
      console.error("Name the branch with --branch or the session with --session, or record a count from another agent with story-map edit --tokens.");
      return;
    }
    if (options.format === "markdown") {
      process.stdout.write(ranged ? reviewCostMarkdown(usage, pricesFrom) : tokensMarkdown(usage, pricesFrom));
      return;
    }
    console.log(tokensText(usage, { tokens: story.tokens, usd: story.estimatedCostUsd }, escapeText(pricesFrom)));
    if (ranged) {
      // Part of the story's work, such as its review, is not the story's total.
      console.error(`\nThis counts ${escapeText(story.id)}'s work ${rangeText(usage)} only. Record it in the pull request's Review section, not with story-map edit --tokens.`);
      return;
    }
    console.error(`\nRecord it in the pull request that finishes the story:\n  story-map edit ${escapeText(story.id)} --tokens ${usage.total}${priced(usage) ? ` --estimated-cost ${usage.cost.usd.toFixed(2)}` : ""} --write`);
  },
});

/** Reads a prices file: model IDs to `{ input, output, cacheRead }` and the optional cache-write prices, in US dollars per million tokens. */
function parsePrices(value: unknown): TokenPrices {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object of model IDs to prices");
  const rate = (model: string, key: string, raw: unknown, optional: boolean) => {
    if (raw === undefined && optional) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`${model}.${key} must be a price in US dollars per million tokens`);
    return raw;
  };
  const prices: Record<string, TokenPrice> = {};
  for (const [model, raw] of Object.entries(value as Record<string, Record<string, unknown>>)) {
    if (!raw || typeof raw !== "object") throw new Error(`${model} must be an object with input, output and cacheRead`);
    const price: TokenPrice = { input: rate(model, "input", raw.input, false)!, output: rate(model, "output", raw.output, false)!, cacheRead: rate(model, "cacheRead", raw.cacheRead, false)! };
    for (const key of ["cacheWrite5m", "cacheWrite1h"] as const) {
      const found = rate(model, key, raw[key], true);
      if (found !== undefined) price[key] = found;
    }
    prices[model] = price;
  }
  return prices;
}
