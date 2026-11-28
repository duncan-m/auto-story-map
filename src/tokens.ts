import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { escapeRegExp } from "./references.js";

/** Options for `countStoryTokens`. */
export interface StoryTokenOptions {
  /**
   * Folder of Claude Code session logs to read, searched recursively for `*.jsonl` files.
   * Defaults to `$CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects`.
   */
  logs?: string;
  /** More branches to count in full, such as one named before the story ID was known. */
  branches?: readonly string[];
  /** Session IDs to count in full, whatever branch they were on. */
  sessions?: readonly string[];
  /** Prices to estimate the cost with, by model ID. Defaults to `defaultTokenPrices`. Models not listed are reported as unpriced. */
  prices?: TokenPrices;
  /**
   * Count only the responses made at or after this time, such as when a review started, so a
   * part of the work can be counted apart from the story's total. Responses with no time are left out.
   */
  since?: Date;
  /** Count only the responses made at or before this time. Responses with no time are left out. */
  until?: Date;
}

/** One model's API list prices, in US dollars per million tokens. */
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Writes to the 5-minute cache. Defaults to 1.25 times `input`. */
  cacheWrite5m?: number;
  /** Writes to the 1-hour cache. Defaults to 2 times `input`. */
  cacheWrite1h?: number;
  /** Prompts longer than `above` tokens, counting input and cache tokens, are priced at `price` instead. */
  longPrompt?: { above: number; price: Omit<TokenPrice, "longPrompt"> };
}

export type TokenPrices = Readonly<Record<string, TokenPrice>>;

/** When `defaultTokenPrices` was last checked against Anthropic's pricing page. */
export const defaultTokenPricesDate = "2026-11-03";

const fable52: TokenPrice = { input: 8, output: 40, cacheRead: 0.2, cacheWrite5m: 10, cacheWrite1h: 16 };
const fable51: TokenPrice = { input: 10, output: 50, cacheRead: 0.25 };
const fable5: TokenPrice = { input: 10, output: 50, cacheRead: 1 };
const opus: TokenPrice = { input: 5, output: 25, cacheRead: 0.5 };

/**
 * Anthropic's first-party API list prices for Claude models, in US dollars per
 * million tokens, as of `defaultTokenPricesDate`. Fast mode costs twice these.
 * Prices change, so pass your own with `prices` or `--prices` when they do.
 */
export const defaultTokenPrices: TokenPrices = {
  "claude-fable-5-2": fable52,
  "claude-mythos-5-2": fable52,
  "claude-fable-5-1": fable51,
  "claude-mythos-5-1": fable51,
  "claude-fable-5": fable5,
  "claude-mythos-5": fable5,
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": opus,
  "claude-opus-4-8": opus,
  "claude-opus-4-7": opus,
  "claude-opus-4-6": opus,
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, longPrompt: { above: 100_000, price: { input: 0.5, output: 2.5, cacheRead: 0.05 } } },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** The estimated cost of the counted responses. */
export interface TokenCost {
  /** US dollars at the prices used, rounded to the cent. Leaves out `unpricedTokens`. */
  usd: number;
  /** Tokens from models with no price, so not in `usd`. */
  unpricedTokens: number;
  /** Those models, sorted. */
  unpricedModels: string[];
  /** Tokens and cost by model, most expensive first. */
  models: { model: string; total: number; usd?: number; fast?: boolean }[];
}

/** Tokens by kind. `total` is the sum of the other four. */
export interface TokenCounts {
  total: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** What `countStoryTokens` found for one story. */
export interface StoryTokenUsage extends TokenCounts {
  id: string;
  /** The folder that was read. */
  logs: string;
  /** Log files read. 0 when the folder is missing or empty. */
  files: number;
  /** Model responses counted, each once, however many log lines repeat it. */
  messages: number;
  /** Session IDs with at least one counted response, sorted. */
  sessions: string[];
  /** Branches the counted responses were made on, sorted. */
  branches: string[];
  /** The estimated cost at API list prices. */
  cost: TokenCost;
  /** The first and last counted response. Absent when nothing was counted. */
  firstAt?: string;
  lastAt?: string;
  /** The `since` and `until` the count was limited to, as ISO times, when given. */
  since?: string;
  until?: string;
}

/** The folder Claude Code writes its session logs to. */
export function defaultClaudeLogs(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

/** True when the branch name contains the story ID as a whole word, such as `feat/esm-145-tokens` for ESM-145, but not ESM-1450. */
export function branchNamesStory(branch: string, id: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(id)}(?![a-z0-9])`, "i").test(branch);
}

interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation?: { ephemeral_1h_input_tokens?: unknown };
  speed?: unknown;
}

/** `claude-opus-5-5[1m]` and `claude-haiku-4-5-20251001` are priced as `claude-opus-5-5` and `claude-haiku-4-5`. */
function priceFor(model: string, prices: TokenPrices): TokenPrice | undefined {
  const bare = model.replace(/\[.*\]$/, "");
  return prices[bare] ?? prices[bare.replace(/-\d{8}$/, "")];
}

type Counts = Omit<TokenCounts, "total"> & { cacheWrite1h: number };

function responseCost(counts: Counts, price: TokenPrice, fast: boolean): number {
  const prompt = counts.input + counts.cacheRead + counts.cacheWrite;
  const rate = price.longPrompt && prompt > price.longPrompt.above ? price.longPrompt.price : price;
  const cacheWrite5m = rate.cacheWrite5m ?? rate.input * 1.25;
  const cacheWrite1h = rate.cacheWrite1h ?? rate.input * 2;
  const dollars = counts.input * rate.input + counts.output * rate.output + counts.cacheRead * rate.cacheRead
    + (counts.cacheWrite - counts.cacheWrite1h) * cacheWrite5m + counts.cacheWrite1h * cacheWrite1h;
  return (dollars / 1_000_000) * (fast ? 2 : 1);
}

const tokens = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/**
 * Counts the model tokens Claude Code used on a story, from its session logs on
 * this machine. A response counts when it was made on a branch whose name
 * contains the story ID, on one of `branches`, or in one of `sessions`. Each
 * response is counted once: Claude Code writes a log line per content block,
 * each with the same usage. Subagent logs are read too. With `since` or `until`,
 * only the responses made in that range count, such as the review of a pull request.
 *
 * Reads the logs only. Nothing leaves the machine.
 */
export async function countStoryTokens(id: string, options: StoryTokenOptions = {}): Promise<StoryTokenUsage> {
  const logs = options.logs ?? defaultClaudeLogs();
  const branches = new Set(options.branches ?? []);
  const sessions = new Set(options.sessions ?? []);
  const prices = options.prices ?? defaultTokenPrices;
  for (const [name, time] of [["since", options.since], ["until", options.until]] as const) {
    if (time !== undefined && Number.isNaN(time.getTime())) throw new RangeError(`${name} is not a valid time`);
  }
  const since = options.since?.getTime();
  const until = options.until?.getTime();
  const inRange = (at: string | undefined) => {
    if (since === undefined && until === undefined) return true;
    const time = at === undefined ? Number.NaN : Date.parse(at);
    return !Number.isNaN(time) && (since === undefined || time >= since) && (until === undefined || time <= until);
  };
  const responses = new Map<string, { counts: Counts; model?: string; fast: boolean; session?: string; branch?: string; at?: string }>();

  const files = await logFiles(logs);
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"usage"')) continue;
      let entry: { type?: unknown; sessionId?: unknown; gitBranch?: unknown; timestamp?: unknown; uuid?: unknown; requestId?: unknown; message?: { id?: unknown; model?: unknown; usage?: Usage } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = entry?.message?.usage;
      if (entry?.type !== "assistant" || !usage || typeof usage !== "object") continue;
      const session = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
      const branch = typeof entry.gitBranch === "string" && entry.gitBranch ? entry.gitBranch : undefined;
      const matches = (session !== undefined && sessions.has(session)) || (branch !== undefined && (branches.has(branch) || branchNamesStory(branch, id)));
      if (!matches) continue;
      const at = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
      if (!inRange(at)) continue;
      const key = [entry.message?.id, entry.requestId].filter(part => typeof part === "string").join("\u0000") || (typeof entry.uuid === "string" ? entry.uuid : line);
      const counts = {
        input: tokens(usage.input_tokens),
        output: tokens(usage.output_tokens),
        cacheWrite: tokens(usage.cache_creation_input_tokens),
        cacheRead: tokens(usage.cache_read_input_tokens),
        cacheWrite1h: 0,
      };
      counts.cacheWrite1h = Math.min(counts.cacheWrite, tokens(usage.cache_creation?.ephemeral_1h_input_tokens));
      const model = typeof entry.message?.model === "string" && !entry.message.model.startsWith("<") ? entry.message.model : undefined;
      const fast = usage.speed === "fast";
      const seen = responses.get(key);
      if (seen) {
        // Repeated lines carry the same usage, or a later, larger count while streaming.
        for (const kind of Object.keys(counts) as (keyof typeof counts)[]) seen.counts[kind] = Math.max(seen.counts[kind], counts[kind]);
        continue;
      }
      responses.set(key, { counts, model, fast, session, branch, at });
    }
  }

  const result: StoryTokenUsage = {
    id, logs, files: files.length, total: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: responses.size, sessions: [], branches: [],
    cost: { usd: 0, unpricedTokens: 0, unpricedModels: [], models: [] },
    ...(options.since ? { since: options.since.toISOString() } : {}),
    ...(options.until ? { until: options.until.toISOString() } : {}),
  };
  const byModel = new Map<string, { model: string; total: number; usd?: number; fast?: boolean }>();
  let usd = 0;
  const sessionIds = new Set<string>();
  const branchNames = new Set<string>();
  const times: string[] = [];
  for (const response of responses.values()) {
    for (const kind of ["input", "output", "cacheWrite", "cacheRead"] as const) result[kind] += response.counts[kind];
    if (response.session) sessionIds.add(response.session);
    if (response.branch) branchNames.add(response.branch);
    if (response.at) times.push(response.at);
    const total = response.counts.input + response.counts.output + response.counts.cacheWrite + response.counts.cacheRead;
    if (!total) continue;
    const model = response.model ?? "unknown";
    const key = `${model}${response.fast ? " (fast)" : ""}`;
    const price = response.model ? priceFor(response.model, prices) : undefined;
    const row = byModel.get(key) ?? { model, total: 0, ...(price ? { usd: 0 } : {}), ...(response.fast ? { fast: true } : {}) };
    byModel.set(key, row);
    row.total += total;
    if (price) {
      const cost = responseCost(response.counts, price, response.fast);
      row.usd! += cost;
      usd += cost;
    } else {
      result.cost.unpricedTokens += total;
    }
  }
  const cents = (value: number) => Math.round(value * 100) / 100;
  result.cost.usd = cents(usd);
  result.cost.models = [...byModel.values()].map(row => (row.usd === undefined ? row : { ...row, usd: cents(row.usd) }))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.total - a.total);
  result.cost.unpricedModels = [...new Set(result.cost.models.filter(row => row.usd === undefined).map(row => row.model))].sort();
  result.total = result.input + result.output + result.cacheWrite + result.cacheRead;
  result.sessions = [...sessionIds].sort();
  result.branches = [...branchNames].sort();
  times.sort();
  if (times.length) {
    result.firstAt = times[0];
    result.lastAt = times.at(-1);
  }
  return result;
}

/** Every `*.jsonl` file under `folder`, sorted, or none when the folder does not exist. */
async function logFiles(folder: string): Promise<string[]> {
  try {
    if (!(await stat(folder)).isDirectory()) return [];
  } catch {
    return [];
  }
  const names = await readdir(folder, { recursive: true });
  return names.filter(name => name.endsWith(".jsonl")).sort().map(name => join(folder, name));
}
