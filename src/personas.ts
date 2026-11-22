import type { StoryMapDocument, StoryMapJob, StoryMapPersona } from "./schema.js";
import { isActiveStatus, type StoryStatus } from "./status.js";

/** A job to be done, with the persona that owns it. */
export interface StoryMapJobOwner {
  job: StoryMapJob;
  persona: StoryMapPersona;
}

type PersonaSource = Pick<StoryMapDocument, "personas">;
type TaggedStory = { jobs?: readonly string[]; personas?: readonly string[] };

/** Every job on the map by ID, with its persona. */
export function storyMapJobs(map: PersonaSource): Map<string, StoryMapJobOwner> {
  const jobs = new Map<string, StoryMapJobOwner>();
  for (const persona of map.personas ?? []) {
    for (const job of persona.jobs ?? []) {
      if (!jobs.has(job.id)) jobs.set(job.id, { job, persona });
    }
  }
  return jobs;
}

/**
 * Returns a function that gives the IDs of the personas a story is for: the
 * owners of its jobs, in the order of its jobs, then the personas it lists,
 * without repeats. The first is the primary persona. Unknown IDs are left out.
 * The view, filters and exports all use this, so they agree.
 */
export function storyPersonaResolver(map: PersonaSource): (story: TaggedStory) => string[] {
  const jobs = storyMapJobs(map);
  const known = new Set((map.personas ?? []).map(persona => persona.id));
  return story => {
    const ids = new Set<string>();
    for (const job of story.jobs ?? []) {
      const owner = jobs.get(job);
      if (owner) ids.add(owner.persona.id);
    }
    for (const persona of story.personas ?? []) {
      if (known.has(persona)) ids.add(persona);
    }
    return [...ids];
  };
}

/** The IDs of the personas one story is for. Use `storyPersonaResolver` for many stories. */
export function storyPersonas(map: PersonaSource, story: TaggedStory): string[] {
  return storyPersonaResolver(map)(story);
}

/**
 * Drops the full stops, question and exclamation marks that end `text`, so a
 * statement can add its own. Scans back from the end in linear time, where a
 * regex anchored at the end would rescan the rest of the text from every mark.
 */
export function withoutFinalPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === "!" || text[end - 1] === "?")) end--;
  return text.slice(0, end);
}

/** A job as the board reads it: “When …, I want …, so that ….” */
export function jobStatement(job: Pick<StoryMapJob, "situation" | "motivation" | "outcome">): string {
  return `When ${job.situation}, I want ${job.motivation}, so that ${withoutFinalPunctuation(job.outcome)}.`;
}

/**
 * A persona's core job: the first in their list, the one that matters most.
 * Undefined for a persona with no jobs. Reordering the jobs changes it.
 */
export function personaCoreJob<Job>(persona: { jobs?: readonly Job[] }): Job | undefined {
  return persona.jobs?.[0];
}

/**
 * Returns a function that counts the active stories for one step of a job:
 * those that serve the job and sit in the step's activity. Validate, the view
 * and the exports all use this, so they agree.
 */
export function jobStepCounter(map: { stories: readonly { activity: string; status: StoryStatus; jobs?: readonly string[] }[] }): (jobId: string, activityId: string) => number {
  const counts = new Map<string, Map<string, number>>();
  for (const story of map.stories) {
    if (!isActiveStatus(story.status)) continue;
    for (const job of new Set(story.jobs ?? [])) {
      let byActivity = counts.get(job);
      if (!byActivity) counts.set(job, byActivity = new Map());
      byActivity.set(story.activity, (byActivity.get(story.activity) ?? 0) + 1);
    }
  }
  return (jobId, activityId) => counts.get(jobId)?.get(activityId) ?? 0;
}

/**
 * How many of a job's steps point to an activity but have no active stories
 * there: the gaps in the job. Steps without an activity are never gaps.
 */
export function jobStepGaps(job: { steps?: readonly { activity?: string; activeStories?: number }[] }): number {
  return (job.steps ?? []).filter(step => step.activity !== undefined && !step.activeStories).length;
}

/** How many persona colours the board has. Personas take them in map order, and the seventh starts again. */
export const personaColourCount = 6;

/**
 * Up to two letters for a persona's avatar: the first letters of its first two
 * words, or the first two letters of a one-word title, such as “PM” for
 * “Product manager” and “EN” for “Engineer”.
 */
export function personaInitials(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map(word => Array.from(word)[0]) : Array.from(words[0] ?? "").slice(0, 2);
  return letters.join("").toLocaleUpperCase() || "?";
}
