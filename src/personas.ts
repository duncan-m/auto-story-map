import type { StoryMapDocument, StoryMapJob, StoryMapPersona } from "./schema.js";

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

/** A job as the board reads it: “When …, I want …, so ….” */
export function jobStatement(job: Pick<StoryMapJob, "situation" | "motivation" | "outcome">): string {
  const outcome = job.outcome.replace(/[.!?]+$/, "");
  return `When ${job.situation}, I want ${job.motivation}, so ${outcome}.`;
}
