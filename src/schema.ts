import { z } from "zod";
import { LineCounter, isMap, isScalar, isSeq, parseDocument, visit, type Document, type Node } from "yaml";
import { jobStepCounter, storyPersonaResolver } from "./personas.js";
import { isActiveStatus, storyStatuses } from "./status.js";

export { storyStatuses };
export type { StoryStatus } from "./status.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const title = z.string().trim().min(1).max(120);
const summary = z.string().trim().max(500).optional();

/** Longest release notes, in characters. */
export const releaseNotesMaxLength = 800;
/** Most impact items on one release. */
export const releaseImpactMaxItems = 10;

/** The story point scale an estimate must use. Any other value fails validation. */
export const estimatePoints = [1, 2, 3, 5, 8, 13] as const;
export type EstimatePoints = typeof estimatePoints[number];

/** Most personas on one map. */
export const personasMaxItems = 12;
/** Most jobs to be done on one persona. */
export const personaJobsMaxItems = 8;
/** Most jobs or personas on one story. */
export const storyPersonasMaxItems = 4;
/** Most stories one story can depend on. */
export const storyDependsOnMaxItems = 10;
/** Most workflow steps on one job. */
export const jobStepsMaxItems = 6;
/** Longest job step title, in characters. */
export const jobStepTitleMaxLength = 60;
/** Longest part of a job statement, in characters. */
export const jobStatementMaxLength = 200;
/** Longest `success` or constraint in a persona's context, in characters. */
export const personaContextMaxLength = 200;
/** Most entries in a persona's `usesToday`. */
export const personaUsesTodayMaxItems = 8;
/** Longest entry in a persona's `usesToday`, in characters. */
export const personaUsesTodayMaxLength = 60;
/** Most constraints in a persona's context. */
export const personaConstraintsMaxItems = 6;

/** Weeks a story can stay in progress before it is flagged as stalled, when the map does not say. */
export const defaultStalledAfterWeeks = 4;

/**
 * Builds the format's schemas. There is one description of the format:
 * `strict` rejects unknown fields, for the current map, and lenient mode
 * drops them, for reading past versions of the map.
 */
function formatSchemas(strict: boolean) {
  const object = <Shape extends z.ZodRawShape>(shape: Shape) => strict ? z.object(shape).strict() : z.object(shape);

  const customerCopy = object({
    title: title.describe("Customer-facing title. Add only after the wording is approved."),
    summary: summary.describe("Optional customer-facing summary."),
  });

  function groupFields(kind: "activity" | "release") {
    return {
      id: id.describe(`Stable ${kind} ID that stories reference. Keep it when renaming.`),
      title: title.describe(`Internal ${kind} title.`),
      summary: summary.describe(`Optional internal ${kind} summary.`),
      customer: customerCopy.optional().describe(`Customer-facing ${kind} label. Required before a customer-facing story can use this ${kind}.`),
    };
  }

  const activity = object(groupFields("activity"))
    .describe("Activities run left to right in the order of the user journey.");

  const impactItem = object({
    metric: z.string().trim().min(1).max(120).describe("What is measured, such as “Estimate turnaround time”."),
    expected: z.string().trim().min(1).max(200)
      .describe("The expected change, written for people, such as “Decrease from 3 days to 1 day”. Not parsed."),
    solves: z.string().trim().min(1).max(300).optional().describe("Optional. The problem this addresses."),
    actual: z.string().trim().min(1).max(200).optional().describe("Optional. The measured result, added after shipping."),
    draft: z.boolean().optional()
      .describe("true when an agent drafted this item and nobody has confirmed it yet. Only a person removes it."),
  });

  const statementPart = (lead: string, guidance: string, example: string) => z.string().trim().min(1).max(jobStatementMaxLength)
    .describe(`Written without its lead word, which the board adds: “${lead} …”. ${guidance} Such as “${example}”.`);

  const jobStep = object({
    title: z.string().trim().min(1).max(jobStepTitleMaxLength).describe(`A short name for the step, up to ${jobStepTitleMaxLength} characters, such as “Gather” or “Agree scope”.`),
    summary: summary.describe("Optional. What the persona does in this step."),
    activity: id.optional()
      .describe("Optional ID of the activity where the stories for this step live. The step's stories are those that serve its job and sit in this activity. A step without one has no stories of its own."),
  }).describe("One step of a job, in the order the persona does them. Internal only.");

  const job = object({
    id: id.describe("Stable job ID, unique across the map, that stories reference in their jobs. Keep it when rewording the job or moving it to another persona."),
    situation: statementPart("When", "The trigger and what makes it hard, not only the moment or a role.", "a release is being planned and its scope is spread across chat threads and tickets"),
    motivation: statementPart("I want", "What they want to do in that moment, in their words, without naming a feature.", "to agree its scope in the PR that changes the map"),
    outcome: statementPart("so that", "What gets better for them and what is at stake if it does not.", "engineers and product start from the same list, rather than finding out at the demo that they meant different things"),
    draft: z.boolean().optional()
      .describe("true when an agent drafted this job and nobody has confirmed it yet. Only a person removes it."),
    steps: z.array(jobStep).max(jobStepsMaxItems).optional()
      .describe(`Optional. Up to ${jobStepsMaxItems} workflow steps, in order, each pointing to the activity where its stories live. Any job can have steps, not only the core job.`),
  }).describe("A job to be done: “When <situation>, I want <motivation>, so that <outcome>.” Internal only.");

  const contextLine = z.string().trim().min(1).max(personaContextMaxLength);
  const personaContext = object({
    success: contextLine.optional()
      .describe("Optional. What a good result looks like to them, such as “Weekly forecast accuracy, judged by the VP of Sales” or “Every bill paid on time”."),
    usesToday: z.array(z.string().trim().min(1).max(personaUsesTodayMaxLength)).max(personaUsesTodayMaxItems).optional()
      .describe(`Optional. Up to ${personaUsesTodayMaxItems} products, tools and workarounds they rely on now, which a story competes with.`),
    constraints: z.array(contextLine).max(personaConstraintsMaxItems).optional()
      .describe(`Optional. Up to ${personaConstraintsMaxItems} constraints they work under, which change what a story can assume.`),
    draft: z.boolean().optional()
      .describe("true when an agent drafted this context and nobody has confirmed it yet. Only a person removes it."),
  }).describe("What success means to them, what they use today and their constraints. Needs at least one of success, usesToday and constraints. Internal only.");

  const persona = object({
    id: id.describe("Stable persona ID that stories reference in their personas. Keep it when renaming."),
    title: title.describe("Internal persona name, such as “Product manager”. The board takes the avatar's initials from it."),
    summary: summary.describe("Optional internal summary of who they are and what they own."),
    context: personaContext.optional().describe("Optional internal context: what success means to them, what they use today and their constraints. Never shown to customers."),
    jobs: z.array(job).max(personaJobsMaxItems).optional()
      .describe(`Optional. Up to ${personaJobsMaxItems} jobs to be done that stories serve. The first is the persona's core job, the one that matters most, so reordering the jobs changes it.`),
    customer: customerCopy.optional().describe("Customer-facing persona name. Add only after the wording is approved."),
  }).describe("A person the product serves. The order sets each persona's colour on the board.");

  const storyRefs = (kind: string, extra: string) => z.array(id).max(storyPersonasMaxItems).optional()
    .describe(`Optional. Up to ${storyPersonasMaxItems} ${kind} IDs, most important first. ${extra}`);

  const release = object({
    ...groupFields("release"),
    notes: z.string().trim().max(releaseNotesMaxLength).optional()
      .describe("Optional internal release notes: plain text up to 800 characters. Blank lines separate paragraphs. No Markdown."),
    impact: z.array(impactItem).max(releaseImpactMaxItems).optional()
      .describe("Optional, recommended. Up to 10 expected outcomes of the release. Internal only."),
  }).describe("Releases run top to bottom in delivery order.");

  const story = object({
    id: id.describe("Stable story ID, such as BUILDER-102. Keep it when renaming or moving the story."),
    title: title.describe("Outcome-focused internal title."),
    activity: id.describe("ID of the activity column this story sits under."),
    release: id.describe("ID of the release lane this story belongs to."),
    summary: summary.describe("Optional internal summary, shown when the card is opened."),
    status: z.enum(storyStatuses).default("planned")
      .describe("planned: agreed work awaiting implementation. in-progress: work has started. merged: the work is merged to the default branch but not yet available to its intended users; customers see it as in progress. shipped: available to its intended users. blocked: started or agreed, but cannot continue. cut: deliberately dropped from its release. Blocked and cut stories are hidden by default and never shown to customers."),
    statusReason: z.string().trim().min(1).max(500).optional()
      .describe("Why the story is blocked or cut. Internal only."),
    jobs: storyRefs("job", "The story's personas include the persona that owns each job."),
    personas: storyRefs("persona", "For a persona the story helps without serving one of their jobs. Personas from jobs need not be repeated."),
    dependsOn: z.array(id).max(storyDependsOnMaxItems).optional()
      .describe(`Optional. Up to ${storyDependsOnMaxItems} IDs of stories that must land before this one, most important first. Internal only. The stories waiting for a story are worked out from these lists, so list each dependency once, on the story that waits.`),
    estimate: z.literal(estimatePoints, { error: `Use one of ${estimatePoints.join(", ")} story points.` }).optional()
      .describe(`Optional effort estimate in story points: ${estimatePoints.join(", ")}. Internal only. A story above 13 should be split.`),
    tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
      .describe("Optional. Model tokens used to deliver the story, counting input, output and cache tokens, recorded in the pull request that finishes it, such as from `story-map tokens`. Internal only."),
    estimatedCostUsd: z.number().min(0).max(1_000_000_000).optional()
      .describe("Optional. Estimated cost of those tokens in US dollars at API list prices, such as from `story-map tokens`. Internal only. It is not what was billed: a subscription, discount or another provider changes that."),
    updatedBy: z.string().trim().min(1).max(120).optional().describe("Optional. Display name of the person to credit for this edit, when it is not the commit author. The status history credits Git otherwise."),
    notes: z.string().trim().max(4000).optional().describe("Internal engineering notes."),
    sources: z.array(z.string().trim().min(1).max(250)).max(20).optional()
      .describe("Supporting docs, tests or links. The first Markdown link with a #heading becomes the Engineering overview link."),
    customer: customerCopy.optional().describe("Customer-facing copy. Add only when the story is approved for all users."),
  });

  const settings = object({
    stalledAfterWeeks: z.number().int().min(0).max(104).optional()
      .describe("Flag a story as stalled when it has been in progress for longer than this many weeks. Defaults to 4. 0 turns the flag off. Needs the history file from `story-map history`."),
  }).describe("Optional settings for everyone who views the map. Hosts can override them.");

  const map = object({
    version: z.literal(1).describe("Story map format version."),
    id: id.describe("Product-specific map ID."),
    title: title.describe("Internal map title."),
    summary: summary.describe("Optional internal map summary."),
    visibility: z.enum(["internal", "all-users"]).default("internal")
      .describe("internal: only internal viewers can see the map. all-users: signed-in users see the customer-facing view."),
    customer: customerCopy.optional().describe("Customer-facing map title and summary. Required when visibility is all-users."),
    settings: settings.optional(),
    personas: z.array(persona).max(personasMaxItems).optional()
      .describe(`Optional. Up to ${personasMaxItems} people the product serves, with their jobs to be done.`),
    activities: z.array(activity).min(1).max(50),
    releases: z.array(release).min(1).max(50),
    stories: z.array(story.describe("Stories appear in this order within each cell.")).max(1000),
  });
  return { map, story, impactItem, persona, job, jobStep, personaContext };
}

const strictSchemas = formatSchemas(true);
const lenientSchemas = formatSchemas(false);

type Path = (string | number)[];
type Item = { id?: unknown; activity?: unknown; release?: unknown; customer?: unknown; jobs?: unknown; personas?: unknown; dependsOn?: unknown; context?: unknown; steps?: unknown };

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

  for (const field of ["personas", "activities", "releases", "stories"] as const) {
    const ids = new Set<unknown>();
    items(map[field]).forEach((entry, index) => {
      if (typeof entry.id !== "string") return;
      if (ids.has(entry.id)) issue([field, index, "id"], `Duplicate ID '${entry.id}'.`);
      ids.add(entry.id);
    });
  }

  const activityIds = new Set(items(map.activities).map(activity => activity.id));
  const personaIds = new Set(items(map.personas).map(persona => persona.id));
  const jobIds = new Set<unknown>();
  items(map.personas).forEach((persona, personaIndex) => {
    const context = persona.context;
    if (context && typeof context === "object" && !Array.isArray(context)
      && !(["success", "usesToday", "constraints"] as const).some(field => (context as Record<string, unknown>)[field] !== undefined)) {
      issue(["personas", personaIndex, "context"], "Context needs at least one of success, usesToday and constraints.");
    }
    items(persona.jobs).forEach((job, jobIndex) => {
      items(job.steps).forEach((step, stepIndex) => {
        if (typeof step.activity === "string" && !activityIds.has(step.activity)) {
          issue(["personas", personaIndex, "jobs", jobIndex, "steps", stepIndex, "activity"], `Unknown activity '${step.activity}'.`);
        }
      });
      if (typeof job.id !== "string") return;
      if (jobIds.has(job.id)) issue(["personas", personaIndex, "jobs", jobIndex, "id"], `Duplicate job ID '${job.id}'. Job IDs are unique across the map.`);
      jobIds.add(job.id);
    });
  });

  const activities = new Map(items(map.activities).map(activity => [activity.id, activity]));
  const releases = new Map(items(map.releases).map(release => [release.id, release]));

  const storyIds = new Set(items(map.stories).map(story => story.id).filter(storyId => typeof storyId === "string"));

  items(map.stories).forEach((story, index) => {
    const activity = activities.get(story.activity);
    const release = releases.get(story.release);

    if (typeof story.activity === "string" && !activity) issue(["stories", index, "activity"], `Unknown activity '${story.activity}'.`);
    if (typeof story.release === "string" && !release) issue(["stories", index, "release"], `Unknown release '${story.release}'.`);
    for (const [field, known, kind] of [["jobs", jobIds, "job"], ["personas", personaIds, "persona"]] as const) {
      const listed = Array.isArray(story[field]) ? story[field] as unknown[] : [];
      listed.forEach((ref, refIndex) => {
        if (typeof ref !== "string") return;
        if (listed.indexOf(ref) !== refIndex) issue(["stories", index, field, refIndex], `${kind === "job" ? "Job" : "Persona"} '${ref}' is listed twice.`);
        else if (!known.has(ref)) issue(["stories", index, field, refIndex], `Unknown ${kind} '${ref}'.`);
      });
    }
    const dependsOn = Array.isArray(story.dependsOn) ? story.dependsOn as unknown[] : [];
    dependsOn.forEach((ref, refIndex) => {
      if (typeof ref !== "string") return;
      const path = ["stories", index, "dependsOn", refIndex];
      if (dependsOn.indexOf(ref) !== refIndex) issue(path, `Story '${ref}' is listed twice.`);
      else if (ref === story.id) issue(path, "A story cannot depend on itself.");
      else if (!storyIds.has(ref)) issue(path, `Unknown story '${ref}'.`);
    });
    if (story.customer && activity && !activity.customer) {
      issue(["stories", index, "activity"], "A customer-facing story requires customer-facing copy for its activity.");
    }
    if (story.customer && release && !release.customer) {
      issue(["stories", index, "release"], "A customer-facing story requires customer-facing copy for its release.");
    }
  });
  issues.push(...dependencyCycleIssues(items(map.stories)));
  return issues;
}

/**
 * Finds each dependency cycle once, such as A → B → A, and reports it on the
 * `dependsOn` entry that closes it. Self-dependencies, duplicates and unknown
 * IDs are reported elsewhere, so they are skipped here.
 */
function dependencyCycleIssues(stories: Item[]): { path: Path; message: string }[] {
  const index = new Map<string, number>();
  stories.forEach((story, storyIndex) => {
    if (typeof story.id === "string" && !index.has(story.id)) index.set(story.id, storyIndex);
  });
  const edges = (storyIndex: number) => {
    const story = stories[storyIndex];
    const listed = Array.isArray(story.dependsOn) ? story.dependsOn as unknown[] : [];
    return listed.flatMap((ref, refIndex) => typeof ref === "string" && ref !== story.id && index.has(ref) && listed.indexOf(ref) === refIndex
      ? [{ to: index.get(ref)!, refIndex }] : []);
  };
  const issues: { path: Path; message: string }[] = [];
  // 0: not visited, 1: on the current path, 2: done.
  const state = new Array<number>(stories.length).fill(0);
  for (let start = 0; start < stories.length; start++) {
    if (state[start] || typeof stories[start].id !== "string" || index.get(stories[start].id as string) !== start) continue;
    // Iterative depth-first search, so a long chain cannot overflow the stack.
    const path: number[] = [start];
    const next: number[] = [0];
    const children: { to: number; refIndex: number }[][] = [edges(start)];
    state[start] = 1;
    while (path.length) {
      const depth = path.length - 1;
      const edge = children[depth][next[depth]++];
      if (!edge) {
        state[path.pop()!] = 2;
        next.pop();
        children.pop();
        continue;
      }
      if (state[edge.to] === 1) {
        const loop = path.slice(path.indexOf(edge.to)).map(storyIndex => stories[storyIndex].id as string);
        issues.push({
          path: ["stories", path[depth], "dependsOn", edge.refIndex],
          message: `Dependency cycle: ${[...loop, loop[0]].join(" → ")}. Remove one of these dependencies.`,
        });
      } else if (state[edge.to] === 0) {
        state[edge.to] = 1;
        path.push(edge.to);
        next.push(0);
        children.push(edges(edge.to));
      }
    }
  }
  return issues;
}

export const storyMapSchema = strictSchemas.map.superRefine((map, context) => {
  for (const { path, message } of crossReferenceIssues(map)) {
    context.addIssue({ code: "custom", path, message });
  }
}).meta({
  title: "Auto Story Map",
  description: "A Git-backed user story map. Validate cross-references with `story-map validate`.",
});

export type StoryMapDocument = z.infer<typeof storyMapSchema>;
export type ReleaseImpact = z.infer<typeof strictSchemas.impactItem>;
export type StoryMapPersona = z.infer<typeof strictSchemas.persona>;
export type StoryMapJob = z.infer<typeof strictSchemas.job>;
export type StoryMapJobStep = z.infer<typeof strictSchemas.jobStep>;
export type StoryMapPersonaContext = z.infer<typeof strictSchemas.personaContext>;

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

/** Each mapping's entries by key, built once so that every lookup is one step per path segment. */
type KeyIndex = WeakMap<Node, Map<unknown, { offset?: number; value: unknown }>>;

function entry(node: Node, key: string | number, keyIndex: KeyIndex) {
  if (!isMap(node)) return undefined;
  let entries = keyIndex.get(node);
  if (!entries) {
    entries = new Map();
    for (const item of node.items) {
      const keyNode = item.key as (Node & { value?: unknown }) | null;
      const name = isScalar(keyNode) ? keyNode.value : keyNode;
      if (!entries.has(name)) entries.set(name, { offset: keyNode?.range?.[0], value: item.value });
    }
    keyIndex.set(node, entries);
  }
  return entries.get(key);
}

/** The nodes from the document root down `path`, stopping where the path leaves the document. */
function nodesAlong(document: Document, path: (string | number)[], keyIndex: KeyIndex) {
  const nodes = [document.contents as Node | null];
  for (const segment of path) {
    const node = nodes[nodes.length - 1];
    const next = isSeq(node) && typeof segment === "number" ? node.items[segment] : node ? entry(node, segment, keyIndex)?.value : undefined;
    if (!next) break;
    nodes.push(next as Node);
  }
  return nodes;
}

function locate(document: Document, lineCounter: LineCounter, keyIndex: KeyIndex, path: (string | number)[], key?: string) {
  const nodes = nodesAlong(document, path, keyIndex);
  for (let depth = nodes.length - 1; depth >= 0; depth--) {
    const node = nodes[depth];
    if (!node?.range) continue;
    let offset = node.range[0];
    if (key !== undefined && depth === path.length) offset = entry(node, key, keyIndex)?.offset ?? offset;
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
  const cutStories = new Set(map.stories.filter(story => story.status === "cut").map(story => story.id));
  const releasesWithEstimates = new Map<string, number>();
  for (const story of map.stories) {
    if (story.estimate !== undefined) releasesWithEstimates.set(story.release, (releasesWithEstimates.get(story.release) ?? 0) + 1);
  }
  map.stories.forEach((story, index) => {
    if ((story.status === "planned" || story.status === "in-progress") && story.estimate === undefined
      && (releasesWithEstimates.get(story.release) ?? 0) > 0) {
      warnings.push({
        severity: "warning",
        path: ["stories", index],
        message: "Add an estimate: other stories in this release have one, so the release total leaves this story out.",
        itemId: story.id,
      });
    }
    if (story.status !== "cut") {
      story.dependsOn?.forEach((ref, refIndex) => {
        if (!cutStories.has(ref)) return;
        warnings.push({
          severity: "warning",
          path: ["stories", index, "dependsOn", refIndex],
          message: `Depends on ${ref}, which is cut, so that work will not land. Remove the dependency, or cut or replan this story.`,
          itemId: story.id,
        });
      });
    }
    if ((story.status === "blocked" || story.status === "cut") && !story.statusReason) {
      warnings.push({
        severity: "warning",
        path: ["stories", index, "status"],
        message: `Add a statusReason explaining why the story is ${story.status}.`,
        itemId: story.id,
      });
    }
  });
  warnings.push(...personaWarnings(map));
  return warnings;
}

/**
 * Advice about personas and jobs: ones no story uses, stories that say nothing
 * about who they are for, and drafts that have shipped. A map with no personas,
 * or no active stories yet, gets none.
 */
function personaWarnings(map: StoryMapDocument): StoryMapIssue[] {
  const personas = map.personas ?? [];
  const active = map.stories.filter(story => isActiveStatus(story.status));
  if (!personas.length || !active.length) return [];
  const warnings: StoryMapIssue[] = [];
  const resolve = storyPersonaResolver(map);
  const used = new Set(map.stories.flatMap(story => resolve(story)));
  const served = new Set(active.flatMap(story => story.jobs ?? []));
  const shippedStories = map.stories.filter(story => story.status === "shipped");
  const shipped = new Set(shippedStories.flatMap(story => story.jobs ?? []));
  const shippedFor = new Set(shippedStories.flatMap(story => resolve(story)));
  const stepStories = jobStepCounter(map);
  const activityTitles = new Map(map.activities.map(activity => [activity.id, activity.title]));

  personas.forEach((persona, index) => {
    if (!used.has(persona.id)) {
      warnings.push({
        severity: "warning",
        path: ["personas", index],
        message: `No story is for ${persona.title}. Tag the stories that serve them, or remove the persona.`,
        itemId: persona.id,
      });
    }
    persona.jobs?.forEach((job, jobIndex) => {
      if (!served.has(job.id)) {
        warnings.push({
          severity: "warning",
          path: ["personas", index, "jobs", jobIndex],
          // The first job is the core job, so a gap there matters most.
          message: `${jobIndex === 0 ? "Core job" : "Job"} ${job.id} (${persona.title}) has no stories.`,
          itemId: persona.id,
        });
      }
      // A job with no stories at all is warned about above, so its steps add nothing.
      if (served.has(job.id)) {
        job.steps?.forEach((step, stepIndex) => {
          if (step.activity === undefined || stepStories(job.id, step.activity)) return;
          const activity = activityTitles.get(step.activity) ?? step.activity;
          warnings.push({
            severity: "warning",
            path: ["personas", index, "jobs", jobIndex, "steps", stepIndex],
            message: `Step “${step.title}” of job ${job.id} (${persona.title}) has no stories in ${activity}. Tag the stories there that serve the job, or point the step to another activity.`,
            itemId: persona.id,
          });
        });
      }
      if (job.draft && shipped.has(job.id)) {
        warnings.push({
          severity: "warning",
          path: ["personas", index, "jobs", jobIndex, "draft"],
          message: `Confirm the drafted job ${job.id} and remove draft: true. Stories that serve it have shipped.`,
          itemId: persona.id,
        });
      }
    });
    if (persona.context?.draft && shippedFor.has(persona.id)) {
      warnings.push({
        severity: "warning",
        path: ["personas", index, "context", "draft"],
        message: `Confirm the drafted context for ${persona.title} and remove draft: true. Stories for them have shipped.`,
        itemId: persona.id,
      });
    }
  });

  const untagged = active.filter(story => !resolve(story).length).length;
  if (untagged * 2 > active.length) {
    warnings.push({
      severity: "warning",
      path: ["personas"],
      message: `${untagged} of ${active.length} active stories do not say who they are for. Add the jobs each serves, or its personas.`,
    });
  }

  const byId = new Map(personas.map(persona => [persona.id, persona]));
  map.stories.forEach((story, index) => {
    if (!isActiveStatus(story.status)) return;
    story.personas?.forEach((id, personaIndex) => {
      const persona = byId.get(id);
      if (!persona?.jobs?.length || persona.jobs.some(job => story.jobs?.includes(job.id))) return;
      warnings.push({
        severity: "warning",
        path: ["stories", index, "personas", personaIndex],
        message: `For ${persona.title}, but serves none of their jobs, so it may not match a known need. Add the job it serves, or draft one.`,
        itemId: story.id,
      });
    });
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

/**
 * Brings data written in an earlier version of the format up to date. Both
 * parsers run it before validating. It changes nothing today: when a change
 * to the format renames a field or a status, map the old form to the new one
 * here, so past versions of the map still read correctly.
 */
export function migrateStoryMap(data: unknown): unknown {
  return data;
}

/**
 * Finds repeated scalar keys in each mapping, as the YAML library's own
 * `uniqueKeys` check does, but with one lookup per key. The library compares
 * every key with every earlier one, which takes seconds on a large map.
 */
function duplicateKeyOffsets(document: Document) {
  const offsets: number[] = [];
  visit(document, {
    Map(_, map) {
      const seen = new Set<unknown>();
      for (const { key } of map.items) {
        if (!isScalar(key) || Number.isNaN(key.value)) continue;
        if (seen.has(key.value)) offsets.push(key.range?.[0] ?? 0);
        else seen.add(key.value);
      }
    },
  });
  return offsets;
}

/** Reads the YAML with the same safety settings for every parser: unique keys and a limit on aliases. */
function readYaml(source: string) {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { uniqueKeys: false, lineCounter });
  const problems: StoryMapIssue[] = document.errors.map(error => {
    const position = error.linePos?.[0];
    return {
      severity: "error" as const,
      path: [],
      message: error.message.replace(/ at line \d+, column \d+:[\s\S]*$/, "").trim(),
      line: position?.line,
      column: position?.col,
    };
  });
  for (const offset of duplicateKeyOffsets(document)) {
    const { line, col } = lineCounter.linePos(offset);
    problems.push({ severity: "error", path: [], message: "Map keys must be unique", line, column: col });
  }
  if (problems.length) {
    problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
    throw new StoryMapValidationError(problems);
  }
  return { document, lineCounter, data: migrateStoryMap(document.toJS({ maxAliasCount: 20 })) };
}

const errorMessages: z.core.$ZodErrorMap = issue => {
  if (issue.code === "invalid_type" && issue.input === undefined) return "Missing required field.";
  if (issue.code === "invalid_value" && issue.values.length > 1) {
    return `Use one of ${issue.values.map(value => `'${String(value)}'`).join(", ")}.`;
  }
  return undefined;
};

/** Like `parseStoryMap`, but keeps source positions for reporting problems found later. */
export function loadStoryMap(source: string): LoadedStoryMap {
  const { document, lineCounter, data } = readYaml(source);
  const result = storyMapSchema.safeParse(data, { error: errorMessages });
  if (result.success) {
    const keyIndex: KeyIndex = new WeakMap();
    const find = (path: (string | number)[]) => locate(document, lineCounter, keyIndex, path);
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
  const keyIndex: KeyIndex = new WeakMap();
  for (const issue of [...result.error.issues, ...extra]) {
    const path = issue.path.map(segment => typeof segment === "number" ? segment : String(segment));
    const itemId = itemIdAt(data, path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        issues.push({ severity: "error", path: [...path, key], message: "Unknown field.", itemId, ...locate(document, lineCounter, keyIndex, path, key) });
      }
      continue;
    }
    issues.push({ severity: "error", path, message: issue.message, itemId, ...locate(document, lineCounter, keyIndex, path) });
  }
  issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  throw new StoryMapValidationError(issues);
}

export interface HistoricalStoryMap {
  map: StoryMapDocument;
  /** What was left out to read this version with today's format. */
  dropped: {
    /** Stories that still did not validate, such as one with a status that no longer exists. */
    stories: number;
    /** IDs of the dropped stories, where they had one. */
    storyIds: string[];
    /** Fields the format no longer has. */
    fields: number;
  };
}

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Counts the keys in `input` that the parse left out of `output`. */
function droppedFields(input: unknown, output: unknown): number {
  if (Array.isArray(input) && Array.isArray(output)) {
    return input.reduce<number>((total, item, index) => total + droppedFields(item, output[index]), 0);
  }
  if (!plain(input) || !plain(output)) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    total += Object.hasOwn(output, key) ? droppedFields(value, output[key]) : 1;
  }
  return total;
}

const lenientMap = lenientSchemas.map.extend({ stories: z.array(z.unknown()).max(1000) });

/**
 * Reads a past version of the map, which may use an earlier format. Unlike
 * `loadStoryMap`, it drops fields the format no longer has, drops stories that
 * still do not validate instead of failing the whole map, and skips the
 * cross-reference checks. It still fails on YAML errors and on a map whose
 * other parts do not validate. History and `story-map diff` use it for
 * earlier versions only: the current map is always checked strictly.
 */
export function loadHistoricalStoryMap(source: string): HistoricalStoryMap {
  const { data } = readYaml(source);
  const result = lenientMap.safeParse(data, { error: errorMessages });
  if (!result.success) {
    throw new StoryMapValidationError(result.error.issues.map(issue => ({
      severity: "error" as const,
      path: issue.path.map(segment => typeof segment === "number" ? segment : String(segment)),
      message: issue.message,
    })));
  }

  const { stories: rawStories, ...rest } = result.data;
  let fields = droppedFields({ ...(data as Record<string, unknown>), stories: undefined }, rest);
  const stories: StoryMapDocument["stories"] = [];
  const storyIds: string[] = [];
  for (const raw of rawStories) {
    const story = lenientSchemas.story.safeParse(raw);
    if (story.success) {
      stories.push(story.data);
      fields += droppedFields(raw, story.data);
    } else if (plain(raw) && typeof raw.id === "string") {
      storyIds.push(raw.id);
    }
  }
  return {
    map: { ...rest, stories },
    dropped: { stories: rawStories.length - stories.length, storyIds, fields },
  };
}
