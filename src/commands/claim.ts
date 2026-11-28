import { claimStory, claimTime, describeClaim, listStoryClaims, parseClaimTtl, releaseStoryClaim, StoryClaimError, StoryClaimHeldError, type ClaimStoryOptions, type StoryClaim } from "../claims.js";
import { ArgumentError, defineCommand, escapeText, loadMapOrReport, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "json"] as const;

interface StoreOptions {
  format: (typeof formats)[number];
  remote?: string;
  store?: string;
}

interface ClaimOptions extends StoreOptions {
  id: string;
  map: string;
  agent?: string;
  ttl?: string;
  branch?: string;
  mode: NonNullable<ClaimStoryOptions["mode"]>;
}

interface UnclaimOptions extends StoreOptions {
  id: string;
  agent?: string;
}

/**
 * Reads the options a claim command shares, plus any of `extra`, and the
 * positional IDs. Returns null for an unknown option.
 */
function parseOptions(rest: string[], extra: readonly string[], flags: readonly string[] = []) {
  const values: Record<string, string> = {};
  const set = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    if (flags.includes(arg)) {
      set.add(arg);
    } else if (["--format", "--remote", "--store", ...extra].includes(name)) {
      const [value, next] = optionValue(rest, index, name);
      index = next;
      values[name] = value;
    } else if (arg.startsWith("-")) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (values["--remote"] !== undefined && values["--store"] !== undefined) throw new ArgumentError("pass --remote or --store, not both");
  const store: StoreOptions = { format: values["--format"] ? readFormat(values["--format"], formats) : "text", remote: values["--remote"], store: values["--store"] };
  return { values, set, positional, store };
}

function claimLine(claim: StoryClaim) {
  if (claim.problem) return `${escapeText(claim.id)}  unreadable: ${escapeText(claim.problem)}`;
  const branch = claim.branch ? ` on ${escapeText(claim.branch)}` : "";
  return `${escapeText(claim.id)}  ${escapeText(claim.agent)}${branch}, ${claim.expired ? "expired" : "expires"} ${claimTime(claim.expiresAt)}`;
}

/** Prints a claim error and sets the exit code: 3 when someone else holds the claim, 2 for a usage problem and 1 otherwise. */
function fail(kind: string, format: StoreOptions["format"], error: unknown) {
  if (error instanceof StoryClaimHeldError) {
    process.exitCode = 3;
    if (format === "json") printJson(kind, { held: error.claim, message: error.message });
    else console.error(`story-map: ${escapeText(error.message)}`);
    return;
  }
  if (!(error instanceof StoryClaimError)) throw error;
  process.exitCode = error.usage ? 2 : 1;
  if (format === "json") printJson(kind, { error: error.message });
  else console.error(`story-map: ${escapeText(error.message)}`);
}

const storeOf = (options: StoreOptions) => ({ root: process.cwd(), ...(options.store !== undefined ? { store: options.store } : { remote: options.remote ?? "origin" }) });

export const claim = defineCommand({
  parse(rest: string[]): ClaimOptions | null {
    const parsed = parseOptions(rest, ["--map", "--agent", "--ttl", "--branch"], ["--renew", "--take-over"]);
    if (parsed?.positional.length !== 1) return null;
    if (parsed.set.has("--renew") && parsed.set.has("--take-over")) throw new ArgumentError("pass --renew or --take-over, not both");
    const { values, set, positional, store } = parsed;
    return {
      ...store,
      id: positional[0],
      map: values["--map"] ?? "product/story-map.yaml",
      agent: values["--agent"],
      ttl: values["--ttl"],
      branch: values["--branch"],
      mode: set.has("--renew") ? "renew" : set.has("--take-over") ? "take-over" : "claim",
    };
  },

  async run(options) {
    if (!options.agent) {
      fail("claim", options.format, new StoryClaimError("--agent needs a name, such as --agent audit-bot.", true));
      return;
    }
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    let result;
    try {
      result = await claimStory(loaded, options.id, {
        ...storeOf(options),
        agent: options.agent,
        ...(options.ttl ? { ttlMs: parseClaimTtl(options.ttl) } : {}),
        ...(options.branch ? { branch: options.branch } : {}),
        mode: options.mode,
      });
    } catch (error) {
      fail("claim", options.format, error);
      return;
    }
    if (options.format === "json") {
      printJson("claim", result);
      return;
    }
    const verb = options.mode === "renew" ? "Renewed" : result.replaced ? "Took over" : "Claimed";
    console.log(`${verb} ${escapeText(result.claim.id)} for ${escapeText(result.claim.agent)} until ${claimTime(result.claim.expiresAt)}.`);
    if (result.replaced && options.mode === "take-over") console.log(`It replaces ${escapeText(describeClaim(result.replaced))}`);
  },
});

export const claims = defineCommand({
  parse(rest: string[]): StoreOptions | null {
    const parsed = parseOptions(rest, []);
    if (!parsed || parsed.positional.length) return null;
    return parsed.store;
  },

  async run(options) {
    let result;
    try {
      result = await listStoryClaims(storeOf(options));
    } catch (error) {
      fail("claims", options.format, error);
      return;
    }
    if (options.format === "json") {
      printJson("claims", result);
      return;
    }
    const where = "remote" in result.source ? `on ${escapeText(result.source.remote)}` : `in ${escapeText(result.source.store)}`;
    if (!result.claims.length) console.log(`No claims ${where}.`);
    else console.log(result.claims.map(claimLine).join("\n"));
  },
});

export const unclaim = defineCommand({
  parse(rest: string[]): UnclaimOptions | null {
    const parsed = parseOptions(rest, ["--agent"]);
    if (parsed?.positional.length !== 1) return null;
    return { ...parsed.store, id: parsed.positional[0], agent: parsed.values["--agent"] };
  },

  async run(options) {
    let result;
    try {
      result = await releaseStoryClaim(options.id, { ...storeOf(options), ...(options.agent !== undefined ? { agent: options.agent } : {}) });
    } catch (error) {
      fail("unclaim", options.format, error);
      return;
    }
    if (options.format === "json") {
      printJson("unclaim", result);
      return;
    }
    if (result.released) console.log(`Released ${escapeText(options.id)}, which ${escapeText(result.released.agent)} held.`);
    else console.log(`${escapeText(options.id)} has no claim, so there was nothing to release.`);
  },
});
