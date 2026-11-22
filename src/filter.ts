import { activeStoryStatuses, customerStoryStatuses, isActiveStatus, storyStatuses, type StoryStatusFilter } from "./status.js";
import { jobStatement } from "./personas.js";
import type { InternalStoryCard, StoryMapLabel, StoryMapView } from "./view.js";

/** Windows offered by the board’s “Changed in” filter, in days. */
export const changedWithinOptions = [1, 7, 14, 30] as const;
export type ChangedWithinDays = (typeof changedWithinOptions)[number];

export interface StoryMapFilters {
  query?: string;
  /**
   * The statuses to show. A story is kept when its status is chosen, or when
   * `stalled` is chosen and the story is stalled. `all` chooses every status.
   * When absent or empty, only active stories (planned, in progress, merged and
   * shipped) are kept, and blocked and cut stories are hidden.
   */
  status?: StoryStatusFilter | "all" | readonly StoryStatusFilter[];
  /** Only stories added or changed in this many days. Needs history and an internal view. */
  changedWithinDays?: ChangedWithinDays;
  /** Persona IDs. Keeps stories for any of them. IDs the view does not have are ignored. */
  persona?: string | readonly string[];
  /** Job IDs. Keeps stories that serve any of them. Internal views only; IDs the view does not have are ignored. */
  job?: string | readonly string[];
  /** Activity IDs. Keeps stories under any of them. IDs the view does not have are ignored. */
  activity?: string | readonly string[];
  /**
   * `personas` shows the Personas tab instead of the story map, with the first chosen `persona`
   * as its page. Internal views of maps with personas only; otherwise it is ignored.
   */
  view?: StoryMapPage;
}

/** The pages of an internal board with personas: the story map, or the Personas tab. */
export type StoryMapPage = "map" | "personas";

export interface FilterOptions {
  /** Time to measure “changed in” windows from. Defaults to now. */
  now?: Date;
}

const maxQueryLength = 100;
const dayMs = 24 * 60 * 60 * 1000;

/** Most persona or job IDs read from one request. */
const maxIdParams = 20;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Well-formed IDs from repeated parameters, without duplicates. Whether they exist is checked against the view. */
function readIds(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(value => idPattern.test(value)))].slice(0, maxIdParams);
}

const statusChoices: readonly StoryStatusFilter[] = [...storyStatuses, "stalled"];

/** The chosen statuses, in board order, without duplicates or unknown values. `all` means every status. */
function readStatuses(value: unknown): StoryStatusFilter[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  if (values.includes("all")) return [...storyStatuses];
  return statusChoices.filter(choice => values.includes(choice));
}

/**
 * Reads the board’s `q`, `status`, `changed` (`1d`, `7d`, `14d` or `30d`),
 * `persona`, `job`, `activity` and `view` parameters. `status` can repeat, once for each chosen
 * status or `stalled`, and `status=all` chooses every status. `persona`, `job`
 * and `activity` repeat, once for each ID. `view=personas` opens the Personas
 * tab. Unknown values are ignored.
 */
export function readStoryMapFilters(params: URLSearchParams): StoryMapFilters {
  const query = params.get("q")?.trim().slice(0, maxQueryLength) || undefined;
  const chosen = readStatuses(params.getAll("status"));
  const status = chosen.length ? chosen : undefined;
  const changed = /^(\d+)d$/.exec(params.get("changed") ?? "")?.[1];
  const changedWithinDays = changedWithinOptions.find(days => String(days) === changed);
  const persona = readIds(params.getAll("persona"));
  const job = readIds(params.getAll("job"));
  const activity = readIds(params.getAll("activity"));
  const view = params.get("view") === "personas" ? "personas" as const : undefined;
  return {
    query,
    status,
    ...(changedWithinDays ? { changedWithinDays } : {}),
    ...(persona.length ? { persona } : {}),
    ...(job.length ? { job } : {}),
    ...(activity.length ? { activity } : {}),
    ...(view ? { view } : {}),
  };
}

/**
 * Narrows a projected view to the stories that match the filters. Call it after
 * `getStoryMapForViewer`, so searches only see what the viewer is allowed to see.
 * Without a status filter, or when it chooses exactly the default statuses, blocked
 * and cut stories are hidden and counted in `filter.hidden`. The “changed in” and
 * `stalled` filters apply only to internal views with history; otherwise they are ignored.
 */
export function filterStoryMapView<View extends StoryMapView>(
  view: View,
  filters: StoryMapFilters = {},
  options: FilterOptions = {},
): View {
  const query = filters.query?.trim().slice(0, maxQueryLength) || undefined;
  const needle = query?.toLocaleLowerCase();
  const internal = view.audience === "internal";
  // Customers only see their own statuses, and every one of them by default.
  const offered = internal ? statusChoices.filter(choice => choice !== "stalled" || view.stalledAfterWeeks) : customerStoryStatuses;
  const defaults: readonly StoryStatusFilter[] = internal ? activeStoryStatuses : customerStoryStatuses;
  const requested = readStatuses(filters.status).filter(choice => offered.includes(choice as never));
  const isDefault = requested.length === defaults.length && defaults.every(choice => requested.includes(choice));
  const status = requested.length && !isDefault ? requested : undefined;
  const chosen = new Set<StoryStatusFilter>(status ?? defaults);
  const changedWithinDays = internal && view.history && changedWithinOptions.includes(filters.changedWithinDays!)
    ? filters.changedWithinDays
    : undefined;
  const since = changedWithinDays ? (options.now ?? new Date()).getTime() - changedWithinDays * dayMs : undefined;

  // Only personas and jobs the view has count, in map order, so unknown IDs are ignored and customers
  // can only choose the personas their view shows, by their public IDs. Customers never see jobs.
  const personas: readonly StoryMapLabel[] = view.personas ?? [];
  const internalPersonas = internal ? view.personas ?? [] : [];
  const listed = (value: string | readonly string[] | undefined) => new Set(typeof value === "string" ? [value] : value ?? []);
  const wantedPersonas = listed(filters.persona);
  const wantedJobs = listed(filters.job);
  const persona = personas.filter(item => wantedPersonas.has(item.id)).map(item => item.id);
  const job = internalPersonas.flatMap(item => item.jobs).filter(item => wantedJobs.has(item.id)).map(item => item.id);
  const personaSet = new Set(persona);
  const jobSet = new Set(job);
  const wantedActivities = listed(filters.activity);
  const activity = view.activities.filter(item => wantedActivities.has(item.id)).map(item => item.id);
  const activitySet = new Set(activity);
  // Only internal viewers of a map with personas get the Personas tab. Customers never do, because jobs never reach them.
  const personasPage = filters.view === "personas" && internalPersonas.length > 0;
  // Search also matches the titles of a story's personas and the statements of its jobs, for internal viewers.
  const personaTitles = new Map(internalPersonas.map(item => [item.id, item.title]));
  const statements = new Map(internalPersonas.flatMap(item => item.jobs.map(entry => [entry.id, jobStatement(entry)] as const)));

  const hidden = { blocked: 0, cut: 0 };
  const stories = (view.stories as InternalStoryCard[]).filter(story => {
    if (status && !chosen.has(story.status) && !(chosen.has("stalled") && story.stalled)) return false;
    if (since !== undefined && !(story.lastChangedAt && Date.parse(story.lastChangedAt) >= since)) return false;
    if (personaSet.size && !story.personas?.some(id => personaSet.has(id))) return false;
    if (jobSet.size && !story.jobs?.some(id => jobSet.has(id))) return false;
    if (activitySet.size && !activitySet.has(story.activity)) return false;
    if (needle) {
      const fields = internal
        ? [
          story.id, story.title, story.summary, story.notes, story.statusReason,
          ...(story.personas ?? []).map(id => personaTitles.get(id)),
          ...(story.jobs ?? []).map(id => statements.get(id)),
        ]
        : [story.title, story.summary];
      if (!fields.some(field => field?.toLocaleLowerCase().includes(needle))) return false;
    }
    if (!status && !isActiveStatus(story.status)) {
      hidden[story.status as keyof typeof hidden]++;
      return false;
    }
    return true;
  });

  return {
    ...view,
    stories,
    filter: {
      query,
      status,
      ...(changedWithinDays ? { changedWithinDays } : {}),
      ...(persona.length ? { persona } : {}),
      ...(job.length ? { job } : {}),
      ...(activity.length ? { activity } : {}),
      ...(personasPage ? { view: "personas" as const } : {}),
      total: view.stories.length,
      ...(hidden.blocked || hidden.cut ? { hidden } : {}),
    },
  };
}
