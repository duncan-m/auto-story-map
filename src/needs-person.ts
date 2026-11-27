import type { StoryMapDiff } from "./diff.js";
import type { StoryMapRuleId } from "./rules.js";
import type { StoryMapDocument } from "./schema.js";

/**
 * The rules for map changes that `AGENTS.md` keeps for people. Each is also a
 * rule in `storyMapRules`, so `pr-check` (ESM-163) can report them with a link.
 */
export const needsPersonRules = [
  "draft-confirmed",
  "estimate-changed",
  "story-removed",
  "possible-renumber",
  "customer-copy-changed",
  "settings-changed",
] as const satisfies readonly StoryMapRuleId[];

/** The rule a change that needs a person breaks when an agent makes it, such as `estimate-changed`. */
export type NeedsPersonRule = typeof needsPersonRules[number];

/** What a change that needs a person is about. `map` covers the map's own copy, visibility and settings. */
export type NeedsPersonItemType = "story" | "activity" | "release" | "persona" | "job" | "map";

/** One change to the map that only a person should make. It says what changed, not who made it. */
export interface NeedsPersonChange {
  rule: NeedsPersonRule;
  itemType: NeedsPersonItemType;
  /** The story, activity, release, persona or job ID, or the map's ID. For a setting, the setting's name. */
  itemId: string;
  /** The item's internal title. For a job, its persona's title. For a setting, the setting's name. */
  title: string;
  /** What changed, in a few plain words, such as “none → 3” or “confirmed drafted impact “Quote turnaround””. */
  change: string;
  /** For `possible-renumber`: the ID of the added story with the same title. */
  addedId?: string;
}

type Before = StoryMapDocument | null;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const titleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
const value = (setting: unknown) => setting === undefined ? "not set" : JSON.stringify(setting);
const copyChange = (before: unknown, after: unknown) => !after || same(before, after) ? undefined : before ? "changed customer copy" : "added customer copy";

/**
 * Lists the changes between two versions of a map that `AGENTS.md` leaves to
 * people: drafts confirmed, estimates set, changed or removed, stories removed
 * rather than cut (or possibly renumbered), customer copy added or changed, a
 * switch to `all-users`, and settings changed. It reads the comparison from
 * `diffStoryMaps` and both maps, and is empty for most changes.
 */
export function needsPersonChanges(before: Before, after: StoryMapDocument, diff: Omit<StoryMapDiff, "needsPerson">): NeedsPersonChange[] {
  const changes: NeedsPersonChange[] = [];
  const push = (change: NeedsPersonChange) => changes.push(change);

  // Drafts confirmed.
  for (const job of diff.jobs.confirmed) push({ rule: "draft-confirmed", itemType: "job", itemId: job.id, title: job.persona, change: "confirmed drafted job" });
  for (const persona of diff.personaContexts.confirmed) push({ rule: "draft-confirmed", itemType: "persona", itemId: persona.id, title: persona.title, change: "confirmed drafted context" });
  for (const release of diff.releaseDetails) {
    for (const metric of release.impact.confirmed) push({ rule: "draft-confirmed", itemType: "release", itemId: release.id, title: release.title, change: `confirmed drafted impact “${metric}”` });
  }

  // Estimates set, changed or removed, including on new stories.
  const newStories = new Map(after.stories.map(story => [story.id, story]));
  for (const added of diff.stories.added) {
    const estimate = newStories.get(added.id)?.estimate;
    if (estimate !== undefined) push({ rule: "estimate-changed", itemType: "story", itemId: added.id, title: added.title, change: `none → ${estimate}` });
  }
  for (const update of diff.stories.updated) {
    if (update.estimate) push({ rule: "estimate-changed", itemType: "story", itemId: update.id, title: update.title, change: `${update.estimate.from ?? "none"} → ${update.estimate.to ?? "none"}` });
  }

  // Stories removed rather than cut. One whose title matches an added story may have been renumbered.
  const addedByTitle = new Map<string, string>();
  for (const added of diff.stories.added) if (!addedByTitle.has(titleKey(added.title))) addedByTitle.set(titleKey(added.title), added.id);
  for (const removed of diff.stories.removed) {
    const addedId = addedByTitle.get(titleKey(removed.title));
    push(addedId
      ? { rule: "possible-renumber", itemType: "story", itemId: removed.id, title: removed.title, change: `removed, and ${addedId} was added with the same title`, addedId }
      : { rule: "story-removed", itemType: "story", itemId: removed.id, title: removed.title, change: "removed rather than cut" });
  }

  // Customer copy added or changed, and a switch to all-users.
  if (diff.visibility?.to === "all-users") push({ rule: "customer-copy-changed", itemType: "map", itemId: after.id, title: after.title, change: "visibility switched to all-users" });
  const mapCopy = copyChange(before?.customer, after.customer);
  if (mapCopy) push({ rule: "customer-copy-changed", itemType: "map", itemId: after.id, title: after.title, change: mapCopy });
  const groups = [
    ["activity", before?.activities ?? [], after.activities],
    ["release", before?.releases ?? [], after.releases],
    ["persona", before?.personas ?? [], after.personas ?? []],
    ["story", before?.stories ?? [], after.stories],
  ] as const;
  for (const [itemType, old, current] of groups) {
    const previous = new Map<string, { customer?: unknown }>(old.map(item => [item.id, item]));
    for (const item of current) {
      const change = copyChange(previous.get(item.id)?.customer, item.customer);
      if (change) push({ rule: "customer-copy-changed", itemType, itemId: item.id, title: item.title, change });
    }
  }

  // Map settings changed. A new map has nothing to compare with.
  if (before) {
    const was = before.settings ?? {};
    const now = after.settings ?? {};
    for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const from = (was as Record<string, unknown>)[name];
      const to = (now as Record<string, unknown>)[name];
      if (!same(from, to)) push({ rule: "settings-changed", itemType: "map", itemId: name, title: name, change: `${value(from)} → ${value(to)}` });
    }
  }

  return changes;
}
