import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

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
  /** The first and last counted response. Absent when nothing was counted. */
  firstAt?: string;
  lastAt?: string;
}

/** The folder Claude Code writes its session logs to. */
export function defaultClaudeLogs(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the branch name contains the story ID as a whole word, such as `feat/esm-144-tokens` for ESM-144, but not ESM-1440. */
export function branchNamesStory(branch: string, id: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(id)}(?![a-z0-9])`, "i").test(branch);
}

interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

const tokens = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/**
 * Counts the model tokens Claude Code used on a story, from its session logs on
 * this machine. A response counts when it was made on a branch whose name
 * contains the story ID, on one of `branches`, or in one of `sessions`. Each
 * response is counted once: Claude Code writes a log line per content block,
 * each with the same usage. Subagent logs are read too.
 *
 * Reads the logs only. Nothing leaves the machine.
 */
export async function countStoryTokens(id: string, options: StoryTokenOptions = {}): Promise<StoryTokenUsage> {
  const logs = options.logs ?? defaultClaudeLogs();
  const branches = new Set(options.branches ?? []);
  const sessions = new Set(options.sessions ?? []);
  const responses = new Map<string, { counts: Omit<TokenCounts, "total">; session?: string; branch?: string; at?: string }>();

  const files = await logFiles(logs);
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"usage"')) continue;
      let entry: { type?: unknown; sessionId?: unknown; gitBranch?: unknown; timestamp?: unknown; uuid?: unknown; requestId?: unknown; message?: { id?: unknown; usage?: Usage } };
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
      const key = [entry.message?.id, entry.requestId].filter(part => typeof part === "string").join("\u0000") || (typeof entry.uuid === "string" ? entry.uuid : line);
      const counts = {
        input: tokens(usage.input_tokens),
        output: tokens(usage.output_tokens),
        cacheWrite: tokens(usage.cache_creation_input_tokens),
        cacheRead: tokens(usage.cache_read_input_tokens),
      };
      const at = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
      const seen = responses.get(key);
      if (seen) {
        // Repeated lines carry the same usage, or a later, larger count while streaming.
        for (const kind of Object.keys(counts) as (keyof typeof counts)[]) seen.counts[kind] = Math.max(seen.counts[kind], counts[kind]);
        continue;
      }
      responses.set(key, { counts, session, branch, at });
    }
  }

  const result: StoryTokenUsage = { id, logs, files: files.length, total: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, messages: responses.size, sessions: [], branches: [] };
  const sessionIds = new Set<string>();
  const branchNames = new Set<string>();
  const times: string[] = [];
  for (const response of responses.values()) {
    for (const kind of ["input", "output", "cacheWrite", "cacheRead"] as const) result[kind] += response.counts[kind];
    if (response.session) sessionIds.add(response.session);
    if (response.branch) branchNames.add(response.branch);
    if (response.at) times.push(response.at);
  }
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
