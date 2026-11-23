import { isDeepStrictEqual } from "node:util";
import { Document, isMap, isSeq, parseDocument, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { z } from "zod";
import { checkStoryMap, type StoryMapCheckIssue, type StoryMapCheckOptions, type StoryMapCheckResult } from "./check.js";
import { diffStoryMaps, formatStoryMapDiff, type StoryMapDiff } from "./diff.js";
import { closestIds } from "./read.js";
import { parseStoryMap } from "./schema.js";
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
  z.object({ op: z.literal("tokens"), id: storyId, tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
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
]);

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
const storyKeyOrder = ["id", "title", "activity", "release", "status", "statusReason", "estimate", "tokens", "dependsOn", "jobs", "personas", "updatedBy", "summary", "notes", "sources", "customer"];
const releaseKeyOrder = ["id", "title", "summary", "notes", "impact", "customer"];

type Raw = Record<string, unknown>;
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
  return yaml.replace(/\n$/, "").split("\n").map(line => (line ? pad + line : line)).join("\n") + "\n";
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
    const item = this.item(list, id);
    const pair = item.items.find(entry => (entry.key as { value?: unknown })?.value === key) as Pair<Node, Node> | undefined;
    if (pair) {
      const start = lineStart(this.source, pair.key.range![0]);
      const end = lineEnd(this.source, (pair.value?.range ?? pair.key.range!)[1]);
      if (value === undefined) {
        this.splice(start, end, "");
        return;
      }
      this.splice(start, end, renderPair(key, value, columnOf(this.source, pair.key.range![0])));
      return;
    }
    if (value === undefined) return;
    const order = list === "stories" ? storyKeyOrder : releaseKeyOrder;
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    const pairs = item.items as Pair<Node, Node>[];
    const before = pairs.filter(entry => rank(String((entry.key as { value?: unknown }).value)) <= rank(key)).at(-1) ?? pairs[0];
    const at = lineEnd(this.source, (before.value?.range ?? before.key.range!)[1]);
    this.splice(at, at, renderPair(key, value, columnOf(this.source, pairs[0].key.range![0])));
  }

  /** Adds an item to the end of a list field, such as a story's sources, creating the field when it is missing. */
  appendToList(list: "stories" | "releases", id: string, key: string, item: unknown, whole: unknown[]) {
    const seq = this.item(list, id).get(key, true);
    if (!isSeq(seq) || !seq.items.length || seq.flow) {
      this.setField(list, id, key, whole);
      return;
    }
    const last = seq.items.at(-1) as Node;
    const at = lineEnd(this.source, last.range![1]);
    this.splice(at, at, renderItem(item, columnOf(this.source, (seq.items[0] as Node).range![0]) - 2));
  }

  /** Removes the item at `index` from a list field, or the whole field when it was the last item. */
  removeFromList(list: "stories" | "releases", id: string, key: string, index: number) {
    const seq = this.item(list, id).get(key, true) as unknown as YAMLSeq<Node>;
    if (seq.items.length === 1 || seq.flow) {
      this.setField(list, id, key, seq.items.length === 1 ? undefined : (seq.toJSON() as unknown[]).filter((_, i) => i !== index));
      return;
    }
    const node = seq.items[index];
    this.splice(lineStart(this.source, node.range![0]), lineEnd(this.source, node.range![1]), "");
  }

  /** Inserts a story after `afterId`, or at the end of the stories list. */
  insertStory(story: Raw, afterId: string | undefined) {
    const seq = this.document().get("stories", true);
    if (!isSeq(seq) || !seq.items.length || seq.flow) throw new StoryMapEditError("The map has no stories list to add to. Add the first story by hand.");
    const items = seq.items as YAMLMap[];
    const after = (afterId && items.find(item => item.get("id") === afterId)) || items.at(-1)!;
    const firstKey = (items[0].items[0] as Pair<Node, Node>).key;
    const indent = columnOf(this.source, firstKey.range![0]) - 2;
    const lastPair = after.items.at(-1) as Pair<Node, Node>;
    const at = lineEnd(this.source, (lastPair.value?.range ?? lastPair.key.range!)[1]);
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

/**
 * The next number in sequence for the map: one after the highest number with the map's most used prefix, whatever release the story goes in.
 * Cut stories count, so an ID is never handed out twice. `release` is no longer used and is kept so existing callers still work.
 */
export function nextStoryId(stories: readonly { id: string; release?: string }[], _release?: string): string {
  const all = stories.map(story => splitStoryId(story.id)).filter(Boolean) as SplitId[];
  if (!all.length) throw new StoryMapEditError("The map has no numbered story IDs to follow, so choose one with --id.");
  // The most used prefix, so a map with one stray ID still follows its own scheme.
  const counts = new Map<string, number>();
  for (const [, prefix] of all) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  const prefix = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const numbered = all.filter(match => match[1] === prefix);
  const number = Math.max(...numbered.map(match => Number(match[2]))) + 1;
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

    if (operation.op === "add") {
      const id = operation.id ?? nextStoryId(intended.stories);
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
      const story = intended.stories.find(item => item.id === id)!;
      if (story.updatedBy === options.updatedBy) continue;
      story.updatedBy = options.updatedBy;
      editor.setField("stories", id, "updatedBy", options.updatedBy);
    }
  }

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
    addedIds,
    lineDiff: unifiedDiff(source, editor.source),
    ...(diff ? { diff, summary: formatStoryMapDiff(diff) } : {}),
    check,
    newIssues,
    valid,
  };
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
