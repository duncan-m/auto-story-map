import type { StoryMapDocument, StoryStatus } from "./schema.js";
import { isDeliveredStatus } from "./status.js";
import { present } from "./present.js";

/** Readiness states, in the order the CLI lists them. */
export const storyReadinessStates = ["ready", "waiting", "at-risk"] as const;

/**
 * Whether a planned or in-progress story can start, worked out from its `dependsOn` links.
 * `ready`: every prerequisite is merged or shipped, or it has none recorded.
 * `waiting`: at least one prerequisite is not merged or shipped yet.
 * `at-risk`: a prerequisite is cut, blocked, or unfinished in a later release. Takes precedence over waiting.
 */
export type StoryReadinessState = (typeof storyReadinessStates)[number];

/** Why an unfinished prerequisite puts a story at risk. */
export type StoryReadinessRisk = "cut" | "blocked" | "later-release";

/** A prerequisite that is not merged or shipped yet. */
export interface StoryReadinessPrerequisite {
  id: string;
  title: string;
  status: StoryStatus;
  /** The prerequisite's release ID. */
  release: string;
  /** True when it is in the same release as the story that waits for it. */
  sameRelease: boolean;
  /** Present when this prerequisite puts the story at risk. */
  risk?: StoryReadinessRisk;
}

/** A story's readiness. Worked out each time, never saved as a status. Internal only. */
export interface StoryReadiness {
  state: StoryReadinessState;
  /** The direct prerequisites that are not merged or shipped yet, in `dependsOn` order. Empty when the story is ready. */
  blocking: StoryReadinessPrerequisite[];
  /** True on an in-progress story that is waiting or at risk: it started before its prerequisites landed. */
  startedEarly?: true;
}

/** What `storyMapReadiness` works out for each story. */
export interface StoryDependencyProjection {
  /** Absent on merged, shipped, blocked and cut stories, which have no readiness. */
  readiness?: StoryReadiness;
  /** Direct prerequisites, in `dependsOn` order, without unknown IDs or repeats. */
  prerequisites: string[];
  /** Every story upstream of this one, nearest first, then in the order they are reached. */
  chain: string[];
}

const readinessStatuses: ReadonlySet<StoryStatus> = new Set(["planned", "in-progress"]);

/**
 * Works out each story's readiness, unfinished prerequisites and risks, plus its direct and
 * transitive prerequisites, from the map's `dependsOn` links. A pure projection: it never
 * changes the map. Links that were never recorded are unknown, so a ready story only has no
 * unfinished prerequisites on record.
 */
export function storyMapReadiness(map: StoryMapDocument): Map<string, StoryDependencyProjection> {
  const byId = new Map(map.stories.map(story => [story.id, story]));
  const releaseOrder = new Map(map.releases.map((release, index) => [release.id, index]));
  const direct = new Map(map.stories.map(story => [
    story.id,
    [...new Set(story.dependsOn ?? [])].filter(id => id !== story.id && byId.has(id)),
  ]));
  // Every story has an entry, and prerequisites are only IDs of stories in the map.
  const directOf = (id: string) => present(direct.get(id), `the prerequisites of ${id}`);
  const result = new Map<string, StoryDependencyProjection>();
  for (const story of map.stories) {
    const prerequisites = directOf(story.id);
    // Breadth first, so the nearest prerequisites come first. `seen` also guards against a cycle in an unvalidated map.
    const chain: string[] = [];
    const seen = new Set([story.id]);
    for (let queue = [...prerequisites]; queue.length;) {
      const next: string[] = [];
      for (const id of queue) {
        if (seen.has(id)) continue;
        seen.add(id);
        chain.push(id);
        next.push(...directOf(id));
      }
      queue = next;
    }
    result.set(story.id, {
      ...(readinessStatuses.has(story.status) ? { readiness: readinessOf(story, prerequisites) } : {}),
      prerequisites,
      chain,
    });
  }
  return result;

  function readinessOf(story: StoryMapDocument["stories"][number], prerequisites: string[]): StoryReadiness {
    const order = releaseOrder.get(story.release) ?? 0;
    const blocking = prerequisites.flatMap((id): StoryReadinessPrerequisite[] => {
      const prerequisite = present(byId.get(id), `prerequisite ${id}`);
      if (isDeliveredStatus(prerequisite.status)) return [];
      const risk: StoryReadinessRisk | undefined = prerequisite.status === "cut" || prerequisite.status === "blocked"
        ? prerequisite.status
        : (releaseOrder.get(prerequisite.release) ?? 0) > order ? "later-release" : undefined;
      return [{
        id,
        title: prerequisite.title,
        status: prerequisite.status,
        release: prerequisite.release,
        sameRelease: prerequisite.release === story.release,
        ...(risk ? { risk } : {}),
      }];
    });
    const state: StoryReadinessState = blocking.some(item => item.risk) ? "at-risk" : blocking.length ? "waiting" : "ready";
    return { state, blocking, ...(state !== "ready" && story.status === "in-progress" ? { startedEarly: true as const } : {}) };
  }
}

export const storyReadinessLabels: Record<StoryReadinessState, string> = {
  ready: "Ready to start",
  waiting: "Waiting",
  "at-risk": "At risk",
};

/** “ESM-105”, “ESM-105 and ESM-116”, “ESM-105, ESM-116 and ESM-120”. */
function idList(ids: readonly string[]) {
  return ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

const stories = (n: number) => `${n} ${n === 1 ? "story" : "stories"}`;

/**
 * The readiness as one sentence, such as “Waiting for 2 stories: ESM-105 and ESM-116 are not merged yet.”
 * `releaseName` turns a release ID into the name to show, for prerequisites in a later release.
 */
export function storyReadinessText(readiness: StoryReadiness, releaseName: (id: string) => string = id => id): string {
  if (readiness.state === "ready") return "Ready to start: no unfinished prerequisites are recorded.";
  const { blocking } = readiness;
  const be = (items: readonly unknown[]) => (items.length === 1 ? "is" : "are");
  const clause = (items: StoryReadinessPrerequisite[], text: string) =>
    items.length ? [`${idList(items.map(item => item.id))} ${be(items)} ${text}`] : [];
  const later = blocking.filter(item => item.risk === "later-release");
  const clauses = [
    ...clause(blocking.filter(item => item.risk === "cut"), "cut"),
    ...clause(blocking.filter(item => item.risk === "blocked"), "blocked"),
    ...later.map(item => `${item.id} is in a later release, ${releaseName(item.release)}`),
    ...clause(blocking.filter(item => !item.risk), "not merged yet"),
  ];
  const lead = readiness.state === "at-risk" ? "At risk" : `Waiting for ${stories(blocking.length)}`;
  const early = readiness.startedEarly ? ` It started before ${blocking.length === 1 ? "it" : "they"} landed.` : "";
  return `${lead}: ${clauses.join("; ")}.${early}`;
}
