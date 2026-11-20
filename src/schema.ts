import { z } from "zod";
import { LineCounter, isMap, parseDocument, type Document, type Node } from "yaml";
import { isActiveStatus, storyStatuses } from "./status.js";

export { storyStatuses };
export type { StoryStatus } from "./status.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const title = z.string().trim().min(1).max(120);
const summary = z.string().trim().max(500).optional();
const customerCopy = z.object({
  title: title.describe("Customer-facing title. Add only after the wording is approved."),
  summary: summary.describe("Optional customer-facing summary."),
}).strict();

function groupFields(kind: "activity" | "release") {
  return {
    id: id.describe(`Stable ${kind} ID that stories reference. Keep it when renaming.`),
    title: title.describe(`Internal ${kind} title.`),
    summary: summary.describe(`Optional internal ${kind} summary.`),
    customer: customerCopy.optional().describe(`Customer-facing ${kind} label. Required before a customer-facing story can use this ${kind}.`),
  };
}

const activity = z.object(groupFields("activity")).strict()
  .describe("Activities run left to right in the order of the user journey.");

/** Longest release notes, in characters. */
export const releaseNotesMaxLength = 800;
/** Most impact items on one release. */
export const releaseImpactMaxItems = 10;

const impactItem = z.object({
  metric: z.string().trim().min(1).max(120).describe("What is measured, such as “Estimate turnaround time”."),
  expected: z.string().trim().min(1).max(200)
    .describe("The expected change, written for people, such as “Decrease from 3 days to 1 day”. Not parsed."),
  solves: z.string().trim().min(1).max(300).optional().describe("Optional. The problem this addresses."),
  actual: z.string().trim().min(1).max(200).optional().describe("Optional. The measured result, added after shipping."),
  draft: z.boolean().optional()
    .describe("true when an agent drafted this item and nobody has confirmed it yet. Only a person removes it."),
}).strict();

const release = z.object({
  ...groupFields("release"),
  notes: z.string().trim().max(releaseNotesMaxLength).optional()
    .describe("Optional internal release notes: plain text up to 800 characters. Blank lines separate paragraphs. No Markdown."),
  impact: z.array(impactItem).max(releaseImpactMaxItems).optional()
    .describe("Optional, recommended. Up to 10 expected outcomes of the release. Internal only."),
}).strict().describe("Releases run top to bottom in delivery order.");

const story = z.object({
  id: id.describe("Stable story ID, such as BUILDER-102. Keep it when renaming or moving the story."),
  title: title.describe("Outcome-focused internal title."),
  activity: id.describe("ID of the activity column this story sits under."),
  release: id.describe("ID of the release lane this story belongs to."),
  summary: summary.describe("Optional internal summary, shown when the card is opened."),
  status: z.enum(storyStatuses).default("planned")
    .describe("planned: agreed work awaiting implementation. in-progress: work has started. shipped: available to its intended users. blocked: started or agreed, but cannot continue. cut: deliberately dropped from its release. Blocked and cut stories are hidden by default and never shown to customers."),
  statusReason: z.string().trim().min(1).max(500).optional()
    .describe("Why the story is blocked or cut. Internal only."),
  updatedBy: z.string().trim().min(1).max(120).optional().describe("Display name of the person who last added or edited the story."),
  notes: z.string().trim().max(4000).optional().describe("Internal engineering notes."),
  sources: z.array(z.string().trim().min(1).max(250)).max(20).optional()
    .describe("Supporting docs, tests or links. The first Markdown link with a #heading becomes the Engineering overview link."),
  customer: customerCopy.optional().describe("Customer-facing copy. Add only when the story is approved for all users."),
}).strict();

/** Weeks a story can stay in progress before it is flagged as stalled, when the map does not say. */
export const defaultStalledAfterWeeks = 4;

const settings = z.object({
  stalledAfterWeeks: z.number().int().min(0).max(104).optional()
    .describe("Flag a story as stalled when it has been in progress for longer than this many weeks. Defaults to 4. 0 turns the flag off. Needs the history file from `story-map history`."),
}).strict().describe("Optional settings for everyone who views the map. Hosts can override them.");

type Path = (string | number)[];
type Item = { id?: unknown; activity?: unknown; release?: unknown; customer?: unknown };

function items(value: unknown): Item[] {
  return Array.isArray(value) ? value.map(item => item && typeof item === "object" ? item as Item : {}) : [];
}

/**
 * Checks IDs and references across the map. It reads the input defensively, so
 * it can also report these problems for a map with structural errors.
 */
function crossReferenceIssues(input: unknown): { path: Path; message: string }[] {
  if (!input || typeof input !== "object") return [];
  const map = input as Record<string, unknown>;
  const issues: { path: Path; message: string }[] = [];
  const issue = (path: Path, message: string) => issues.push({ path, message });

  if (map.visibility === "all-users" && !map.customer) {
    issue(["customer"], "The all-users view requires customer-facing map copy.");
  }

  for (const field of ["activities", "releases", "stories"] as const) {
    const ids = new Set<unknown>();
    items(map[field]).forEach((entry, index) => {
      if (typeof entry.id !== "string") return;
      if (ids.has(entry.id)) issue([field, index, "id"], `Duplicate ID '${entry.id}'.`);
      ids.add(entry.id);
    });
  }

  const activities = new Map(items(map.activities).map(activity => [activity.id, activity]));
  const releases = new Map(items(map.releases).map(release => [release.id, release]));

  items(map.stories).forEach((story, index) => {
    const activity = activities.get(story.activity);
    const release = releases.get(story.release);

    if (typeof story.activity === "string" && !activity) issue(["stories", index, "activity"], `Unknown activity '${story.activity}'.`);
    if (typeof story.release === "string" && !release) issue(["stories", index, "release"], `Unknown release '${story.release}'.`);
    if (story.customer && activity && !activity.customer) {
      issue(["stories", index, "activity"], "A customer-facing story requires customer-facing copy for its activity.");
    }
    if (story.customer && release && !release.customer) {
      issue(["stories", index, "release"], "A customer-facing story requires customer-facing copy for its release.");
    }
  });
  return issues;
}

export const storyMapSchema = z.object({
  version: z.literal(1).describe("Story map format version."),
  id: id.describe("Product-specific map ID."),
  title: title.describe("Internal map title."),
  summary: summary.describe("Optional internal map summary."),
  visibility: z.enum(["internal", "all-users"]).default("internal")
    .describe("internal: only internal viewers can see the map. all-users: signed-in users see the customer-facing view."),
  customer: customerCopy.optional().describe("Customer-facing map title and summary. Required when visibility is all-users."),
  settings: settings.optional(),
  activities: z.array(activity).min(1).max(50),
  releases: z.array(release).min(1).max(50),
  stories: z.array(story.describe("Stories appear in this order within each cell.")).max(1000),
}).strict().superRefine((map, context) => {
  for (const { path, message } of crossReferenceIssues(map)) {
    context.addIssue({ code: "custom", path, message });
  }
}).meta({
  title: "Embedded Story Map",
  description: "A Git-backed user story map. Validate cross-references with `story-map validate`.",
});

export type StoryMapDocument = z.infer<typeof storyMapSchema>;
export type ReleaseImpact = z.infer<typeof impactItem>;

export type StoryMapIssueSeverity = "error" | "warning";

export interface StoryMapIssue {
  /** Errors make the map invalid. Warnings are advice: the map still parses and CI passes unless run with `--strict`. */
  severity: StoryMapIssueSeverity;
  /** Location in the map, such as `["stories", 3, "release"]`. Empty for the whole file. */
  path: (string | number)[];
  message: string;
  /** 1-based line in the YAML source, when it can be located. */
  line?: number;
  /** 1-based column in the YAML source, when it can be located. */
  column?: number;
  /** ID of the activity, release or story that contains the issue. */
  itemId?: string;
}

/** Names the part of the map an issue is about, such as `stories.3.release (FINANCE-201)`. */
export function describeIssueTarget(issue: StoryMapIssue): string {
  const path = issue.path.join(".") || "map";
  return issue.itemId ? `${path} (${issue.itemId})` : path;
}

export function formatStoryMapIssue(issue: StoryMapIssue): string {
  const line = issue.line ? `line ${issue.line}: ` : "";
  const level = issue.severity === "warning" ? "warning: " : "";
  return `${line}${level}${describeIssueTarget(issue)}: ${issue.message}`;
}

export class StoryMapValidationError extends Error {
  readonly issues: StoryMapIssue[];

  constructor(issues: StoryMapIssue[]) {
    super(issues.map(formatStoryMapIssue).join("\n"));
    this.name = "StoryMapValidationError";
    this.issues = issues;
  }
}

function locate(document: Document, lineCounter: LineCounter, path: (string | number)[], key?: string) {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = document.getIn(path.slice(0, depth), true) as Node | undefined;
    if (!node?.range) continue;
    let offset = node.range[0];
    if (key !== undefined && depth === path.length && isMap(node)) {
      const pair = node.items.find(item => (item.key as { value?: unknown } | null)?.value === key);
      const keyNode = pair?.key as Node | undefined;
      if (keyNode?.range) offset = keyNode.range[0];
    }
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  }
  return {};
}

function itemIdAt(data: unknown, path: (string | number)[]) {
  const [field, index] = path;
  if (typeof field !== "string" || typeof index !== "number" || !data || typeof data !== "object") return undefined;
  const list = (data as Record<string, unknown>)[field];
  const item = Array.isArray(list) ? list[index] : undefined;
  const itemId = item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined;
  return typeof itemId === "string" ? itemId : undefined;
}

/**
 * Parses and validates a story map. Throws a `StoryMapValidationError` whose
 * `issues` give the path, item ID and source line of each problem.
 */
export function parseStoryMap(source: string): StoryMapDocument {
  return loadStoryMap(source).map;
}

/**
 * Checks a valid map for problems that should not fail validation, such as a
 * blocked story with no reason. Paths point into the map like error paths.
 */
export function storyMapWarnings(map: StoryMapDocument): StoryMapIssue[] {
  const warnings: StoryMapIssue[] = [];
  const releasesWithShipped = new Set<string>();
  const releasesWithActive = new Set<string>();
  for (const story of map.stories) {
    if (isActiveStatus(story.status)) releasesWithActive.add(story.release);
    if (story.status === "shipped") releasesWithShipped.add(story.release);
  }
  map.releases.forEach((release, index) => {
    if (releasesWithActive.has(release.id) && !release.impact?.length) {
      warnings.push({
        severity: "warning",
        path: ["releases", index],
        message: "Add impact: what the release is expected to change, and how it will be measured.",
        itemId: release.id,
      });
    }
    if (!releasesWithShipped.has(release.id)) return;
    release.impact?.forEach((item, itemIndex) => {
      if (!item.draft) return;
      warnings.push({
        severity: "warning",
        path: ["releases", index, "impact", itemIndex, "draft"],
        message: `Confirm the drafted impact for “${item.metric}” and remove draft: true. The release has shipped stories.`,
        itemId: release.id,
      });
    });
  });
  map.stories.forEach((story, index) => {
    if ((story.status === "blocked" || story.status === "cut") && !story.statusReason) {
      warnings.push({
        severity: "warning",
        path: ["stories", index, "status"],
        message: `Add a statusReason explaining why the story is ${story.status}.`,
        itemId: story.id,
      });
    }
  });
  return warnings;
}

export interface LoadedStoryMap {
  map: StoryMapDocument;
  /** Problems that do not make the map invalid, in source order. */
  warnings: StoryMapIssue[];
  /** Finds the source position of a path in the map, such as `["stories", 2, "sources", 0]`. */
  locate(path: (string | number)[]): { line?: number; column?: number };
}

/** Like `parseStoryMap`, but keeps source positions for reporting problems found later. */
export function loadStoryMap(source: string): LoadedStoryMap {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { uniqueKeys: true, lineCounter });
  if (document.errors.length) {
    throw new StoryMapValidationError(document.errors.map(error => {
      const position = error.linePos?.[0];
      return {
        severity: "error" as const,
        path: [],
        message: error.message.replace(/ at line \d+, column \d+:[\s\S]*$/, "").trim(),
        line: position?.line,
        column: position?.col,
      };
    }));
  }

  const data = document.toJS({ maxAliasCount: 20 });
  const result = storyMapSchema.safeParse(data, {
    error: issue => {
      if (issue.code === "invalid_type" && issue.input === undefined) return "Missing required field.";
      if (issue.code === "invalid_value" && issue.values.length > 1) {
        return `Use one of ${issue.values.map(value => `'${String(value)}'`).join(", ")}.`;
      }
      return undefined;
    },
  });
  if (result.success) {
    const find = (path: (string | number)[]) => locate(document, lineCounter, path);
    const warnings = storyMapWarnings(result.data)
      .map(warning => ({ ...warning, ...find(warning.path) }))
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    return { map: result.data, warnings, locate: find };
  }

  // Zod skips the cross-reference checks once a field fails, so run them here
  // too and report every problem in one pass.
  const reported = new Set(result.error.issues.map(issue => `${issue.path.join(".")}\n${issue.message}`));
  const extra = crossReferenceIssues(data)
    .filter(issue => !reported.has(`${issue.path.join(".")}\n${issue.message}`))
    .map(issue => ({ ...issue, code: "custom" as const }));

  const issues: StoryMapIssue[] = [];
  for (const issue of [...result.error.issues, ...extra]) {
    const path = issue.path.map(segment => typeof segment === "number" ? segment : String(segment));
    const itemId = itemIdAt(data, path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        issues.push({ severity: "error", path: [...path, key], message: "Unknown field.", itemId, ...locate(document, lineCounter, path, key) });
      }
      continue;
    }
    issues.push({ severity: "error", path, message: issue.message, itemId, ...locate(document, lineCounter, path) });
  }
  issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  throw new StoryMapValidationError(issues);
}
