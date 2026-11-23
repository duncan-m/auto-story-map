import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { closestIds } from "./read.js";
import { resolveRootedPath } from "./references.js";
import { loadStoryMap, type LoadedStoryMap } from "./schema.js";

/** Where claims live on the remote: one ref per story, such as `refs/story-map/claims/ESM-106`. */
export const claimRefPrefix = "refs/story-map/claims/";
/** How long a claim lasts unless `ttl` says otherwise: 4 hours. */
export const defaultClaimTtlMs = 4 * 60 * 60 * 1000;
/** The longest a claim can last: 30 days. */
export const claimTtlMaxMs = 30 * 24 * 60 * 60 * 1000;
/** Longest agent name, in characters. */
export const claimAgentMaxLength = 100;
/** Longest branch name kept in a claim, in characters. */
export const claimBranchMaxLength = 255;
/** Largest claim read, in bytes. Anything larger is reported as unreadable. */
const claimMaxBytes = 4096;

// The remote's refs are mirrored here when claims are read, so they never mix with the checkout's own refs.
const mirrorPrefix = (remote: string) => `refs/story-map/remotes/${remote}/claims/`;
const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const safeRemote = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const emailLike = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const lockWaitMs = 2000;

/** Options shared by every claim function. */
export interface StoryClaimOptions {
  /** Repository root, where Git runs and what `store` is relative to. Defaults to the current directory. */
  root?: string;
  /** The Git remote whose refs hold the claims. Defaults to `origin`. Ignored when `store` is given. */
  remote?: string;
  /** A folder inside the repository to keep claims in as files, for agents on one machine that cannot push refs. */
  store?: string;
  /** Time to judge expiry against. Defaults to now. */
  now?: Date;
}

/** One claim: who is on a story, from which branch, and until when. */
export interface StoryClaim {
  id: string;
  agent: string;
  branch?: string;
  claimedAt: string;
  /** When the claim was last renewed, if it was. */
  renewedAt?: string;
  expiresAt: string;
  /** True when `expiresAt` has passed, so `takeOver` may replace it. */
  expired: boolean;
  /** Present when the claim could not be read. It counts as expired, so it can be taken over or released. */
  problem?: string;
}

/** Options for `claimStory`. */
export interface ClaimStoryOptions extends StoryClaimOptions {
  /** Who is claiming, such as `audit-bot`. Never a person's email address. */
  agent: string;
  /** How long the claim lasts, in milliseconds. Defaults to `defaultClaimTtlMs`. */
  ttlMs?: number;
  /** The branch the work is on. Defaults to the checkout's current branch, if any. */
  branch?: string;
  /** `claim` (the default) only succeeds when nobody holds the story. `renew` extends your own claim, and `take-over` replaces an expired one. */
  mode?: "claim" | "renew" | "take-over";
}

/** The outcome of `claimStory`. */
export interface ClaimStoryResult {
  claim: StoryClaim;
  /** The claim this one replaced, for `renew` and `take-over`. */
  replaced?: StoryClaim;
}

/** Where claims were read from. */
export type StoryClaimSource = { remote: string } | { store: string };

/** A problem with the request, such as an unknown story or an unreachable remote. Exits 1, or 2 when `usage` is true. */
export class StoryClaimError extends Error {
  constructor(message: string, readonly usage = false) {
    super(message);
  }
}

/** Someone else holds the claim, or it changed while this one was being made. The CLI exits 3. */
export class StoryClaimHeldError extends Error {
  constructor(message: string, readonly claim: StoryClaim) {
    super(message);
  }
}

const storedClaimSchema = z.object({
  format: z.literal("auto-story-map.claim"),
  version: z.literal(1),
  id: z.string().regex(safeId),
  agent: z.string().min(1).max(claimAgentMaxLength),
  branch: z.string().min(1).max(claimBranchMaxLength).optional(),
  claimedAt: z.iso.datetime({ offset: true }),
  renewedAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }),
});
type StoredClaim = z.infer<typeof storedClaimSchema>;

function run(root: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile("git", ["-c", "core.quotePath=false", ...args], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env },
    }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: stderr.toString("utf8") }));
      else resolvePromise(stdout);
    });
    // Git may exit before it reads its input, such as when a command fails, so a closed pipe is not an error here.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
  });
}
const git = async (root: string, args: string[], options?: { input?: string; env?: NodeJS.ProcessEnv }) => (await run(root, args, options)).toString("utf8");

/** Git's own message for a failed command, on one line. */
const gitMessage = (error: unknown) => {
  const text = (error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error));
  return text.split("\n").map(line => line.trim()).filter(Boolean).slice(-3).join(" ");
};

const toClaim = (stored: StoredClaim, now: Date): StoryClaim => ({
  id: stored.id,
  agent: stored.agent,
  ...(stored.branch ? { branch: stored.branch } : {}),
  claimedAt: stored.claimedAt,
  ...(stored.renewedAt ? { renewedAt: stored.renewedAt } : {}),
  expiresAt: stored.expiresAt,
  expired: Date.parse(stored.expiresAt) <= now.getTime(),
});

/** Reads a stored claim, reporting one that is not a valid claim for this ID as a problem rather than failing. */
function readClaim(id: string, text: string, now: Date): StoryClaim {
  let stored: StoredClaim | undefined;
  let problem = "It is not a story-map claim.";
  try {
    const parsed = storedClaimSchema.safeParse(JSON.parse(text));
    if (parsed.success && parsed.data.id === id) stored = parsed.data;
    else if (parsed.success) problem = `It names ${parsed.data.id}, not ${id}.`;
  } catch {
    problem = "It is not valid JSON.";
  }
  if (stored) return toClaim(stored, now);
  return { id, agent: "unknown", claimedAt: new Date(0).toISOString(), expiresAt: new Date(0).toISOString(), expired: true, problem };
}

const storedText = (claim: StoredClaim) => JSON.stringify(claim);

/** A claim as it is stored, with the token a replace or remove leases against: the ref's commit, or the file's text. */
interface Held {
  claim: StoryClaim;
  token: string;
}

/** Where claims are kept. Each write is a compare-and-swap: it fails, returning false, when the claim is not what was read. */
interface ClaimBackend {
  source: StoryClaimSource;
  list(): Promise<Map<string, Held>>;
  create(id: string, claim: StoredClaim): Promise<boolean>;
  replace(id: string, token: string, claim: StoredClaim): Promise<boolean>;
  remove(id: string, token: string): Promise<boolean>;
}

async function gitBackend(root: string, remote: string, now: Date): Promise<ClaimBackend> {
  if (!safeRemote.test(remote)) throw new StoryClaimError(`--remote must be the name of a Git remote, such as origin, not ${remote}.`, true);
  try {
    await git(root, ["rev-parse", "--git-dir"]);
  } catch {
    throw new StoryClaimError("Not a Git checkout, so claims cannot be kept as refs. Run it in the repository, or pass --store <dir>.");
  }
  try {
    await git(root, ["remote", "get-url", "--", remote]);
  } catch {
    throw new StoryClaimError(`There is no Git remote called ${remote}. Pass --remote <name>, or --store <dir> to keep claims as files.`, true);
  }
  const mirror = mirrorPrefix(remote);

  const list = async () => {
    try {
      await git(root, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--prune", remote, `+${claimRefPrefix}*:${mirror}*`]);
    } catch (error) {
      throw new StoryClaimError(`Could not read claims from ${remote}: ${gitMessage(error)}`);
    }
    const refs = (await git(root, ["for-each-ref", "--format=%(refname)%1f%(objectname)", mirror]))
      .split("\n").filter(Boolean).map(line => line.split("\u001f"))
      .map(([ref, commit]) => ({ id: ref.slice(mirror.length), commit }))
      .filter(ref => safeId.test(ref.id));
    const held = new Map<string, Held>();
    if (!refs.length) return held;
    // One cat-file reads every claim. Its sizes say where each object ends, so a message cannot fake another record.
    const output = await run(root, ["cat-file", "--batch"], { input: refs.map(ref => `${ref.commit}\n`).join("") });
    let offset = 0;
    for (const ref of refs) {
      const end = output.indexOf(0x0a, offset);
      const [, type, size] = output.subarray(offset, end).toString("utf8").split(" ");
      if (type === "missing" || size === undefined) {
        offset = end + 1;
        held.set(ref.id, { claim: { ...readClaim(ref.id, "", now), problem: "Its commit could not be read." }, token: ref.commit });
        continue;
      }
      const length = Number(size);
      const body = output.subarray(end + 1, end + 1 + length);
      offset = end + 1 + length + 1;
      const text = body.toString("utf8");
      const message = text.slice(text.indexOf("\n\n") + 2);
      const claim = type !== "commit"
        ? { ...readClaim(ref.id, "", now), problem: "Its ref does not point at a commit." }
        : length > claimMaxBytes ? { ...readClaim(ref.id, "", now), problem: "It is too large to be a claim." } : readClaim(ref.id, message, now);
      held.set(ref.id, { claim, token: ref.commit });
    }
    return held;
  };

  /** Pushes with a lease, so the remote only takes it if the ref is still `expected`, or absent when `expected` is empty. */
  const push = async (id: string, expected: string, source: string) => {
    const ref = `${claimRefPrefix}${id}`;
    try {
      await git(root, ["push", "--quiet", "--no-verify", "--porcelain", `--force-with-lease=${ref}:${expected}`, remote, `${source}:${ref}`]);
      return true;
    } catch (error) {
      // A lost lease and a refused push both fail. Read the ref again to tell them apart.
      const current = (await list()).get(id)?.token ?? "";
      if (current !== expected) return false;
      throw new StoryClaimError(`${remote} refused the claim ref: ${gitMessage(error)} If this host only lets you push your own branch, pass --store <dir> to keep claims as files.`);
    }
  };

  const commitFor = async (claim: StoredClaim) => {
    const tree = (await git(root, ["hash-object", "-t", "tree", "-w", "--stdin"])).trim();
    // The commit names the tool, never the person running it, and has no parents.
    const date = claim.renewedAt ?? claim.claimedAt;
    const env = {
      GIT_AUTHOR_NAME: "story-map", GIT_AUTHOR_EMAIL: "story-map@claims.invalid", GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: "story-map", GIT_COMMITTER_EMAIL: "story-map@claims.invalid", GIT_COMMITTER_DATE: date,
    };
    return (await git(root, ["commit-tree", tree, "-m", storedText(claim)], { env })).trim();
  };

  return {
    source: { remote },
    list,
    create: async (id, claim) => push(id, "", await commitFor(claim)),
    replace: async (id, token, claim) => push(id, token, await commitFor(claim)),
    remove: (id, token) => push(id, token, ""),
  };
}

async function fileBackend(root: string, store: string, now: Date): Promise<ClaimBackend> {
  const resolved = await resolveRootedPath(root, await realpath(root), store);
  if (resolved.kind === "issue") throw new StoryClaimError(`--store ${store}: ${resolved.issue.message}`, true);
  const dir = resolved.kind === "inside" ? resolved.path : resolve(root, store);
  await mkdir(dir, { recursive: true });
  const file = (id: string) => join(dir, `${id}.json`);
  const readText = async (id: string) => {
    try {
      return await readFile(file(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  // Replacing and removing hold a lock file, made with exclusive creation, so
  // two agents cannot both change the same claim. Creating needs no lock: the
  // claim file itself is made with exclusive creation.
  const locked = async <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const lock = join(dir, `${id}.lock`);
    const started = Date.now();
    for (;;) {
      try {
        await writeFile(lock, String(process.pid), { flag: "wx" });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() - started > lockWaitMs) {
          throw new StoryClaimError(`${lock} is locked. If no claim command is running, delete it and try again.`);
        }
        await new Promise(done => setTimeout(done, 25));
      }
    }
    try {
      return await work();
    } finally {
      await unlink(lock).catch(() => {});
    }
  };

  return {
    source: { store },
    async list() {
      const held = new Map<string, Held>();
      for (const name of (await readdir(dir)).sort()) {
        const id = name.endsWith(".json") ? name.slice(0, -5) : "";
        if (!safeId.test(id)) continue;
        const text = await readText(id);
        if (text === undefined) continue;
        const claim = Buffer.byteLength(text) > claimMaxBytes ? { ...readClaim(id, "", now), problem: "It is too large to be a claim." } : readClaim(id, text, now);
        held.set(id, { claim, token: text });
      }
      return held;
    },
    async create(id, claim) {
      try {
        await writeFile(file(id), `${storedText(claim)}\n`, { flag: "wx" });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    },
    replace: (id, token, claim) => locked(id, async () => {
      if (await readText(id) !== token) return false;
      const temporary = join(dir, `.${id}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temporary, `${storedText(claim)}\n`, { flag: "wx" });
      await rename(temporary, file(id));
      return true;
    }),
    remove: (id, token) => locked(id, async () => {
      if (await readText(id) !== token) return false;
      await unlink(file(id));
      return true;
    }),
  };
}

async function openBackend(options: StoryClaimOptions): Promise<{ backend: ClaimBackend; now: Date; root: string }> {
  const root = resolve(options.root ?? ".");
  const now = options.now ?? new Date();
  const backend = options.store !== undefined
    ? await fileBackend(root, options.store, now)
    : await gitBackend(root, options.remote ?? "origin", now);
  return { backend, now, root };
}

/** A claim time to the second, such as 2026-11-23T14:05:09Z. */
export const claimTime = (iso: string) => iso.replace(/\.\d{3}Z$/, "Z");

/** Says who holds a claim, for refusals. */
export function describeClaim(claim: StoryClaim): string {
  if (claim.problem) return `${claim.id} has a claim that cannot be read. ${claim.problem}`;
  const branch = claim.branch ? ` on ${claim.branch}` : "";
  const until = `${claim.expired ? "It expired at" : "It expires at"} ${claimTime(claim.expiresAt)}`;
  return `${claim.id} is claimed by ${claim.agent}${branch}, since ${claimTime(claim.claimedAt)}. ${until}.`;
}

function checkAgent(agent: string | undefined): string {
  const name = agent?.trim() ?? "";
  if (!name) throw new StoryClaimError("--agent needs a name, such as audit-bot.", true);
  if (name.length > claimAgentMaxLength) throw new StoryClaimError(`--agent must be at most ${claimAgentMaxLength} characters.`, true);
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name)) throw new StoryClaimError("--agent must be one line of text.", true);
  if (emailLike.test(name)) throw new StoryClaimError("--agent must name the agent, not an email address. Claims are shared with everyone who can read the remote.", true);
  return name;
}

function checkId(id: string) {
  if (!safeId.test(id)) throw new StoryClaimError(`${id} is not a story ID.`, true);
}

/**
 * Turns a duration such as `30m`, `4h` or `2d` into milliseconds. Throws
 * `StoryClaimError` for anything else, or for more than 30 days.
 */
export function parseClaimTtl(text: string): number {
  const match = /^(\d{1,6})([mhd])$/.exec(text.trim());
  if (!match) throw new StoryClaimError(`--ttl must be a number of minutes, hours or days, such as 30m, 4h or 2d, not ${text}.`, true);
  const ms = Number(match[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "m" | "h" | "d"];
  if (ms <= 0 || ms > claimTtlMaxMs) throw new StoryClaimError("--ttl must be between 1 minute and 30 days.", true);
  return ms;
}

async function currentBranch(root: string) {
  try {
    const branch = (await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    return branch ? branch.slice(0, claimBranchMaxLength) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lists the claims on the remote, or in the store, sorted by story ID. Reading
 * the remote fetches its claim refs into `refs/story-map/remotes/<remote>/claims/`,
 * so it needs the network. Claims are untrusted text: anyone who can push to the
 * remote can write one.
 */
export async function listStoryClaims(options: StoryClaimOptions = {}): Promise<{ source: StoryClaimSource; claims: StoryClaim[] }> {
  const { backend } = await openBackend(options);
  const claims = [...(await backend.list()).values()].map(held => held.claim).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  return { source: backend.source, claims };
}

/**
 * Claims a story for an agent, so a second agent is told before it starts the
 * same work. The remote or the store does the compare-and-swap, so of two
 * agents claiming at once, exactly one wins and the other gets
 * `StoryClaimHeldError` naming the holder. Takes the map's source text, or a
 * map the CLI already loaded, and refuses a story that is not in it or whose
 * work is already merged, shipped or cut.
 */
export async function claimStory(source: string | LoadedStoryMap, id: string, options: ClaimStoryOptions): Promise<ClaimStoryResult> {
  const loaded = typeof source === "string" ? loadStoryMap(source) : source;
  checkId(id);
  const story = loaded.map.stories.find(item => item.id === id);
  if (!story) {
    const suggestions = closestIds(id, loaded.map.stories.map(item => item.id));
    throw new StoryClaimError(`${id}: no story with this ID in the map.${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""}`);
  }
  if (story.status === "merged" || story.status === "shipped" || story.status === "cut") {
    throw new StoryClaimError(`${id} is ${story.status}, so there is no work left to claim.`);
  }
  const agent = checkAgent(options.agent);
  const ttlMs = options.ttlMs ?? defaultClaimTtlMs;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > claimTtlMaxMs) throw new StoryClaimError("The claim's lifetime must be between 1 minute and 30 days.", true);
  const mode = options.mode ?? "claim";
  const { backend, now, root } = await openBackend(options);
  const branch = options.branch?.trim().slice(0, claimBranchMaxLength) || await currentBranch(root);
  const at = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const fresh: StoredClaim = { format: "auto-story-map.claim", version: 1, id, agent, ...(branch ? { branch } : {}), claimedAt: at, expiresAt };

  const lost = async (fallback: StoryClaim) => {
    const holder = (await backend.list()).get(id)?.claim ?? fallback;
    return new StoryClaimHeldError(`${describeClaim(holder)} It changed while this claim was being made.`, holder);
  };
  const current = (await backend.list()).get(id);

  if (mode === "renew") {
    if (!current) throw new StoryClaimError(`${id} has no claim to renew. Claim it without --renew.`);
    if (current.claim.problem || current.claim.agent !== agent) {
      throw new StoryClaimHeldError(`${describeClaim(current.claim)} Only ${current.claim.problem ? "--take-over" : current.claim.agent} can renew it.`, current.claim);
    }
    const kept = branch ?? current.claim.branch;
    const renewed: StoredClaim = { ...fresh, ...(kept ? { branch: kept } : {}), claimedAt: current.claim.claimedAt, renewedAt: at };
    if (!await backend.replace(id, current.token, renewed)) throw await lost(current.claim);
    return { claim: toClaim(renewed, now), replaced: current.claim };
  }

  if (current) {
    if (mode !== "take-over" || !current.claim.expired) {
      const hint = mode === "take-over" ? " It has not expired, so it cannot be taken over."
        : current.claim.expired ? " Pass --take-over to replace it."
        : current.claim.agent === agent ? " If that is you, pass --renew." : "";
      throw new StoryClaimHeldError(`${describeClaim(current.claim)}${hint}`, current.claim);
    }
    if (!await backend.replace(id, current.token, fresh)) throw await lost(current.claim);
    return { claim: toClaim(fresh, now), replaced: current.claim };
  }

  if (!await backend.create(id, fresh)) throw await lost(toClaim(fresh, now));
  return { claim: toClaim(fresh, now) };
}

/**
 * Releases a claim by deleting its ref or file. With `agent`, it refuses,
 * with `StoryClaimHeldError`, a claim another agent holds. Returns the claim it
 * released, or nothing when the story had no claim.
 */
export async function releaseStoryClaim(id: string, options: StoryClaimOptions & { agent?: string } = {}): Promise<{ released?: StoryClaim }> {
  checkId(id);
  const agent = options.agent === undefined ? undefined : checkAgent(options.agent);
  const { backend } = await openBackend(options);
  const current = (await backend.list()).get(id);
  if (!current) return {};
  if (agent !== undefined && current.claim.agent !== agent && !current.claim.problem) {
    throw new StoryClaimHeldError(`${describeClaim(current.claim)} It is not ${agent}'s to release.`, current.claim);
  }
  if (!await backend.remove(id, current.token)) {
    const holder = (await backend.list()).get(id)?.claim ?? current.claim;
    throw new StoryClaimHeldError(`${describeClaim(holder)} It changed while it was being released.`, holder);
  }
  return { released: current.claim };
}
