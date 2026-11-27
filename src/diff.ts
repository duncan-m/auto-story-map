import { jobStatement, personaCoreJob, storyMapJobs } from "./personas.js";
import { defaultStalledAfterWeeks, type StoryMapDocument, type StoryMapJob, type StoryMapPersona } from "./schema.js";
import { customerStatus, isActiveStatus, storyStatusLabels, type StoryStatus } from "./status.js";

type Story = StoryMapDocument["stories"][number];
type Group = StoryMapDocument["activities"][number];
type Release = StoryMapDocument["releases"][number];
type ImpactItem = NonNullable<Release["impact"]>[number];
type Change<T> = { from: T; to: T };

export interface StoryDiffRef {
  id: string;
  title: string;
}

export interface StoryAddition extends StoryDiffRef {
  activity: string;
  release: string;
  status: StoryStatus;
}

export interface StoryUpdate extends StoryDiffRef {
  title: string;
  titleChange?: Change<string>;
  status?: Change<StoryStatus>;
  /** Activity titles before and after a move. */
  activity?: Change<string>;
  /** Release titles before and after a move. */
  release?: Change<string>;
  /** Job IDs before and after, in the story's order. */
  jobs?: Change<string[]>;
  /** The persona IDs the story lists itself, before and after. Personas that come from its jobs are not repeated here. */
  personas?: Change<string[]>;
  /** IDs of the stories it depends on, before and after, in the story's order. */
  dependsOn?: Change<string[]>;
  /** Story points before and after. Absent on one side when the story had no estimate. */
  estimate?: { from?: number; to?: number };
  /** MoSCoW priority before and after. Absent on one side when the story had none. */
  priority?: { from?: string; to?: string };
  /** Tokens used to deliver the story, before and after. Absent on one side when none were recorded. */
  tokens?: { from?: number; to?: number };
  /** Estimated cost in US dollars, before and after. */
  estimatedCostUsd?: { from?: number; to?: number };
  /** Other fields that changed, such as `summary`, `notes` or `sources`. */
  details: string[];
}

/** A story that became blocked or cut, or stopped being blocked or cut. */
export interface InactiveStoryChange extends StoryDiffRef {
  change: "entered" | "left";
  /** Absent when the story was added in this change. */
  from?: StoryStatus;
  to: StoryStatus;
  /** The story’s `statusReason` after the change. */
  reason?: string;
}

export interface CustomerStoryChange {
  id: string;
  /** Customer-facing title. */
  title: string;
  change: "now-visible" | "no-longer-visible" | "updated";
  /** For `updated`: what customers will see change. */
  details: string[];
}

export interface GroupChanges {
  added: StoryDiffRef[];
  removed: StoryDiffRef[];
  renamed: (StoryDiffRef & { from: string })[];
  reordered: boolean;
  /** Groups whose customer-facing label was added, changed or removed. */
  customerLabelChanged: StoryDiffRef[];
}

/** A job to be done, named by its ID, its persona's title and its statement. */
export interface JobDiffRef {
  id: string;
  /** Title of the persona that owns the job. */
  persona: string;
  /** “When …, I want …, so that ….” */
  statement: string;
}

export interface JobChanges {
  added: JobDiffRef[];
  removed: JobDiffRef[];
  /** Jobs whose statement changed, or that were marked as drafts again. */
  reworded: JobDiffRef[];
  /** Jobs that moved to another persona. `from` is the earlier persona's title. */
  moved: (JobDiffRef & { from: string })[];
  /** Drafts a person confirmed by removing `draft: true`. */
  confirmed: JobDiffRef[];
  /** Personas on both maps whose core job, the first in their list, is now a different job. */
  coreChanged: CoreJobChange[];
  /**
   * Jobs whose steps were added, removed, reordered, reworded or pointed to another activity,
   * including new jobs that have steps. Removed jobs are reported under `removed` only.
   */
  stepsChanged: JobStepsChange[];
}

/** A job whose workflow steps changed, with its steps on the new map. */
export interface JobStepsChange extends JobDiffRef {
  /** The job's steps on the new map, in order. Empty when they were all removed. */
  steps: { title: string; activity?: string }[];
}

/** A persona whose core job changed, because its jobs were reordered, or the core job was removed, moved or added in front. */
export interface CoreJobChange {
  /** The persona's ID. */
  id: string;
  /** The persona's title on the new map. */
  persona: string;
  /** IDs of the earlier and the new core job. */
  from: string;
  to: string;
}

/** Personas whose context was added, changed, removed or confirmed, named by ID and title. */
export interface PersonaContextChanges {
  added: StoryDiffRef[];
  /** Context whose success, usesToday or constraints changed, or that was marked as a draft again. */
  changed: StoryDiffRef[];
  removed: StoryDiffRef[];
  /** Drafts a person confirmed by removing `draft: true`. */
  confirmed: StoryDiffRef[];
}

/** Changes to a release’s notes or expected impact. Impact items are matched by `metric`. */
export interface ReleaseDetailChange extends StoryDiffRef {
  notes?: "added" | "changed" | "removed";
  impact: {
    /** Metrics of new impact items. */
    added: string[];
    /** Metrics whose `expected` or `solves` changed, or that were marked as drafts again. */
    changed: string[];
    removed: string[];
    /** Drafts a person confirmed by removing `draft: true`. */
    confirmed: string[];
    /** Measured results that were recorded or changed. */
    actualRecorded: { metric: string; actual: string }[];
  };
}

export interface StoryMapDiff {
  /** True when the earlier map did not exist. */
  created: boolean;
  visibility?: Change<StoryMapDocument["visibility"]>;
  titleChange?: Change<string>;
  /** True when the customer-facing map title or summary changed. */
  customerCopyChanged: boolean;
  /** Changes that signed-in customers will see. Empty unless a version of the map is visible to all users. */
  customer: CustomerStoryChange[];
  /** Stories that became blocked or cut, or returned from those statuses. */
  blockedOrCut: InactiveStoryChange[];
  stories: { added: StoryAddition[]; removed: StoryDiffRef[]; updated: StoryUpdate[] };
  activities: GroupChanges;
  releases: GroupChanges;
  /** Personas added, removed, renamed or reordered. Reordering changes their colours on the board. */
  personas: GroupChanges;
  jobs: JobChanges;
  /** Persona context changes, for personas on both maps or added with context. Removed personas are reported under `personas`. */
  personaContexts: PersonaContextChanges;
  /** Releases whose notes or expected impact changed, including new releases that have them. */
  releaseDetails: ReleaseDetailChange[];
  /** The stalled threshold in weeks, including the default of 4 when the map does not set it. 0 is off. */
  stalledAfterWeeks?: Change<number>;
  /** Whether the product keeps delivery plans: a folder, false for no plans, or undefined when nobody has chosen. */
  plans?: Change<string | false | undefined>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function customerVisible(map: StoryMapDocument | null, story: Story | undefined) {
  return !!(map && story?.customer && isActiveStatus(story.status) && map.visibility === "all-users" && map.customer);
}

function groupChanges(before: readonly Omit<Group, "summary">[], after: readonly Omit<Group, "summary">[]): GroupChanges {
  const old = new Map(before.map(group => [group.id, group]));
  const current = new Map(after.map(group => [group.id, group]));
  const kept = after.filter(group => old.has(group.id)).map(group => group.id);
  const keptBefore = before.filter(group => current.has(group.id)).map(group => group.id);
  return {
    added: after.filter(group => !old.has(group.id)).map(({ id, title }) => ({ id, title })),
    removed: before.filter(group => !current.has(group.id)).map(({ id, title }) => ({ id, title })),
    renamed: after.flatMap(({ id, title }) => {
      const previous = old.get(id);
      return previous && previous.title !== title ? [{ id, title, from: previous.title }] : [];
    }),
    reordered: !same(kept, keptBefore),
    customerLabelChanged: after.flatMap(({ id, title, customer }) =>
      old.has(id) && !same(old.get(id)!.customer, customer) ? [{ id, title }] : []),
  };
}

function jobChanges(before: StoryMapDocument, after: StoryMapDocument): JobChanges {
  const old = storyMapJobs(before);
  const current = storyMapJobs(after);
  const ref = ({ job, persona }: { job: Parameters<typeof jobStatement>[0] & { id: string }; persona: { title: string } }): JobDiffRef =>
    ({ id: job.id, persona: persona.title, statement: jobStatement(job) });
  const changes: JobChanges = { added: [], removed: [], reworded: [], moved: [], confirmed: [], coreChanged: [], stepsChanged: [] };
  const steps = (job: StoryMapJob) => (job.steps ?? []).map(({ title, summary, activity }) => ({ title, summary, activity }));
  for (const [id, owner] of current) {
    const previous = old.get(id);
    if (!same(previous ? steps(previous.job) : [], steps(owner.job))) {
      changes.stepsChanged.push({ ...ref(owner), steps: steps(owner.job).map(({ title, activity }) => activity === undefined ? { title } : { title, activity }) });
    }
    if (!previous) {
      changes.added.push(ref(owner));
      continue;
    }
    if (previous.persona.id !== owner.persona.id) changes.moved.push({ ...ref(owner), from: previous.persona.title });
    if (jobStatement(previous.job) !== jobStatement(owner.job) || (!previous.job.draft && owner.job.draft)) changes.reworded.push(ref(owner));
    if (previous.job.draft && !owner.job.draft) changes.confirmed.push(ref(owner));
  }
  for (const [id, owner] of old) {
    if (!current.has(id)) changes.removed.push(ref(owner));
  }
  const oldCore = new Map((before.personas ?? []).map(persona => [persona.id, personaCoreJob(persona)?.id]));
  for (const persona of after.personas ?? []) {
    const from = oldCore.get(persona.id);
    const to = personaCoreJob(persona)?.id;
    if (from && to && from !== to) changes.coreChanged.push({ id: persona.id, persona: persona.title, from, to });
  }
  return changes;
}

function personaContextChanges(before: readonly StoryMapPersona[], after: readonly StoryMapPersona[]): PersonaContextChanges {
  const old = new Map(before.map(persona => [persona.id, persona]));
  const changes: PersonaContextChanges = { added: [], changed: [], removed: [], confirmed: [] };
  const content = ({ success, usesToday, constraints }: NonNullable<StoryMapPersona["context"]>) => ({ success, usesToday, constraints });
  for (const persona of after) {
    const ref = { id: persona.id, title: persona.title };
    const previous = old.get(persona.id)?.context;
    const context = persona.context;
    if (!previous && context) changes.added.push(ref);
    else if (previous && !context) {
      if (old.has(persona.id)) changes.removed.push(ref);
    } else if (previous && context) {
      if (!same(content(previous), content(context)) || (!previous.draft && context.draft)) changes.changed.push(ref);
      if (previous.draft && !context.draft) changes.confirmed.push(ref);
    }
  }
  return changes;
}

function releaseDetailChange(previous: Release | undefined, release: Release): ReleaseDetailChange | undefined {
  const notes = previous?.notes === release.notes ? undefined
    : !previous?.notes ? "added" : !release.notes ? "removed" : "changed";
  const old = new Map((previous?.impact ?? []).map(item => [item.metric, item]));
  const current = new Map((release.impact ?? []).map(item => [item.metric, item]));
  const impact: ReleaseDetailChange["impact"] = { added: [], changed: [], removed: [], confirmed: [], actualRecorded: [] };
  for (const item of current.values()) {
    const before: ImpactItem | undefined = old.get(item.metric);
    if (!before) {
      impact.added.push(item.metric);
      if (item.actual) impact.actualRecorded.push({ metric: item.metric, actual: item.actual });
      continue;
    }
    if (before.expected !== item.expected || before.solves !== item.solves || (!before.draft && item.draft)) impact.changed.push(item.metric);
    if (before.draft && !item.draft) impact.confirmed.push(item.metric);
    if (item.actual && before.actual !== item.actual) impact.actualRecorded.push({ metric: item.metric, actual: item.actual });
  }
  impact.removed = [...old.keys()].filter(metric => !current.has(metric));
  const changed = notes || Object.values(impact).some(list => list.length);
  return changed ? { id: release.id, title: release.title, ...(notes ? { notes } : {}), impact } : undefined;
}

/** Compares two versions of a map. Pass `null` for `before` when the map is new. */
export function diffStoryMaps(before: StoryMapDocument | null, after: StoryMapDocument): StoryMapDiff {
  const empty: StoryMapDocument = { ...after, visibility: "internal", customer: undefined, activities: [], releases: [], stories: [] };
  const base = before ?? empty;
  const titles = (map: StoryMapDocument, field: "activities" | "releases") =>
    new Map(map[field].map(group => [group.id, group.title]));
  const activityTitles = [titles(base, "activities"), titles(after, "activities")];
  const releaseTitles = [titles(base, "releases"), titles(after, "releases")];

  const oldStories = new Map(base.stories.map(story => [story.id, story]));
  const newStories = new Map(after.stories.map(story => [story.id, story]));

  const added: StoryAddition[] = [];
  const updated: StoryUpdate[] = [];
  const blockedOrCut: InactiveStoryChange[] = [];
  for (const story of after.stories) {
    const previous = oldStories.get(story.id);
    if (!isActiveStatus(story.status) && previous?.status !== story.status) {
      blockedOrCut.push({ id: story.id, title: story.title, change: "entered", from: previous?.status, to: story.status, reason: story.statusReason });
    } else if (previous && !isActiveStatus(previous.status) && isActiveStatus(story.status)) {
      blockedOrCut.push({ id: story.id, title: story.title, change: "left", from: previous.status, to: story.status, reason: story.statusReason });
    }
    if (!previous) {
      added.push({
        id: story.id,
        title: story.title,
        activity: activityTitles[1].get(story.activity) ?? story.activity,
        release: releaseTitles[1].get(story.release) ?? story.release,
        status: story.status,
      });
      continue;
    }
    const update: StoryUpdate = { id: story.id, title: story.title, details: [] };
    if (previous.title !== story.title) update.titleChange = { from: previous.title, to: story.title };
    if (previous.status !== story.status) update.status = { from: previous.status, to: story.status };
    if (previous.activity !== story.activity) {
      update.activity = {
        from: activityTitles[0].get(previous.activity) ?? previous.activity,
        to: activityTitles[1].get(story.activity) ?? story.activity,
      };
    }
    if (previous.release !== story.release) {
      update.release = {
        from: releaseTitles[0].get(previous.release) ?? previous.release,
        to: releaseTitles[1].get(story.release) ?? story.release,
      };
    }
    if (previous.estimate !== story.estimate) {
      update.estimate = {
        ...(previous.estimate !== undefined ? { from: previous.estimate } : {}),
        ...(story.estimate !== undefined ? { to: story.estimate } : {}),
      };
    }
    if (previous.priority !== story.priority) {
      update.priority = {
        ...(previous.priority !== undefined ? { from: previous.priority } : {}),
        ...(story.priority !== undefined ? { to: story.priority } : {}),
      };
    }
    if (previous.tokens !== story.tokens) {
      update.tokens = {
        ...(previous.tokens !== undefined ? { from: previous.tokens } : {}),
        ...(story.tokens !== undefined ? { to: story.tokens } : {}),
      };
    }
    if (previous.estimatedCostUsd !== story.estimatedCostUsd) {
      update.estimatedCostUsd = {
        ...(previous.estimatedCostUsd !== undefined ? { from: previous.estimatedCostUsd } : {}),
        ...(story.estimatedCostUsd !== undefined ? { to: story.estimatedCostUsd } : {}),
      };
    }
    for (const field of ["dependsOn", "jobs", "personas"] as const) {
      if (!same(previous[field] ?? [], story[field] ?? [])) update[field] = { from: previous[field] ?? [], to: story[field] ?? [] };
    }
    for (const field of ["summary", "statusReason", "notes", "sources", "customer", "updatedBy"] as const) {
      if (!same(previous[field], story[field])) update.details.push(field);
    }
    if (update.titleChange || update.status || update.activity || update.release || update.estimate || update.priority || update.tokens || update.estimatedCostUsd || update.dependsOn || update.jobs || update.personas || update.details.length) {
      updated.push(update);
    }
  }
  const removed = base.stories.filter(story => !newStories.has(story.id)).map(({ id, title }) => ({ id, title }));

  const customer: CustomerStoryChange[] = [];
  const customerLabel = (map: StoryMapDocument, field: "activities" | "releases", id: string) =>
    map[field].find(group => group.id === id)?.customer?.title;
  for (const id of new Set([...oldStories.keys(), ...newStories.keys()])) {
    const previous = oldStories.get(id);
    const story = newStories.get(id);
    const wasVisible = customerVisible(before, previous);
    const isVisible = customerVisible(after, story);
    if (isVisible && !wasVisible) {
      customer.push({ id, title: story!.customer!.title, change: "now-visible", details: [] });
    } else if (wasVisible && !isVisible) {
      customer.push({ id, title: previous!.customer!.title, change: "no-longer-visible", details: [] });
    } else if (wasVisible && isVisible) {
      const details: string[] = [];
      if (previous!.customer!.title !== story!.customer!.title) details.push(`title was “${previous!.customer!.title}”`);
      if (!same(previous!.customer!.summary, story!.customer!.summary)) details.push("summary changed");
      // Compare what customers see, so in progress → merged is not a customer-facing change.
      const statusBefore = customerStatus(previous!.status);
      const statusAfter = customerStatus(story!.status);
      if (statusBefore !== statusAfter) {
        details.push(`status ${storyStatusLabels[statusBefore]} → ${storyStatusLabels[statusAfter]}`);
      }
      const activityBefore = customerLabel(before!, "activities", previous!.activity);
      const activityAfter = customerLabel(after, "activities", story!.activity);
      if (activityBefore !== activityAfter) details.push(`activity ${activityBefore} → ${activityAfter}`);
      const releaseBefore = customerLabel(before!, "releases", previous!.release);
      const releaseAfter = customerLabel(after, "releases", story!.release);
      if (releaseBefore !== releaseAfter) details.push(`release ${releaseBefore} → ${releaseAfter}`);
      if (details.length) customer.push({ id, title: story!.customer!.title, change: "updated", details });
    }
  }

  const order = { "now-visible": 0, updated: 1, "no-longer-visible": 2 };
  customer.sort((a, b) => order[a.change] - order[b.change]);
  const stalledBefore = before?.settings?.stalledAfterWeeks ?? defaultStalledAfterWeeks;
  const stalledAfter = after.settings?.stalledAfterWeeks ?? defaultStalledAfterWeeks;

  return {
    created: before === null,
    visibility: before && before.visibility !== after.visibility ? { from: before.visibility, to: after.visibility } : undefined,
    titleChange: before && before.title !== after.title ? { from: before.title, to: after.title } : undefined,
    customerCopyChanged: !!before && !same(before.customer, after.customer),
    customer,
    blockedOrCut,
    stories: { added, removed, updated },
    activities: groupChanges(base.activities, after.activities),
    releases: groupChanges(base.releases, after.releases),
    personas: groupChanges(base.personas ?? [], after.personas ?? []),
    jobs: jobChanges(base, after),
    personaContexts: personaContextChanges(base.personas ?? [], after.personas ?? []),
    releaseDetails: after.releases.flatMap(release => {
      const change = releaseDetailChange(base.releases.find(previous => previous.id === release.id), release);
      return change ? [change] : [];
    }),
    stalledAfterWeeks: before && stalledBefore !== stalledAfter ? { from: stalledBefore, to: stalledAfter } : undefined,
    plans: before && before.settings?.plans !== after.settings?.plans ? { from: before.settings?.plans, to: after.settings?.plans } : undefined,
  };
}

export function hasStoryMapChanges(diff: StoryMapDiff) {
  const groups = (changes: GroupChanges) =>
    changes.added.length || changes.removed.length || changes.renamed.length || changes.reordered || changes.customerLabelChanged.length;
  return !!(diff.created || diff.visibility || diff.titleChange || diff.customerCopyChanged || diff.customer.length || diff.blockedOrCut.length
    || diff.stories.added.length || diff.stories.removed.length || diff.stories.updated.length
    || groups(diff.activities) || groups(diff.releases) || groups(diff.personas) || Object.values(diff.jobs).some(list => list.length)
    || Object.values(diff.personaContexts).some(list => list.length)
    || diff.releaseDetails.length || diff.stalledAfterWeeks || diff.plans);
}

/**
 * Escapes text from the map so it renders literally in GitHub Markdown,
 * including inside table cells. An empty `<span></span>` follows each `@`
 * and `#`, so a pasted summary does not mention people or teams, or link
 * issues. Checked on a real PR: GitHub decodes character references such as
 * `&#64;` before it finds mentions, and drops an empty HTML comment inside a
 * table cell, so neither works there. The span renders as nothing.
 */
function text(value: string) {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]|~]/g, character => `\\${character}`)
    .replace(/[@#]/g, character => `${character}<span></span>`)
    .replace(/\s+/g, " ");
}

/**
 * Renders a value as inline code that GitHub shows literally, even a story ID
 * that failed validation. The fence is one backtick longer than any run of
 * backticks in the value, and line breaks become spaces, so the value cannot
 * end the span, and URLs or mentions inside it stay plain text.
 */
export function code(value: string) {
  const flat = value.replace(/\s+/g, " ");
  if (!flat.trim()) return text(value);
  const longestRun = (flat.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const pad = /^[ `]|[ `]$/.test(flat) ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

function story(ref: StoryDiffRef) {
  return `\`${ref.id}\` ${text(ref.title)}`;
}

/** Renders a diff as Markdown for a pull request comment or job summary. */
export function formatStoryMapDiff(diff: StoryMapDiff): string {
  if (!hasStoryMapChanges(diff)) return "## Story map changes\n\nNo story map changes.\n";
  const lines: string[] = ["## Story map changes", ""];
  const status = (value: StoryStatus) => storyStatusLabels[value];

  if (diff.created) lines.push("The story map is new in this change.", "");
  if (diff.visibility) {
    lines.push(diff.visibility.to === "all-users"
      ? "> [!IMPORTANT]\n> The map is now visible to all signed-in users. Check the customer-facing copy before merging."
      : "> [!NOTE]\n> The map is now internal only. Signed-in customers will no longer see it.", "");
  }

  if (diff.customer.length || diff.customerCopyChanged) {
    lines.push("### Customer-facing changes", "", "Signed-in customers will see these changes once this is deployed.", "");
    if (diff.customerCopyChanged) lines.push("- The customer-facing map title or summary changed.");
    for (const change of diff.customer) {
      const label = `\`${change.id}\` “${text(change.title)}”`;
      if (change.change === "now-visible") lines.push(`- **Now visible:** ${label}`);
      else if (change.change === "no-longer-visible") lines.push(`- **No longer visible:** ${label}`);
      else lines.push(`- **Updated:** ${label}: ${change.details.map(text).join("; ")}`);
    }
    lines.push("");
  }

  if (diff.blockedOrCut.length) {
    lines.push("### Blocked and cut", "");
    for (const change of diff.blockedOrCut) {
      const reason = change.reason ? ` Reason: ${text(change.reason)}` : "";
      if (change.change === "entered") {
        const was = change.from ? `was ${status(change.from)}` : "added";
        lines.push(`- **${status(change.to)}:** ${story(change)} (${was}).${reason}`);
      } else {
        lines.push(`- **No longer ${status(change.from!).toLowerCase()}:** ${story(change)}, now ${status(change.to)}.`);
      }
    }
    lines.push("");
  }

  const rows: [string, string][] = [];
  for (const added of diff.stories.added) {
    rows.push([story(added), `Added to ${text(added.activity)} / ${text(added.release)} as ${status(added.status)}`]);
  }
  for (const update of diff.stories.updated) {
    const changes: string[] = [];
    if (update.status) changes.push(`Status: ${status(update.status.from)} → **${status(update.status.to)}**`);
    if (update.activity) changes.push(`Activity: ${text(update.activity.from)} → ${text(update.activity.to)}`);
    if (update.release) changes.push(`Release: ${text(update.release.from)} → ${text(update.release.to)}`);
    if (update.titleChange) changes.push(`Renamed from “${text(update.titleChange.from)}”`);
    if (update.estimate) changes.push(`Estimate: ${update.estimate.from ?? "none"} → ${update.estimate.to ?? "none"}`);
    if (update.priority) changes.push(`Priority: ${update.priority.from ?? "none"} → ${update.priority.to ?? "none"}`);
    if (update.tokens) changes.push(`Tokens used: ${formatTokens(update.tokens.from)} → ${formatTokens(update.tokens.to)}`);
    if (update.estimatedCostUsd) changes.push(`Estimated cost: ${formatUsd(update.estimatedCostUsd.from)} → ${formatUsd(update.estimatedCostUsd.to)}`);
    const ids = (list: string[]) => list.map(code).join(", ") || "none";
    if (update.dependsOn) changes.push(`Depends on: ${ids(update.dependsOn.from)} → ${ids(update.dependsOn.to)}`);
    if (update.jobs) changes.push(`Jobs: ${ids(update.jobs.from)} → ${ids(update.jobs.to)}`);
    if (update.personas) changes.push(`Personas: ${ids(update.personas.from)} → ${ids(update.personas.to)}`);
    if (update.details.length) changes.push(`Edited ${update.details.map(field => `\`${field}\``).join(", ")}`);
    rows.push([story(update), changes.join("<br>")]);
  }
  for (const removed of diff.stories.removed) rows.push([story(removed), "Removed"]);
  if (rows.length) {
    lines.push("### Stories", "", "| Story | Change |", "| --- | --- |", ...rows.map(([name, change]) => `| ${name} | ${change} |`), "");
  }

  if (diff.releaseDetails.length) {
    lines.push("### Release notes and impact", "");
    for (const change of diff.releaseDetails) {
      const parts: string[] = [];
      if (change.notes) parts.push(`notes ${change.notes}`);
      const metrics = (list: string[]) => list.map(metric => `“${text(metric)}”`).join(", ");
      if (change.impact.added.length) parts.push(`added impact ${metrics(change.impact.added)}`);
      if (change.impact.changed.length) parts.push(`changed impact ${metrics(change.impact.changed)}`);
      if (change.impact.confirmed.length) parts.push(`confirmed drafted impact ${metrics(change.impact.confirmed)}`);
      if (change.impact.removed.length) parts.push(`removed impact ${metrics(change.impact.removed)}`);
      lines.push(`- ${story(change)}: ${parts.join("; ") || "recorded measured results"}`);
      for (const { metric, actual } of change.impact.actualRecorded) {
        lines.push(`  - **Actual recorded** for “${text(metric)}”: ${text(actual)}`);
      }
    }
    lines.push("");
  }

  const groupLines = (label: string, changes: GroupChanges) => [
    ...changes.added.map(group => `- Added ${label} ${story(group)}`),
    ...changes.renamed.map(group => `- Renamed ${label} \`${group.id}\` from “${text(group.from)}” to “${text(group.title)}”`),
    ...changes.removed.map(group => `- Removed ${label} ${story(group)}`),
    ...changes.customerLabelChanged.map(group => `- Changed the customer-facing label of ${label} ${story(group)}`),
    ...(changes.reordered ? [`- Reordered the ${label === "activity" ? "activities" : `${label}s`}`] : []),
  ];
  const structure = [...groupLines("activity", diff.activities), ...groupLines("release", diff.releases)];
  if (diff.titleChange) structure.unshift(`- Renamed the map from “${text(diff.titleChange.from)}” to “${text(diff.titleChange.to)}”`);
  if (structure.length) lines.push("### Activities and releases", "", ...structure, "");

  const job = (ref: JobDiffRef) => `${code(ref.id)} (${text(ref.persona)})`;
  const personas = [
    ...groupLines("persona", diff.personas),
    ...diff.jobs.added.map(ref => `- Added job ${job(ref)}: ${text(ref.statement)}`),
    ...diff.jobs.reworded.map(ref => `- Reworded job ${job(ref)}: ${text(ref.statement)}`),
    ...diff.jobs.moved.map(ref => `- Moved job ${code(ref.id)} from ${text(ref.from)} to ${text(ref.persona)}`),
    ...diff.jobs.confirmed.map(ref => `- Confirmed drafted job ${job(ref)}`),
    ...diff.jobs.removed.map(ref => `- Removed job ${job(ref)}`),
    ...diff.jobs.coreChanged.map(change => `- ${text(change.persona)}'s core job: ${code(change.from)} → ${code(change.to)}`),
    ...diff.jobs.stepsChanged.map(change => change.steps.length
      ? `- Steps of job ${job(change)}: ${change.steps.map(step => step.activity === undefined ? text(step.title) : `${text(step.title)} (${code(step.activity)})`).join(" → ")}`
      : `- Removed the steps of job ${job(change)}`),
    ...diff.personaContexts.added.map(persona => `- Added context for persona ${story(persona)}`),
    ...diff.personaContexts.changed.map(persona => `- Changed the context of persona ${story(persona)}`),
    ...diff.personaContexts.confirmed.map(persona => `- Confirmed the drafted context of persona ${story(persona)}`),
    ...diff.personaContexts.removed.map(persona => `- Removed the context of persona ${story(persona)}`),
  ];
  if (personas.length) lines.push("### Personas and jobs", "", ...personas, "");

  const settings: string[] = [];
  if (diff.stalledAfterWeeks) {
    const { from, to } = diff.stalledAfterWeeks;
    const weeks = (count: number) => `${count} ${count === 1 ? "week" : "weeks"}`;
    settings.push(to === 0
      ? `- Turned off the stalled flag (was ${weeks(from)}).`
      : `- Stories are flagged as stalled after ${weeks(to)} in progress (was ${from === 0 ? "off" : weeks(from)}).`);
  }
  if (diff.plans) {
    const plans = (value: string | false | undefined) => value === undefined ? "not chosen" : value === false ? "not used" : `kept in ${code(value)}`;
    settings.push(`- Delivery plans: ${plans(diff.plans.to)} (was ${plans(diff.plans.from)}).`);
  }
  if (settings.length) lines.push("### Settings", "", ...settings, "");

  return lines.join("\n");
}

/** “1,843,920”, or “none” when no count was recorded. */
const formatTokens = (tokens: number | undefined) => (tokens === undefined ? "none" : tokens.toLocaleString("en-US"));

/** “$14.27”, or “none”. */
const formatUsd = (usd: number | undefined) => (usd === undefined ? "none" : `$${usd.toFixed(2)}`);
