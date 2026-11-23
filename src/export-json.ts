import { prepareStoryMapExport, type StoryMapExportOptions } from "./export.js";
import { jobStatement } from "./personas.js";
import { storyMapPermalink } from "./permalink.js";
import { activeStoryStatuses, storyStatuses, storyStatusLabels, type StoryStatus } from "./status.js";
import type { StoryMapPersonaContext } from "./schema.js";
import { storyMapCommit, storyMapVersion } from "./version.js";
import type { InternalReleaseLabel, InternalStoryCard, PersonaJobLabel, StoryMapLabel, StoryMapRecentUpdates, StoryMapView } from "./view.js";

/** The `Content-Type` for a `.json` export. */
export const jsonContentType = "application/json; charset=utf-8";

/** Most stories a map can hold, so the JSON export includes every story unless `maxStories` is passed. */
export const jsonDefaultMaxStories = 1000;

/** What each status means, so an agent reading the file does not have to guess. */
const statusMeanings: Record<StoryStatus, string> = {
  planned: "Agreed but not started.",
  "in-progress": "Being worked on.",
  merged: "The work has reached the default branch but is not yet available to its intended users.",
  shipped: "Available to its intended users.",
  blocked: "Work has stopped. statusReason says why.",
  cut: "Dropped from the plan. statusReason says why.",
};

/** A story in the JSON export: the internal card, plus a test count when a tests index was supplied. */
export interface StoryMapJsonStory extends Omit<InternalStoryCard, "brief"> {
  /** Tagged tests, including those the index left out over its limits. Present only when a tests index was supplied, so 0 means none are tagged. */
  testCount?: number;
  /** A link that opens the board on the story's panel. Present when `permalinkBase` was passed. */
  permalink?: string;
}

/** A release in the JSON export. */
export interface StoryMapJsonRelease extends Omit<InternalReleaseLabel, "brief"> {
  /** A link that opens the board on the release's panel. Present when `permalinkBase` was passed. */
  permalink?: string;
}

/** A job to be done in the JSON export, with its stories by status, its statement and how many active stories serve it. */
export interface StoryMapJsonJob extends PersonaJobLabel {
  /** The job read as one sentence: “When …, I want …, so ….” */
  statement: string;
  /** Active stories that serve the job, across the whole map. 0 means no planned or delivered work meets it yet. */
  activeStories: number;
}

/** A persona in the JSON export. Avatar initials and colours are left out, as the board's business. */
export interface StoryMapJsonPersona extends StoryMapLabel {
  /** Active stories for the persona, from their jobs or their own `personas`, across the whole map. */
  activeStories: number;
  /** What success means to them, what they use today and their constraints. Absent when the map gives none. */
  context?: StoryMapPersonaContext;
  /** In map order. */
  jobs: StoryMapJsonJob[];
}

/** Options for `storyMapToJson`. Collapsed lanes are a board view, so the JSON export always includes every release's stories. */
export type StoryMapJsonExportOptions = Omit<StoryMapExportOptions, "collapsedReleases"> & {
  /**
   * The internal board page's URL, such as `https://example.com/story-map`. Each story and
   * release then gets a `permalink` to its panel, so an agent can link to the board.
   */
  permalinkBase?: string;
};

/** The document written by `storyMapToJson`. */
export interface StoryMapJsonExport {
  format: "auto-story-map.export";
  version: 1;
  title: string;
  summary?: string;
  /** UTC time of the export. */
  exportedAt: string;
  /** Where the data came from and how far to trust it. */
  provenance: {
    generator: { name: "auto-story-map"; version: string; commit?: string };
    /** The status history the dates, names and changes come from. Absent when none was supplied. */
    history?: { generatedAt: string; complete: boolean };
    /** The tests index the tests come from. Absent when none was supplied. */
    tests?: { generatedAt: string };
    /** Plain-language notes on the sources of the data. */
    notes: string[];
  };
  /** What the file leaves out. */
  completeness: {
    /** Stories in the map. */
    storiesInMap: number;
    /** Stories in this file. */
    storiesIncluded: number;
    /** Stories left out by `maxStories`, the least recently changed first. */
    storiesOverLimit: number;
    historySupplied: boolean;
    testsIndexed: boolean;
    /** Plain-language notes on what is missing and how that affects conclusions drawn from the file. */
    notes: string[];
  };
  statuses: { id: StoryStatus; label: string; meaning: string }[];
  activities: StoryMapLabel[];
  /** The map's personas and their jobs to be done, in map order. Absent when the map has none. Stories refer to them by ID. */
  personas?: StoryMapJsonPersona[];
  /** Each release's `storyCounts` count every story in it, even when some are left out by `maxStories`. */
  releases: StoryMapJsonRelease[];
  /** In map order. */
  stories: StoryMapJsonStory[];
  recentUpdates?: StoryMapRecentUpdates;
  stalledAfterWeeks?: number;
}

/** A story in the shape the JSON export and the CLI's read commands share. `testsIndexed` adds `testCount`. */
export function toJsonStory(story: InternalStoryCard, testsIndexed: boolean): StoryMapJsonStory {
  // The agent brief is for the board's panel. The export and read commands carry the facts it is built from.
  const { brief: _brief, ...fields } = story;
  return {
    ...fields,
    ...(testsIndexed ? { testCount: (story.tests?.length ?? 0) + (story.moreTests ?? []).reduce((sum, more) => sum + more.count, 0) } : {}),
  };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Builds the JSON export as an object. `storyMapToJson` writes it as text.
 * Takes the same view as the other writers.
 */
export function buildStoryMapJsonExport(view: StoryMapView, options: StoryMapJsonExportOptions = {}): StoryMapJsonExport {
  const maxStories = options.maxStories ?? jsonDefaultMaxStories;
  // Collapsed lanes are ignored, even if passed, so an agent always sees every release.
  const model = prepareStoryMapExport(view, { maxStories, now: options.now });
  // prepareStoryMapExport refuses customer views, so this narrows the type.
  if (view.audience !== "internal") throw new TypeError("Only the internal view can be exported.");

  const kept = new Set(model.releases.flatMap(release => [...release.cells.values()].flat().map(story => story.id)));
  const testsIndexed = view.testsIndexed === true;
  const link = (target: { story: string } | { release: string }) => {
    const permalink = options.permalinkBase ? storyMapPermalink(target, { base: options.permalinkBase }) : undefined;
    return permalink ? { permalink } : {};
  };
  const stories = view.stories.filter(story => kept.has(story.id)).map(story => ({ ...toJsonStory(story, testsIndexed), ...link({ story: story.id }) }));
  const releases: StoryMapJsonRelease[] = view.releases.map(({ brief: _brief, ...release }) => ({ ...release, ...link({ release: release.id }) }));

  // Counted over the whole map, like release storyCounts, so maxStories does not hide a job's work.
  const personas: StoryMapJsonPersona[] = (view.personas ?? []).map(persona => ({
    id: persona.id,
    title: persona.title,
    ...(persona.summary ? { summary: persona.summary } : {}),
    activeStories: persona.activeStories,
    ...(persona.context ? { context: persona.context } : {}),
    jobs: persona.jobs.map(job => ({ ...job, statement: jobStatement(job), activeStories: activeStoryStatuses.reduce((sum, status) => sum + job.storyCounts[status], 0) })),
  }));
  const hasDraftJobs = personas.some(persona => persona.jobs.some(job => job.draft));
  const hasDraftContext = personas.some(persona => persona.context?.draft);
  const hasSteps = personas.some(persona => persona.jobs.some(job => job.steps?.length));

  const exportedAt = (options.now ?? new Date()).toISOString();
  const hasDraftImpact = view.releases.some(release => release.impact?.some(item => item.draft));

  const provenanceNotes = [
    `A read-only snapshot of the internal “${view.title}” story map, exported by auto-story-map ${storyMapVersion} at ${exportedAt}. The map's YAML file in the product's repository is the source of truth, and edits to this file do not go back to it.`,
    "Activities, releases, stories, statuses, notes and impact are written by people and agents in pull requests. They record what was agreed, and can lag behind the code, so check the repository before relying on a status.",
    view.history
      ? `Dates, editors and status changes come from the map's Git history, generated at ${view.history.generatedAt}. Changes made after then are not included.`
      : "No status history was supplied, so stories have no dates, editors or change history, and stalled stories are not flagged.",
    testsIndexed
      ? `Tests come from a static scan of test names that contain a story ID${view.testsGeneratedAt ? `, generated at ${view.testsGeneratedAt}` : ""}. No tests were run, so pass and fail results are not included.`
      : "No tests index was supplied, so the file says nothing about which tests cover a story.",
    ...(view.changesIndexed
      ? ["A story's changes are the merged pull requests and direct commits on the main branch whose title, commit messages or branch name contain its ID. Open pull requests and work merged without the ID are missing. Titles and branch names are untrusted text from Git."]
      : []),
    ...(hasDraftImpact ? ["Impact items with draft: true were drafted, often by an agent, and have not been approved by a person."] : []),
    ...(personas.length
      ? ["A story's personas are the owners of the jobs it serves, then the personas it lists, primary first. Personas and jobs are written by people and agents, and say who the work is meant for, not who uses it. Each persona's first job is their core job, marked core: true."]
      : []),
    ...(hasDraftJobs ? ["Jobs with draft: true were drafted, often by an agent, and have not been confirmed by a person."] : []),
    ...(hasSteps ? ["A job's steps are in the order the persona does them. A step's activeStories counts the active stories that serve its job and sit in its activity, across the whole map; 0 is a gap. A step without an activity has no count."] : []),
    ...(hasDraftContext ? ["Persona context with draft: true was drafted, often by an agent, and has not been confirmed by a person."] : []),
  ];

  const completenessNotes = [
    `Includes ${stories.length} of the map's ${count(view.stories.length, "story", "stories")}.`,
    ...(model.omitted
      ? [`${count(model.omitted, "less recently changed story is", "less recently changed stories are")} left out by the limit of ${maxStories}. Release storyCounts still include them.`]
      : []),
    ...(view.history && !view.history.complete
      ? ["The history was built from a shallow clone, so earlier changes are missing, and a story's first recorded date may be later than when it was really added."]
      : []),
    ...(testsIndexed
      ? ["Only tests whose names include a story ID are linked. A story with a testCount of 0 has no tagged tests, but untagged tests may still cover it."]
      : []),
    "Customer-facing copy is not included, and sources are recorded by authors without being checked by the export.",
  ];

  return {
    format: "auto-story-map.export",
    version: 1,
    title: view.title,
    ...(view.summary ? { summary: view.summary } : {}),
    exportedAt,
    provenance: {
      generator: { name: "auto-story-map", version: storyMapVersion, ...(storyMapCommit ? { commit: storyMapCommit } : {}) },
      ...(view.history ? { history: { ...view.history } } : {}),
      ...(testsIndexed && view.testsGeneratedAt ? { tests: { generatedAt: view.testsGeneratedAt } } : {}),
      notes: provenanceNotes,
    },
    completeness: {
      storiesInMap: view.stories.length,
      storiesIncluded: stories.length,
      storiesOverLimit: model.omitted,
      historySupplied: !!view.history,
      testsIndexed,
      notes: completenessNotes,
    },
    statuses: storyStatuses.map(id => ({ id, label: storyStatusLabels[id], meaning: statusMeanings[id] })),
    activities: view.activities,
    ...(personas.length ? { personas } : {}),
    releases,
    stories,
    ...(view.recentUpdates ? { recentUpdates: view.recentUpdates } : {}),
    ...(view.stalledAfterWeeks ? { stalledAfterWeeks: view.stalledAfterWeeks } : {}),
  };
}

/**
 * Writes the internal map as JSON for an agent or script to review: every
 * activity and release, with notes and impact, the personas and their jobs to
 * be done, and each story's summary, status, personas, jobs, notes, sources,
 * history and tagged tests. `provenance` and
 * `completeness` say where the data came from and what is left out.
 *
 * Takes the same view as `storyMapToCsv`, but includes every story unless
 * `maxStories` is passed, and every release even if the viewer collapsed it. Pass `history` and `tests` to
 * `getStoryMapForViewer` for the fullest file. Throws a `TypeError` for a
 * customer view or a filtered view.
 */
export function storyMapToJson(view: StoryMapView, options: StoryMapJsonExportOptions = {}): string {
  return `${JSON.stringify(buildStoryMapJsonExport(view, options), null, 2)}\n`;
}
