import { isDeepStrictEqual } from "node:util";
import { Document, isMap, isSeq, parseDocument, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { z } from "zod";
import { checkStoryMap, type StoryMapCheckIssue, type StoryMapCheckOptions, type StoryMapCheckResult } from "./check.js";
import { diffStoryMaps, formatStoryMapDiff, type StoryMapDiff } from "./diff.js";
import { present } from "./present.js";
import { closestIds } from "./read.js";
import { parseStoryMap, personaJobsMaxItems, personasMaxItems, storyPriorities, type ReleaseImpact, type StoryMapDocument, type StoryMapJob, type StoryMapPersonaContext } from "./schema.js";
import { storyStatuses } from "./status.js";

const text = z.string().trim().min(1);
const storyId = z.string().min(1).max(64);

/** One change `proposeStoryMapEdit` can make. There is no delete: cut a story instead. */
export const storyMapEditOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), id: storyId, status: z.enum(storyStatuses), reason: text.optional() }).strict(),
  z.object({ op: z.literal("release"), id: storyId, release: text }).strict(),
  z.object({ op: z.literal("activity"), id: storyId, activity: text }).strict(),
  z.object({ op: z.literal("title"), id: storyId, title: text }).strict(),
  z.object({ op: z.literal("summary"), id: storyId, summary: text }).strict(),
  z.object({ op: z.literal("notes"), id: storyId, notes: text }).strict(),
  z.object({ op: z.literal("priority"), id: storyId, priority: z.enum([...storyPriorities, "none"]) }).strict(),
  z.object({ op: z.literal("tokens"), id: storyId, tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ op: z.literal("estimated-cost"), id: storyId, usd: z.number().min(0).max(1_000_000_000) }).strict(),
  z.object({ op: z.literal("add-source"), id: storyId, source: text }).strict(),
  z.object({ op: z.literal("remove-source"), id: storyId, source: text }).strict(),
  z.object({ op: z.literal("add-job"), id: storyId, job: text }).strict(),
  z.object({ op: z.literal("remove-job"), id: storyId, job: text }).strict(),
  z.object({ op: z.literal("add-persona"), id: storyId, persona: text }).strict(),
  z.object({ op: z.literal("remove-persona"), id: storyId, persona: text }).strict(),
  z.object({ op: z.literal("add-dependency"), id: storyId, dependency: text }).strict(),
  z.object({ op: z.literal("remove-dependency"), id: storyId, dependency: text }).strict(),
  z.object({ op: z.literal("customer-title"), id: storyId, title: text }).strict(),
  z.object({ op: z.literal("customer-summary"), id: storyId, summary: text }).strict(),
  z.object({
    op: z.literal("add"),
    id: storyId.optional(),
    title: text,
    activity: text,
    release: text,
    status: z.enum(storyStatuses).optional(),
    reason: text.optional(),
    summary: text.optional(),
    notes: text.optional(),
    sources: z.array(text).optional(),
    jobs: z.array(text).optional(),
    personas: z.array(text).optional(),
    dependsOn: z.array(text).optional(),
  }).strict(),
  z.object({ op: z.literal("release-impact"), release: text, metric: text, expected: text, solves: text.optional() }).strict(),
  // Records the person's answer to whether to use delivery plans: a folder, or false for no plans.
  z.object({ op: z.literal("plans"), plans: z.union([text, z.literal(false)]) }).strict(),
  // Records the person's answer to which story ID policy `add` follows.
  z.object({ op: z.literal("story-ids"), storyIds: z.enum(["next", "lowest-free"]) }).strict(),
  // Records the person's answer to whether story-map upgrade runs in simple or advanced mode.
  z.object({ op: z.literal("upgrade-mode"), upgrade: z.enum(["simple", "advanced"]) }).strict(),
  // Records the person's answer to whether validate warns, not only notes, a gap in a plan's architecture section.
  z.object({ op: z.literal("architecture-decisions"), architectureDecisions: z.enum(["recommended", "required"]) }).strict(),
  // Persona edits reword what is there. IDs, order, customer copy and draft are left alone.
  z.object({ op: z.literal("set-persona"), persona: text, title: text.optional(), summary: z.string().trim().optional() }).strict(),
  z.object({
    op: z.literal("set-persona-context"),
    persona: text,
    success: z.string().trim().optional(),
    usesToday: z.array(z.string().trim()).optional(),
    constraints: z.array(z.string().trim()).optional(),
  }).strict(),
  z.object({ op: z.literal("set-job"), job: text, situation: text.optional(), motivation: text.optional(), outcome: text.optional() }).strict(),
  // A new job goes after the persona's other jobs, so it never becomes the core job. Its ID comes from “I want” unless one is given.
  z.object({ op: z.literal("create-job"), persona: text, id: storyId.optional(), situation: text, motivation: text, outcome: text }).strict(),
  // Removes the job, its steps and its ID from every story that served it. The stories stay.
  z.object({ op: z.literal("delete-job"), job: text }).strict(),
  // A new persona goes after the others, so every persona keeps its colour. Its ID comes from the title unless one is given.
  z.object({ op: z.literal("create-persona"), id: storyId.optional(), title: text, summary: z.string().trim().optional() }).strict(),
]);

/** The operations that change a persona or one of their jobs. */
export const personaEditOperations = ["set-persona", "set-persona-context", "set-job", "create-job", "delete-job", "create-persona"] as const;

/** The operations the story panel's **Actions** menu saves: a story's status, with its reason, and its release. */
export const storyChangeOperations = ["status", "release"] as const;

/** What a board on this machine can save through `createStoryMapEditServer`: persona edits and story changes. */
export const localEditOperations = [...personaEditOperations, ...storyChangeOperations] as const;

export type StoryMapEditOperation = z.infer<typeof storyMapEditOperationSchema>;

/** Options for `proposeStoryMapEdit`. */
export interface StoryMapEditOptions {
  /** Allow `customer-title` and `customer-summary`. Customer copy needs approval, so it is refused by default. */
  allowCustomer?: boolean;
  /** Sets `updatedBy` on every story the edit touches, for an edit made on someone else's behalf. Git credits the author otherwise. */
  updatedBy?: string;
  /** Checks to run on the result, as for `checkStoryMap`. */
  check?: StoryMapCheckOptions;
}

/** The outcome of `proposeStoryMapEdit`. Nothing is written: save `source` when `valid` is true. */
export interface StoryMapEditResult {
  /** The map's new text. Lines outside the changed fields are kept byte for byte. */
  source: string;
  /** False when the edit changes nothing. */
  changed: boolean;
  /** IDs given to stories added by `add`, in order. */
  addedIds: string[];
  /** IDs given to personas added by `create-persona`, in order. */
  addedPersonaIds: string[];
  /** A unified diff of the YAML, with three lines of context. Empty when nothing changed. */
  lineDiff: string;
  /** The `story-map diff` comparison of the old and new map. Absent when the new map is not valid. */
  diff?: StoryMapDiff;
  /** `diff` rendered as the Markdown summary for a PR. */
  summary?: string;
  /** Validation of the new map. */
  check: StoryMapCheckResult;
  /** Issues in `check` that the map did not have before the edit, so an agent can tell what it caused. */
  newIssues: StoryMapCheckIssue[];
  /** True when the new map has no errors, so it can be written. */
  valid: boolean;
}

/** An operation that was refused. Nothing is changed when any operation is refused. */
export class StoryMapEditError extends Error {
  /** Index of the refused operation, when one operation was at fault. */
  readonly operation?: number;
  constructor(message: string, operation?: number) {
    super(operation === undefined ? message : `Edit ${operation + 1}: ${message}`);
    this.name = "StoryMapEditError";
    this.operation = operation;
  }
}

/** The order fields are written in when an edit adds one, following the guide's examples. */
const storyKeyOrder = ["id", "title", "activity", "release", "status", "statusReason", "estimate", "priority", "tokens", "estimatedCostUsd", "dependsOn", "jobs", "personas", "updatedBy", "summary", "notes", "sources", "customer"];
const releaseKeyOrder = ["id", "title", "summary", "notes", "impact", "customer"];
const personaKeyOrder = ["id", "title", "summary", "context", "jobs", "customer"];
const mapKeyOrder = ["version", "id", "title", "summary", "visibility", "customer", "settings", "personas", "activities", "releases", "stories"];
const settingsKeyOrder = ["stalledAfterWeeks", "plans", "storyIds", "upgrade", "architectureDecisions"];
const contextKeyOrder = ["success", "usesToday", "constraints", "draft"];
const jobKeyOrder = ["id", "situation", "motivation", "outcome", "draft", "steps"];

type Raw = Record<string, unknown>;

/** Where a node parsed from the map's text starts and ends. Only nodes made in code have no range. */
function rangeOf(node: Node): [number, number, number] {
  return present(node.range, "the position of a parsed YAML node");
}
type RawStory = Raw & { id: string; release?: string };

// ---------------------------------------------------------------------------
// Text helpers. Every change is a splice of whole lines, so untouched lines stay as they are.

const lineStart = (source: string, offset: number) => source.lastIndexOf("\n", offset - 1) + 1;
function lineEnd(source: string, offset: number) {
  if (offset > 0 && source[offset - 1] === "\n") return offset;
  const next = source.indexOf("\n", offset);
  return next === -1 ? source.length : next + 1;
}
const columnOf = (source: string, offset: number) => offset - lineStart(source, offset);

/** Renders `key: value` as YAML lines indented to `indent`, ending with a newline. */
function renderPair(key: string, value: unknown, indent: number) {
  return indentLines(new Document({ [key]: value }).toString({ lineWidth: 0 }), indent);
}
/** Renders a sequence item as YAML lines whose dash is at `indent`. */
function renderItem(value: unknown, indent: number) {
  return indentLines(new Document([value]).toString({ lineWidth: 0 }), indent);
}
function indentLines(yaml: string, indent: number) {
  const pad = " ".repeat(indent);
  return `${yaml.replace(/\n$/, "").split("\n").map(line => (line ? pad + line : line)).join("\n")}\n`;
}
const ensureNewline = (source: string, at: number) => (at > 0 && source[at - 1] !== "\n" ? "\n" : "");

class TextEditor {
  constructor(public source: string) {}

  private document() {
    const document = parseDocument(this.source, { keepSourceTokens: false });
    if (document.errors.length) throw new StoryMapEditError("The map is not valid YAML, so it cannot be edited. Fix it first.");
    return document;
  }

  private splice(start: number, end: number, replacement: string) {
    this.source = this.source.slice(0, start) + ensureNewline(this.source, start) + replacement + this.source.slice(end);
  }

  private item(list: "stories" | "releases", id: string): YAMLMap {
    const seq = this.document().get(list, true);
    const found = isSeq(seq) ? seq.items.find(node => isMap(node) && node.get("id") === id) : undefined;
    if (!isMap(found)) throw new StoryMapEditError(`Could not find ${id} in the file's ${list}.`);
    return found;
  }

  /** Sets, replaces or removes one field of a story or release, keeping its other lines. */
  setField(list: "stories" | "releases", id: string, key: string, value: unknown) {
    this.setOnMap(this.item(list, id), key, value, list === "stories" ? storyKeyOrder : releaseKeyOrder);
  }

  /** Sets, replaces or removes one field of the block mapping at `path`, such as `["personas", 0, "jobs", 2]`. */
  setFieldAt(path: readonly (string | number)[], key: string, value: unknown, order: readonly string[]) {
    this.setOnMap(this.mapAt(path), key, value, order);
  }

  private setOnMap(item: YAMLMap, key: string, value: unknown, order: readonly string[]) {
    const pair = item.items.find(entry => (entry.key as { value?: unknown })?.value === key) as Pair<Node, Node> | undefined;
    if (pair) {
      const start = lineStart(this.source, rangeOf(pair.key)[0]);
      const end = lineEnd(this.source, (pair.value?.range ?? rangeOf(pair.key))[1]);
      if (value === undefined) {
        this.splice(start, end, "");
        return;
      }
      this.splice(start, end, renderPair(key, value, columnOf(this.source, rangeOf(pair.key)[0])));
      return;
    }
    if (value === undefined) return;
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    const pairs = item.items as Pair<Node, Node>[];
    const before = pairs.filter(entry => rank(String((entry.key as { value?: unknown }).value)) <= rank(key)).at(-1) ?? pairs[0];
    const at = lineEnd(this.source, (before.value?.range ?? rangeOf(before.key))[1]);
    this.splice(at, at, renderPair(key, value, columnOf(this.source, rangeOf(pairs[0].key)[0])));
  }

  /** Adds an item to the end of a list field, such as a story's sources, creating the field when it is missing. */
  appendToList(list: "stories" | "releases", id: string, key: string, item: unknown, whole: unknown[]) {
    this.appendOnMap(this.item(list, id), key, item, whole, list === "stories" ? storyKeyOrder : releaseKeyOrder);
  }

  /** Adds an item to the end of a list field of the block mapping at `path`, or of the map itself when `path` is empty, creating the field when it is missing. */
  appendToListAt(path: readonly (string | number)[], key: string, item: unknown, whole: unknown[], order: readonly string[]) {
    this.appendOnMap(this.mapAt(path), key, item, whole, order);
  }

  private appendOnMap(map: YAMLMap, key: string, item: unknown, whole: unknown[], order: readonly string[]) {
    const seq = map.get(key, true);
    if (!isSeq(seq) || !seq.items.length || seq.flow) {
      this.setOnMap(map, key, whole, order);
      return;
    }
    const last = seq.items.at(-1) as Node;
    const at = lineEnd(this.source, rangeOf(last)[1]);
    this.splice(at, at, renderItem(item, columnOf(this.source, rangeOf(seq.items[0] as Node)[0]) - 2));
  }

  /** Removes the item at `index` from a list field, or the whole field when it was the last item. */
  removeFromList(list: "stories" | "releases", id: string, key: string, index: number) {
    this.removeOnMap(this.item(list, id), key, index, list === "stories" ? storyKeyOrder : releaseKeyOrder);
  }

  /** Removes the item at `index` from a list field of the block mapping at `path`, or the whole field when it was the last item. */
  removeFromListAt(path: readonly (string | number)[], key: string, index: number, order: readonly string[]) {
    this.removeOnMap(this.mapAt(path), key, index, order);
  }

  private removeOnMap(map: YAMLMap, key: string, index: number, order: readonly string[]) {
    const seq = map.get(key, true) as unknown as YAMLSeq<Node>;
    if (seq.items.length === 1 || seq.flow) {
      this.setOnMap(map, key, seq.items.length === 1 ? undefined : (seq.toJSON() as unknown[]).filter((_, i) => i !== index), order);
      return;
    }
    const node = seq.items[index];
    this.splice(lineStart(this.source, rangeOf(node)[0]), lineEnd(this.source, rangeOf(node)[1]), "");
  }

  private mapAt(path: readonly (string | number)[]): YAMLMap {
    const document = this.document();
    const item = path.length ? document.getIn(path, true) : document.contents;
    if (!isMap(item) || item.flow) throw new StoryMapEditError(`Could not edit ${path.join(".")} without changing other parts of the file. Make it by hand.`);
    return item;
  }

  /** Inserts a story after `afterId`, or at the end of the stories list. */
  insertStory(story: Raw, afterId: string | undefined) {
    const seq = this.document().get("stories", true);
    if (!isSeq(seq) || !seq.items.length || seq.flow) throw new StoryMapEditError("The map has no stories list to add to. Add the first story by hand.");
    const items = seq.items as YAMLMap[];
    const after = (afterId && items.find(item => item.get("id") === afterId)) || items[items.length - 1];
    const firstKey = (items[0].items[0] as Pair<Node, Node>).key;
    const indent = columnOf(this.source, rangeOf(firstKey)[0]) - 2;
    const lastPair = after.items.at(-1) as Pair<Node, Node>;
    const at = lineEnd(this.source, (lastPair.value?.range ?? rangeOf(lastPair.key))[1]);
    this.splice(at, at, renderItem(story, indent));
  }
}

// ---------------------------------------------------------------------------

type SplitId = [id: string, prefix: string, digits: string];

/** Splits an ID into its prefix and trailing digits by scanning back from the end, in linear time. Null when it has no trailing digits. */
function splitStoryId(id: string): SplitId | null {
  let start = id.length;
  while (start > 0 && id.charCodeAt(start - 1) >= 48 && id.charCodeAt(start - 1) <= 57) start--;
  return start === id.length ? null : [id, id.slice(0, start), id.slice(start)];
}

/** How `add` chooses an ID: `next` takes one after the highest number, `lowest-free` the lowest unused one. */
export type StoryIdScheme = "next" | "lowest-free";

/**
 * The ID `add` gives a new story, using the map's most used prefix, whatever release the story goes in. Cut stories count, so an ID is never handed out twice.
 * `next`, the default, takes one after the highest number. `lowest-free` takes the lowest unused number above the lowest one in use, such as `ESM-103` in a
 * map with ESM-101, ESM-102 and ESM-104. `release` is no longer used and is kept so existing callers still work.
 */
export function nextStoryId(stories: readonly { id: string; release?: string }[], _release?: string, scheme: StoryIdScheme = "next"): string {
  const all = stories.map(story => splitStoryId(story.id)).filter(Boolean) as SplitId[];
  if (!all.length) throw new StoryMapEditError("The map has no numbered story IDs to follow, so choose one with --id.");
  // The most used prefix, so a map with one stray ID still follows its own scheme. A tie goes to the prefix that comes first in the map.
  const counts = new Map<string, number>();
  for (const [, prefix] of all) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  const prefix = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const numbered = all.filter(match => match[1] === prefix);
  const numbers = numbered.map(match => Number(match[2]));
  let number: number;
  if (scheme === "lowest-free") {
    const used = new Set(numbers);
    number = Math.min(...numbers);
    if (!Number.isSafeInteger(number)) throw new StoryMapEditError(`The ${prefix} numbers are too large to count, so choose an ID with --id.`);
    while (used.has(number)) number++;
  } else {
    number = Math.max(...numbers) + 1;
  }
  return `${prefix}${String(number).padStart(numbered[0][2].length, "0")}`;
}

type ListOperation = Extract<StoryMapEditOperation, { op: `${"add" | "remove"}-${"source" | "job" | "persona" | "dependency"}` }>;

/** The story field a list edit changes, and the value it adds or removes. */
function listOperand(operation: ListOperation): ["sources" | "jobs" | "personas" | "dependsOn", string] {
  if ("source" in operation) return ["sources", operation.source];
  if ("job" in operation) return ["jobs", operation.job];
  if ("dependency" in operation) return ["dependsOn", operation.dependency];
  return ["personas", operation.persona];
}

const listItemNames = { sources: "source", jobs: "job", personas: "persona", dependsOn: "dependency" } as const;

function unknownStory(id: string, stories: RawStory[], index: number): never {
  const suggestions = closestIds(id, stories.map(story => story.id));
  throw new StoryMapEditError(`There is no story ${id}.${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""}`, index);
}


type RawPersona = Raw & { id: string; context?: Raw; jobs?: (Raw & { id: string })[] };
type PersonaOperation = Extract<StoryMapEditOperation, { op: (typeof personaEditOperations)[number] }>;

/** Where the job `id` sits: its persona's index, that persona's jobs and the job's index in them. */
function findJob<P extends { jobs?: { id: string }[] }>(personas: readonly P[], id: string): { personaIndex: number; jobs: NonNullable<P["jobs"]>; jobIndex: number } | undefined {
  for (const [personaIndex, persona] of personas.entries()) {
    const jobs = persona.jobs;
    const jobIndex = jobs ? jobs.findIndex(job => job.id === id) : -1;
    if (jobs && jobIndex !== -1) return { personaIndex, jobs, jobIndex };
  }
  return undefined;
}

function unknownPersona(id: string, personas: RawPersona[], index: number | undefined, kind: "persona" | "job"): never {
  const ids = kind === "persona" ? personas.map(item => item.id) : personas.flatMap(item => (item.jobs ?? []).map(job => job.id));
  const suggestions = closestIds(id, ids);
  throw new StoryMapEditError(`There is no ${kind} ${id}.${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""}`, index);
}

/** A job ID from its “I want” text, such as `agree-its-scope-in-the` from “to agree its scope in the PR”, not used by another job. */
export function jobIdFor(motivation: string, taken: readonly string[]): string {
  return slugId(motivation.replace(/^\s*to\s+/i, ""), taken, "job");
}

/** A persona ID from their title, such as `product-manager` from “Product manager”, not used by another persona. */
export function personaIdFor(title: string, taken: readonly string[]): string {
  return slugId(title, taken, "persona");
}

/** Up to five words of `text`, and 40 characters, joined by hyphens, with `-2`, `-3` and so on when the ID is taken. */
function slugId(text: string, taken: readonly string[], fallback: string): string {
  const words = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let base = "";
  for (const word of words) {
    const next = base ? `${base}-${word}` : word;
    if (next.length > 40) break;
    base = next;
    if (base.split("-").length === 5) break;
  }
  base ||= fallback;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Rewords a persona, their context or one of their jobs. Only the fields given
 * change. An empty summary or success removes it, and an empty list removes the
 * list. `draft` is kept as it is, so an edit never confirms a draft.
 */
/** Applies one persona edit. Returns the new persona's ID for `create-persona`. */
function applyPersonaEdit(intended: Raw & { stories: RawStory[] }, editor: TextEditor, operation: PersonaOperation, index: number): string | undefined {
  const personas = (intended.personas as RawPersona[] | undefined) ?? [];
  const fields = Object.keys(operation).filter(key => key !== "op" && key !== "persona" && key !== "job");
  if (!fields.length && operation.op !== "delete-job") throw new StoryMapEditError("Give at least one field to change.", index);
  const jobIds = personas.flatMap(persona => (persona.jobs ?? []).map(job => job.id));

  if (operation.op === "create-persona") {
    if (personas.length >= personasMaxItems) throw new StoryMapEditError(`The map already has ${personasMaxItems} personas, the most it can have.`, index);
    const taken = personas.map(persona => persona.id);
    if (operation.id && taken.includes(operation.id)) throw new StoryMapEditError(`There is already a persona ${operation.id}.`, index);
    const id = operation.id ?? personaIdFor(operation.title, taken);
    const persona: RawPersona = { id, title: operation.title, ...(operation.summary ? { summary: operation.summary } : {}) };
    intended.personas = [...personas, persona];
    editor.appendToListAt([], "personas", persona, intended.personas as RawPersona[], mapKeyOrder);
    return id;
  }

  if (operation.op === "delete-job") {
    const { personaIndex, jobs, jobIndex } = findJob(personas, operation.job) ?? unknownPersona(operation.job, personas, index, "job");
    jobs.splice(jobIndex, 1);
    if (!jobs.length) delete personas[personaIndex].jobs;
    editor.removeFromListAt(["personas", personaIndex], "jobs", jobIndex, personaKeyOrder);
    // Stories that served the job keep everything else, so none is lost.
    for (const story of intended.stories) {
      const list = story.jobs as string[] | undefined;
      const at = list ? list.indexOf(operation.job) : -1;
      if (!list || at === -1) continue;
      const rest = list.filter((_, i) => i !== at);
      if (rest.length) story.jobs = rest;
      else delete story.jobs;
      editor.removeFromList("stories", story.id, "jobs", at);
    }
    return;
  }

  if (operation.op === "create-job") {
    const personaIndex = personas.findIndex(persona => persona.id === operation.persona);
    if (personaIndex === -1) unknownPersona(operation.persona, personas, index, "persona");
    const persona = personas[personaIndex];
    if ((persona.jobs?.length ?? 0) >= personaJobsMaxItems) throw new StoryMapEditError(`${persona.title ?? persona.id} already has ${personaJobsMaxItems} jobs, the most a persona can have. Remove one first.`, index);
    if (operation.id && jobIds.includes(operation.id)) throw new StoryMapEditError(`There is already a job ${operation.id}. Job IDs are unique across the map.`, index);
    const id = operation.id ?? jobIdFor(operation.motivation, jobIds);
    const job = { id, situation: operation.situation, motivation: operation.motivation, outcome: operation.outcome };
    persona.jobs = [...(persona.jobs ?? []), job];
    editor.appendToListAt(["personas", personaIndex], "jobs", job, persona.jobs, personaKeyOrder);
    return;
  }

  const setAt = (target: Raw, path: (string | number)[], key: string, value: unknown, order: readonly string[]) => {
    if (isDeepStrictEqual(target[key], value)) return;
    if (value === undefined) delete target[key];
    else target[key] = value;
    editor.setFieldAt(path, key, value, order);
  };

  if (operation.op === "set-job") {
    const { personaIndex, jobs, jobIndex } = findJob(personas, operation.job) ?? unknownPersona(operation.job, personas, index, "job");
    const job = jobs[jobIndex];
    for (const key of ["situation", "motivation", "outcome"] as const) {
      if (operation[key] !== undefined) setAt(job, ["personas", personaIndex, "jobs", jobIndex], key, operation[key], jobKeyOrder);
    }
    return;
  }

  const personaIndex = personas.findIndex(persona => persona.id === operation.persona);
  if (personaIndex === -1) unknownPersona(operation.persona, personas, index, "persona");
  const persona = personas[personaIndex];
  const path = ["personas", personaIndex];

  if (operation.op === "set-persona") {
    if (operation.title !== undefined) setAt(persona, path, "title", operation.title, personaKeyOrder);
    if (operation.summary !== undefined) setAt(persona, path, "summary", operation.summary || undefined, personaKeyOrder);
    return;
  }

  const lines = (list: string[] | undefined) => list?.filter(Boolean);
  const next: Raw = { ...(persona.context ?? {}) };
  if (operation.success !== undefined) next.success = operation.success || undefined;
  const uses = lines(operation.usesToday);
  if (uses !== undefined) next.usesToday = uses.length ? uses : undefined;
  const constraints = lines(operation.constraints);
  if (constraints !== undefined) next.constraints = constraints.length ? constraints : undefined;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  if (!next.success && !next.usesToday && !next.constraints) {
    throw new StoryMapEditError("A persona's context needs at least one of success, uses today and constraints. Keep one, or remove the context by hand.", index);
  }
  if (!persona.context) {
    setAt(persona, path, "context", next, personaKeyOrder);
    return;
  }
  const context = persona.context;
  for (const key of ["success", "usesToday", "constraints"] as const) {
    setAt(context, [...path, "context"], key, next[key], contextKeyOrder);
  }
}

/**
 * Applies named edits to the map's YAML text, all or none, and returns the new
 * text with its line diff, `story-map diff` summary and validation. Nothing is
 * written. Comments, key order and every line outside the changed fields are
 * kept as they are, and an edit that cannot be made that way is refused.
 *
 * Follows the rules in `AGENTS.md`: there is no delete, `blocked` and `cut`
 * need a reason, customer copy needs `allowCustomer`, impact items are always
 * added with `draft: true`, and IDs are never changed or reused.
 * Throws `StoryMapEditError` for a refused edit.
 */
export async function proposeStoryMapEdit(source: string, operations: readonly StoryMapEditOperation[], options: StoryMapEditOptions = {}): Promise<StoryMapEditResult> {
  let before;
  try {
    before = parseStoryMap(source);
  } catch {
    throw new StoryMapEditError("The map is not valid, so it cannot be edited. Run story-map validate and fix it first.");
  }
  if (!operations.length) throw new StoryMapEditError("No edits were given.");
  const intended = parseDocument(source).toJS() as Raw & { stories: RawStory[]; releases: (Raw & { id: string })[] };
  const editor = new TextEditor(source);
  const touched = new Set<string>();
  const addedIds: string[] = [];
  const addedPersonaIds: string[] = [];

  operations.forEach((raw, index) => {
    const parsed = storyMapEditOperationSchema.safeParse(raw);
    if (!parsed.success) throw new StoryMapEditError(parsed.error.issues.map(issue => `${issue.path.join(".") || "operation"}: ${issue.message}`).join("; "), index);
    const operation = parsed.data;

    if (operation.op === "release-impact") {
      const release = intended.releases.find(item => item.id === operation.release);
      if (!release) throw new StoryMapEditError(`There is no release ${operation.release}.`, index);
      // Drafted by whoever runs this, so only a person can confirm it by removing draft.
      const item = { metric: operation.metric, expected: operation.expected, ...(operation.solves ? { solves: operation.solves } : {}), draft: true };
      const impact = [...((release.impact as unknown[] | undefined) ?? []), item];
      release.impact = impact;
      editor.appendToList("releases", release.id, "impact", item, impact);
      return;
    }

    if (operation.op === "plans" || operation.op === "story-ids" || operation.op === "upgrade-mode" || operation.op === "architecture-decisions") {
      const [key, value] = operation.op === "plans" ? ["plans", operation.plans] as const
        : operation.op === "story-ids" ? ["storyIds", operation.storyIds] as const
        : operation.op === "upgrade-mode" ? ["upgrade", operation.upgrade] as const
        : ["architectureDecisions", operation.architectureDecisions] as const;
      const settings = intended.settings as Raw | undefined;
      if (settings?.[key] === value) return;
      if (settings) {
        settings[key] = value;
        editor.setFieldAt(["settings"], key, value, settingsKeyOrder);
      } else {
        intended.settings = { [key]: value };
        editor.setFieldAt([], "settings", intended.settings, mapKeyOrder);
      }
      return;
    }

    if (operation.op === "set-persona" || operation.op === "set-persona-context" || operation.op === "set-job" || operation.op === "create-job" || operation.op === "delete-job" || operation.op === "create-persona") {
      const created = applyPersonaEdit(intended, editor, operation, index);
      if (created) addedPersonaIds.push(created);
      return;
    }

    if (operation.op === "add") {
      const id = operation.id ?? nextStoryId(intended.stories, undefined, (intended.settings as Raw | undefined)?.storyIds === "lowest-free" ? "lowest-free" : "next");
      if (intended.stories.some(story => story.id === id)) throw new StoryMapEditError(`${id} is already in the map. IDs are never reused, so choose another or leave out --id.`, index);
      const status = operation.status ?? "planned";
      if ((status === "blocked" || status === "cut") !== !!operation.reason) {
        throw new StoryMapEditError(operation.reason ? "A reason is only for blocked and cut stories." : `A ${status} story needs a reason.`, index);
      }
      const story: RawStory = {
        id,
        title: operation.title,
        activity: operation.activity,
        release: operation.release,
        status,
        ...(operation.reason ? { statusReason: operation.reason } : {}),
        ...(operation.dependsOn?.length ? { dependsOn: operation.dependsOn } : {}),
        ...(operation.jobs?.length ? { jobs: operation.jobs } : {}),
        ...(operation.personas?.length ? { personas: operation.personas } : {}),
        ...(options.updatedBy ? { updatedBy: options.updatedBy } : {}),
        ...(operation.summary ? { summary: operation.summary } : {}),
        ...(operation.notes ? { notes: operation.notes } : {}),
        ...(operation.sources?.length ? { sources: operation.sources } : {}),
      };
      // Keep a release's stories together: after its last story, or at the end.
      const lastInRelease = intended.stories.filter(item => item.release === operation.release).at(-1);
      const position = lastInRelease ? intended.stories.indexOf(lastInRelease) + 1 : intended.stories.length;
      intended.stories.splice(position, 0, story);
      editor.insertStory(story, lastInRelease?.id);
      addedIds.push(id);
      return;
    }

    const story = intended.stories.find(item => item.id === operation.id) ?? unknownStory(operation.id, intended.stories, index);
    touched.add(story.id);
    const set = (key: string, value: unknown) => {
      if (isDeepStrictEqual(story[key], value)) return;
      if (value === undefined) delete story[key];
      else story[key] = value;
      editor.setField("stories", story.id, key, value);
    };

    switch (operation.op) {
      case "status": {
        const needsReason = operation.status === "blocked" || operation.status === "cut";
        if (needsReason && !operation.reason) throw new StoryMapEditError(`A ${operation.status} story needs a reason. Say why with --reason.`, index);
        if (!needsReason && operation.reason) throw new StoryMapEditError("A reason is only for blocked and cut stories.", index);
        set("status", operation.status);
        set("statusReason", operation.reason);
        break;
      }
      case "release":
      case "activity":
      case "title":
      case "summary":
      case "notes":
      case "tokens":
        set(operation.op, operation[operation.op as keyof typeof operation]);
        break;
      case "priority":
        set("priority", operation.priority === "none" ? undefined : operation.priority);
        break;
      case "estimated-cost":
        // Kept to the cent, as the PR shows it.
        set("estimatedCostUsd", Math.round(operation.usd * 100) / 100);
        break;
      case "add-source":
      case "add-job":
      case "add-persona":
      case "add-dependency": {
        const [key, value] = listOperand(operation);
        const list = (story[key] as string[] | undefined) ?? [];
        if (list.includes(value)) break;
        story[key] = [...list, value];
        editor.appendToList("stories", story.id, key, value, story[key] as string[]);
        break;
      }
      case "remove-source":
      case "remove-job":
      case "remove-persona":
      case "remove-dependency": {
        const [key, value] = listOperand(operation);
        const list = (story[key] as string[] | undefined) ?? [];
        const at = list.indexOf(value);
        if (at === -1) throw new StoryMapEditError(`${story.id} has no ${listItemNames[key]} ${value}.`, index);
        const rest = list.filter((_, i) => i !== at);
        if (rest.length) story[key] = rest;
        else delete story[key];
        editor.removeFromList("stories", story.id, key, at);
        break;
      }
      case "customer-title":
      case "customer-summary": {
        if (!options.allowCustomer) throw new StoryMapEditError("Customer-facing copy needs approval. Pass --customer once it is approved.", index);
        const field = operation.op === "customer-title" ? "title" : "summary";
        const value = operation.op === "customer-title" ? operation.title : operation.summary;
        const customer = { ...((story.customer as Raw | undefined) ?? {}), [field]: value };
        if (!customer.title) throw new StoryMapEditError(`${story.id} has no customer title. Set --customer-title first.`, index);
        set("customer", customer);
        break;
      }
    }
  });

  if (options.updatedBy) {
    for (const id of touched) {
      const story = present(intended.stories.find(item => item.id === id), `story ${id}`);
      if (story.updatedBy === options.updatedBy) continue;
      story.updatedBy = options.updatedBy;
      editor.setField("stories", id, "updatedBy", options.updatedBy);
    }
  }

  return finishEdit(source, before, editor, intended, options, { addedIds, addedPersonaIds });
}

/** Checks the edited text reads back as the intended map, then validates it and compares it with the old one. */
async function finishEdit(source: string, before: StoryMapDocument, editor: TextEditor, intended: Raw, options: StoryMapEditOptions, added: { addedIds: string[]; addedPersonaIds: string[] }): Promise<StoryMapEditResult> {
  // The text edits must give exactly the intended map, or something outside the edit moved.
  let same = false;
  try {
    const result = parseDocument(editor.source);
    same = !result.errors.length && isDeepStrictEqual(result.toJS(), intended);
  } catch {
    // An alias whose anchor was edited away cannot be read back.
  }
  if (!same) {
    throw new StoryMapEditError("This edit cannot be made without changing other parts of the file, so nothing was changed. Make it by hand.");
  }

  const check = await checkStoryMap(editor.source, options.check);
  // Paths shift when a story is added, so compare issues by item, field and message.
  const key = (issue: StoryMapCheckIssue) => [issue.severity, issue.file, issue.itemId, issue.path.at(-1), issue.message].join("\u0000");
  const existing = new Set((await checkStoryMap(source, options.check)).issues.map(key));
  const newIssues = check.issues.filter(issue => !existing.has(key(issue)));
  const valid = check.errors === 0;
  let diff: StoryMapDiff | undefined;
  if (valid) diff = diffStoryMaps(before, parseStoryMap(editor.source));
  return {
    source: editor.source,
    changed: editor.source !== source,
    ...added,
    lineDiff: unifiedDiff(source, editor.source),
    ...(diff ? { diff, summary: formatStoryMapDiff(diff) } : {}),
    check,
    newIssues,
    valid,
  };
}

// ---------------------------------------------------------------------------
// Confirming drafts. Kept apart from the edit operations, so `edit --from` and the
// preview can never remove `draft`: only a person confirms one, with `story-map confirm`.

/**
 * What to confirm: a job, or a persona's context, by `id`; a release's impact item
 * by its position, from 1; or every drafted job of one persona.
 */
export type StoryMapDraftTarget = { id: string } | { release: string; impact: number } | { allJobsOf: string };

/** One draft that a confirmation removes `draft: true` from, as the reader sees it. */
export type StoryMapDraft =
  | { kind: "job"; persona: { id: string; title: string }; job: StoryMapJob }
  | { kind: "context"; persona: { id: string; title: string }; context: StoryMapPersonaContext }
  | { kind: "impact"; release: { id: string; title: string }; position: number; item: ReleaseImpact };

/** The outcome of `proposeDraftConfirmation`. `changed` is false when the target is not a draft. */
export interface StoryMapDraftConfirmation extends StoryMapEditResult {
  /** The drafts the confirmation removes `draft` from, in map order. */
  drafts: StoryMapDraft[];
}

/**
 * Removes `draft: true` from a drafted job, persona context or impact item, keeping
 * every other line, and returns the drafts with the new text, as `proposeStoryMapEdit`
 * does. Nothing is written. Throws `StoryMapEditError` for an unknown or ambiguous target.
 */
export async function proposeDraftConfirmation(source: string, target: StoryMapDraftTarget, options: Pick<StoryMapEditOptions, "check"> = {}): Promise<StoryMapDraftConfirmation> {
  let before: StoryMapDocument;
  try {
    before = parseStoryMap(source);
  } catch {
    throw new StoryMapEditError("The map is not valid, so it cannot be edited. Run story-map validate and fix it first.");
  }
  const intended = parseDocument(source).toJS() as Raw & { personas?: RawPersona[]; releases: (Raw & { id: string; impact?: Raw[] })[] };
  const editor = new TextEditor(source);
  const personas = before.personas ?? [];
  const drafts: StoryMapDraft[] = [];
  const named = (item: { id: string; title: string }) => ({ id: item.id, title: item.title });
  const confirmJob = (personaIndex: number, jobIndex: number, job: StoryMapJob) => {
    if (!job.draft) return;
    drafts.push({ kind: "job", persona: named(personas[personaIndex]), job });
    delete present(intended.personas?.[personaIndex]?.jobs?.[jobIndex], `job ${job.id}`).draft;
    editor.setFieldAt(["personas", personaIndex, "jobs", jobIndex], "draft", undefined, jobKeyOrder);
  };

  if ("release" in target) {
    const releaseIndex = before.releases.findIndex(release => release.id === target.release);
    if (releaseIndex === -1) {
      const suggestions = closestIds(target.release, before.releases.map(release => release.id));
      throw new StoryMapEditError(`There is no release ${target.release}.${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""}`);
    }
    const release = before.releases[releaseIndex];
    const impact = release.impact ?? [];
    if (!Number.isInteger(target.impact) || target.impact < 1 || target.impact > impact.length) {
      throw new StoryMapEditError(impact.length ? `${release.id} has ${impact.length} impact ${impact.length === 1 ? "item" : "items"}, so give a number from 1 to ${impact.length}.` : `${release.id} has no impact items.`);
    }
    const item = impact[target.impact - 1];
    if (item.draft) {
      drafts.push({ kind: "impact", release: named(release), position: target.impact, item });
      delete present(intended.releases[releaseIndex].impact?.[target.impact - 1], `impact item ${target.impact} of ${release.id}`).draft;
      editor.setFieldAt(["releases", releaseIndex, "impact", target.impact - 1], "draft", undefined, []);
    }
  } else if ("allJobsOf" in target) {
    const personaIndex = personas.findIndex(persona => persona.id === target.allJobsOf);
    if (personaIndex === -1) unknownPersona(target.allJobsOf, intended.personas ?? [], undefined, "persona");
    for (const [jobIndex, job] of (personas[personaIndex].jobs ?? []).entries()) confirmJob(personaIndex, jobIndex, job);
  } else {
    const jobOwner = findJob(personas, target.id);
    const personaIndex = personas.findIndex(persona => persona.id === target.id);
    if (jobOwner && personaIndex !== -1) {
      throw new StoryMapEditError(`${target.id} is both a job and a persona. Confirm the job by hand, or the persona's jobs with --all-in ${target.id}.`);
    }
    if (jobOwner) confirmJob(jobOwner.personaIndex, jobOwner.jobIndex, jobOwner.jobs[jobOwner.jobIndex]);
    else if (personaIndex !== -1) {
      const persona = personas[personaIndex];
      if (persona.context?.draft) {
        drafts.push({ kind: "context", persona: named(persona), context: persona.context });
        delete present(intended.personas?.[personaIndex]?.context, `the context of ${persona.id}`).draft;
        editor.setFieldAt(["personas", personaIndex, "context"], "draft", undefined, contextKeyOrder);
      }
    } else {
      const ids = [...personas.flatMap(persona => (persona.jobs ?? []).map(job => job.id)), ...personas.map(persona => persona.id)];
      const suggestions = closestIds(target.id, ids);
      throw new StoryMapEditError(`There is no job or persona ${target.id}.${suggestions.length ? ` Did you mean ${suggestions.join(", ")}?` : ""} For a release's impact, give --impact <n>.`);
    }
  }

  return { ...(await finishEdit(source, before, editor, intended, options, { addedIds: [], addedPersonaIds: [] })), drafts };
}

// ---------------------------------------------------------------------------

/** A unified diff of two texts by line, from their longest common subsequence after trimming the shared start and end. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  // Lengths of common subsequences of the suffixes, then a walk to list the lines.
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  type Line = { kind: " " | "-" | "+"; text: string; oldLine: number; newLine: number };
  const lines: Line[] = [];
  for (let k = 0; k < head; k++) lines.push({ kind: " ", text: a[k], oldLine: k, newLine: k });
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) lines.push({ kind: " ", text: x[i++], oldLine: head + i - 1, newLine: head + j++ });
    else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) lines.push({ kind: "-", text: x[i++], oldLine: head + i - 1, newLine: head + j });
    else lines.push({ kind: "+", text: y[j++], oldLine: head + i, newLine: head + j - 1 });
  }
  for (let k = 0; k < tail; k++) lines.push({ kind: " ", text: a[a.length - tail + k], oldLine: a.length - tail + k, newLine: b.length - tail + k });

  const changed = lines.map((line, index) => (line.kind === " " ? -1 : index)).filter(index => index >= 0);
  const hunks: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const last = hunks.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }
  const output = ["--- before", "+++ after"];
  for (const [start, end] of hunks) {
    const slice = lines.slice(start, end);
    const oldCount = slice.filter(line => line.kind !== "+").length;
    const newCount = slice.filter(line => line.kind !== "-").length;
    output.push(`@@ -${slice[0].oldLine + 1},${oldCount} +${slice[0].newLine + 1},${newCount} @@`);
    for (const line of slice) output.push(`${line.kind}${line.text}`);
  }
  return `${output.join("\n")}\n`;
}
