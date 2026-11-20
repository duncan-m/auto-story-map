import { defaultStalledAfterWeeks, type StoryMapDocument } from "./schema.js";
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
  /** Releases whose notes or expected impact changed, including new releases that have them. */
  releaseDetails: ReleaseDetailChange[];
  /** The stalled threshold in weeks, including the default of 4 when the map does not set it. 0 is off. */
  stalledAfterWeeks?: Change<number>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function customerVisible(map: StoryMapDocument | null, story: Story | undefined) {
  return !!(map && story?.customer && isActiveStatus(story.status) && map.visibility === "all-users" && map.customer);
}

function groupChanges(before: Group[], after: Group[]): GroupChanges {
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
    for (const field of ["summary", "statusReason", "notes", "sources", "customer", "updatedBy"] as const) {
      if (!same(previous[field], story[field])) update.details.push(field);
    }
    if (update.titleChange || update.status || update.activity || update.release || update.details.length) {
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
    releaseDetails: after.releases.flatMap(release => {
      const change = releaseDetailChange(base.releases.find(previous => previous.id === release.id), release);
      return change ? [change] : [];
    }),
    stalledAfterWeeks: before && stalledBefore !== stalledAfter ? { from: stalledBefore, to: stalledAfter } : undefined,
  };
}

export function hasStoryMapChanges(diff: StoryMapDiff) {
  const groups = (changes: GroupChanges) =>
    changes.added.length || changes.removed.length || changes.renamed.length || changes.reordered || changes.customerLabelChanged.length;
  return !!(diff.created || diff.visibility || diff.titleChange || diff.customerCopyChanged || diff.customer.length || diff.blockedOrCut.length
    || diff.stories.added.length || diff.stories.removed.length || diff.stories.updated.length
    || groups(diff.activities) || groups(diff.releases) || diff.releaseDetails.length || diff.stalledAfterWeeks);
}

/**
 * Escapes text from the map so it renders literally in GitHub Markdown,
 * including inside table cells. `@` and `#` become character references, so
 * a pasted summary does not mention people or teams, or link issues.
 */
function text(value: string) {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[@#]/g, character => character === "@" ? "&#64;" : "&#35;")
    .replace(/[\\`*_[\]|~]/g, character => `\\${character}`)
    .replace(/\s+/g, " ");
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
    ...(changes.reordered ? [`- Reordered the ${label === "activity" ? "activities" : "releases"}`] : []),
  ];
  const structure = [...groupLines("activity", diff.activities), ...groupLines("release", diff.releases)];
  if (diff.titleChange) structure.unshift(`- Renamed the map from “${text(diff.titleChange.from)}” to “${text(diff.titleChange.to)}”`);
  if (structure.length) lines.push("### Activities and releases", "", ...structure, "");

  if (diff.stalledAfterWeeks) {
    const { from, to } = diff.stalledAfterWeeks;
    const weeks = (count: number) => `${count} ${count === 1 ? "week" : "weeks"}`;
    lines.push("### Settings", "", to === 0
      ? `- Turned off the stalled flag (was ${weeks(from)}).`
      : `- Stories are flagged as stalled after ${weeks(to)} in progress (was ${from === 0 ? "off" : weeks(from)}).`, "");
  }

  return lines.join("\n");
}
