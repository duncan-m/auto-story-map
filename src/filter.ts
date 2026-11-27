import { isStoryMapActionItemType, isStoryMapActionKind, type StoryMapActionFilter } from "./actions.js";
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
  /** Persona IDs. Keeps stories for any of them. IDs the view does not have are ignored, and choosing every persona keeps every story. */
  persona?: string | readonly string[];
  /** Job IDs. Keeps stories that serve any of them. Internal views only; IDs the view does not have are ignored. */
  job?: string | readonly string[];
  /** Activity IDs. Keeps stories under any of them. IDs the view does not have are ignored. */
  activity?: string | readonly string[];
  /**
   * `personas` shows the Personas tab instead of the story map, with the first chosen `persona`
   * as its page, or how to add personas when the map has none. Internal views only; otherwise it is ignored.
   */
  view?: StoryMapPage;
  /**
   * What the Actions tab narrows its list to: a kind, a release, one story, release or persona,
   * and whether only actions a person must take. Internal views only; unknown values are ignored.
   */
  actions?: StoryMapActionFilter;
  /**
   * A story ID from a permalink. The story is kept whatever the other filters say, and the
   * board opens its panel. Ignored unless the story is in the view, so a customer board treats
   * an internal-only story like one that does not exist.
   */
  story?: string;
  /** A release ID from a permalink. The board opens its panel, or scrolls to its lane for customers. Ignored unless the release is in the view. */
  release?: string;
}

/** The pages of an internal board: the story map, the Personas tab or the Actions tab. */
export type StoryMapPage = "map" | "personas" | "actions";

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
 * `persona`, `job`, `activity` and `view` parameters, and a permalink's `story` or `release`. `status` can repeat, once for each chosen
 * status or `stalled`, and `status=all` chooses every status. `persona`, `job`
 * and `activity` repeat, once for each ID. `view=personas` opens the Personas
 * tab and `view=actions` the Actions tab, which reads `action-kind`, `action-item-type`, `action-release`,
 * `action-item` and `needs-person=1`. Unknown values are ignored.
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
  const viewParam = params.get("view");
  const view = viewParam === "personas" || viewParam === "actions" ? viewParam : undefined;
  const actionKind = params.get("action-kind") ?? undefined;
  const actionItemType = params.get("action-item-type") ?? undefined;
  const [actionRelease] = readIds(params.getAll("action-release"));
  const [actionItem] = readIds(params.getAll("action-item"));
  const actions: StoryMapActionFilter = {
    ...(isStoryMapActionKind(actionKind) ? { kind: actionKind } : {}),
    ...(isStoryMapActionItemType(actionItemType) ? { itemType: actionItemType } : {}),
    ...(actionRelease ? { release: actionRelease } : {}),
    ...(actionItem ? { item: actionItem } : {}),
    ...(params.get("needs-person") === "1" ? { needsPerson: true } : {}),
  };
  const [story] = readIds(params.getAll("story"));
  const [release] = readIds(params.getAll("release"));
  return {
    query,
    status,
    ...(changedWithinDays ? { changedWithinDays } : {}),
    ...(persona.length ? { persona } : {}),
    ...(job.length ? { job } : {}),
    ...(activity.length ? { activity } : {}),
    ...(view ? { view } : {}),
    ...(Object.keys(actions).length ? { actions } : {}),
    ...(story ? { story } : {}),
    ...(release ? { release } : {}),
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
  const chosenPersonas = personas.filter(item => wantedPersonas.has(item.id)).map(item => item.id);
  // Choosing every persona shows everyone, as the menu does by default, so stories for no one stay.
  const persona = chosenPersonas.length < personas.length ? chosenPersonas : [];
  const job = internalPersonas.flatMap(item => item.jobs).filter(item => wantedJobs.has(item.id)).map(item => item.id);
  const personaSet = new Set(persona);
  const jobSet = new Set(job);
  const wantedActivities = listed(filters.activity);
  const activity = view.activities.filter(item => wantedActivities.has(item.id)).map(item => item.id);
  const activitySet = new Set(activity);
  // Only internal viewers get the Personas tab, which shows how to add personas when the map has none. Customers never do, because jobs never reach them.
  const personasPage = filters.view === "personas" && internal;
  const actionsPage = filters.view === "actions" && internal;
  // Action filters only count for values the view has, so customers and unknown IDs change nothing.
  const actionFilter: StoryMapActionFilter = {};
  if (internal && filters.actions) {
    const { kind, itemType, release, item, needsPerson } = filters.actions;
    const itemIds = new Set(view.actions.flatMap(group => group.actions.flatMap(action => "id" in action.item ? [action.item.id] : [])));
    if (isStoryMapActionKind(kind)) actionFilter.kind = kind;
    if (isStoryMapActionItemType(itemType)) actionFilter.itemType = itemType;
    if (release !== undefined && view.releases.some(entry => entry.id === release)) actionFilter.release = release;
    if (item !== undefined && itemIds.has(item)) actionFilter.item = item;
    if (needsPerson === true) actionFilter.needsPerson = true;
  }
  // Search also matches the titles of a story's personas and the statements of its jobs, for internal viewers.
  const personaTitles = new Map(internalPersonas.map(item => [item.id, item.title]));
  const statements = new Map(internalPersonas.flatMap(item => item.jobs.map(entry => [entry.id, jobStatement(entry)] as const)));

  // A permalink only counts for a story or release the viewer can see.
  const linkedStory = filters.story !== undefined ? view.stories.find(item => item.id === filters.story)?.id : undefined;
  const linkedRelease = filters.release !== undefined ? view.releases.find(item => item.id === filters.release)?.id : undefined;

  const hidden = { blocked: 0, cut: 0 };
  const stories = (view.stories as InternalStoryCard[]).filter(story => {
    if (story.id === linkedStory) return true;
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
      ...(personasPage ? { view: "personas" as const } : actionsPage ? { view: "actions" as const } : {}),
      ...(Object.keys(actionFilter).length ? { actions: actionFilter } : {}),
      ...(linkedStory ? { story: linkedStory } : {}),
      ...(linkedRelease ? { release: linkedRelease } : {}),
      total: view.stories.length,
      ...(hidden.blocked || hidden.cut ? { hidden } : {}),
    },
  };
}
