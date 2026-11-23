import type { StoryMapJsonStory } from "../export-json.js";
import { releaseEstimatesText } from "../export.js";
import { changedWithinOptions, type ChangedWithinDays } from "../filter.js";
import { jobStatement } from "../personas.js";
import { findStories, getStories } from "../read.js";
import { storyStatuses, storyStatusLabels, type StoryStatusFilter } from "../status.js";
import { getStoryMapForViewer, type InternalReleaseLabel, type StoryDependency, type StoryMapView } from "../view.js";
import {
  ArgumentError,
  count,
  defineCommand,
  escapeLines,
  escapeText,
  loadInputsOrReport,
  loadMapOrReport,
  optionValue,
  printJson,
  readFormat,
} from "./shared.js";

const formats = ["text", "json"] as const;
const statusChoices: readonly string[] = [...storyStatuses, "stalled", "all"];

interface ReadOptions {
  format: (typeof formats)[number];
  map: string;
  history?: string;
  tests?: string;
}

/** Parses the options every read command takes, handing the rest to `extra`. Returns null for an unknown option. */
function parseReadArgs(rest: string[], extra: (name: string, value: () => string) => boolean, positional?: string[]): ReadOptions | null {
  const options: ReadOptions = { format: "text", map: "product/story-map.yaml" };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    const value = () => {
      const [found, next] = optionValue(rest, index, name);
      index = next;
      return found;
    };
    if (name === "--format") options.format = readFormat(value(), formats);
    else if (name === "--map") options.map = value();
    else if (name === "--history") options.history = value();
    else if (name === "--tests-index") options.tests = value();
    else if (arg.startsWith("-")) {
      if (!extra(name, value)) return null;
    } else if (positional) positional.push(arg);
    else return null;
  }
  return options;
}

/** Loads the map, history and tests index as the internal view. Returns null, with exit code 1, when any cannot be read. */
async function loadView(options: ReadOptions): Promise<Extract<StoryMapView, { audience: "internal" }> | null> {
  const loaded = await loadMapOrReport(options.map);
  if (!loaded) return null;
  const inputs = await loadInputsOrReport({ history: options.history, tests: options.tests });
  if (!inputs) return null;
  // Whoever runs the CLI has the YAML file, so reads are always the internal view.
  return getStoryMapForViewer(loaded.map, {}, { canViewInternal: () => true, ...inputs }) as Extract<StoryMapView, { audience: "internal" }>;
}

const statusLabel = (story: StoryMapJsonStory) => `${story.status}${story.stalled ? " (stalled)" : ""}`;

type Titled = { id: string; title: string }[];

function labelled(view: { releases: Titled; activities: Titled; personas?: Titled }, kind: "releases" | "activities" | "personas", id: string) {
  const title = view[kind]?.find(item => item.id === id)?.title;
  return title ? `${escapeText(id)} (${escapeText(title)})` : escapeText(id);
}

/** A field whose value may span several lines, indented under its label. */
function field(lines: string[], label: string, value: string | undefined) {
  if (!value) return;
  const [first, ...more] = escapeLines(value);
  // Labels longer than the column, such as “Updated by:”, still get a space before the value.
  lines.push(`  ${`${label}:`.padEnd(10)} ${first}`);
  for (const line of more) lines.push(line ? `             ${line}` : "");
}

/** “ESM-105 (planned), ESM-116 (planned)”. */
const dependencyList = (stories: readonly StoryDependency[]) => stories.map(story => `${story.id} (${story.status})`).join(", ");

function storyText(view: Extract<StoryMapView, { audience: "internal" }>, story: StoryMapJsonStory): string {
  const lines = [`${escapeText(story.id)}  ${escapeText(story.title)}`];
  field(lines, "Status", statusLabel(story));
  field(lines, "Reason", story.statusReason);
  field(lines, "Release", labelled(view, "releases", story.release));
  field(lines, "Activity", labelled(view, "activities", story.activity));
  if (story.estimate) field(lines, "Estimate", `${story.estimate} pts`);
  if (story.tokens !== undefined) field(lines, "Tokens used", story.tokens.toLocaleString("en-US"));
  if (story.estimatedCostUsd !== undefined) field(lines, "Est. cost", `$${story.estimatedCostUsd.toFixed(2)}`);
  if (story.dependsOn?.length) field(lines, "Depends on", dependencyList(story.dependsOn));
  if (story.dependents?.length) field(lines, "Waiting for it", dependencyList(story.dependents));
  if (story.personas?.length) field(lines, "For", story.personas.map(id => labelled(view, "personas", id)).join(", "));
  if (story.jobs?.length) {
    const jobs = new Map((view.personas ?? []).flatMap(persona => persona.jobs.map(job => [job.id, { job, persona }] as const)));
    lines.push("  Jobs:");
    for (const id of story.jobs) {
      const found = jobs.get(id);
      const detail = found ? `  ${jobStatement(found.job)} (${found.persona.title})${found.job.core ? " [core job]" : ""}${found.job.draft ? " [draft]" : ""}` : "";
      lines.push(`    ${escapeText(id)}${escapeText(detail)}`);
    }
  }
  field(lines, "Summary", story.summary);
  field(lines, "Notes", story.notes);
  if (story.updatedBy) field(lines, "Updated by", story.updatedBy);
  if (story.sources?.length) {
    lines.push("  Sources:");
    for (const source of story.sources) lines.push(`    ${escapeText(source)}`);
  }
  if (story.history?.length) {
    lines.push("  History:");
    for (const entry of story.history) {
      const change = entry.type === "added" ? `added as ${entry.to}` : `${entry.from ?? "?"} → ${entry.to}`;
      const by = entry.by ? ` by ${escapeText(entry.by)}` : "";
      const reason = entry.reason ? `: ${escapeText(entry.reason)}` : "";
      lines.push(`    ${entry.at.slice(0, 10)}  ${change}${by} (${escapeText(entry.commit.slice(0, 7))})${reason}`);
    }
  }
  if (story.changes?.length || story.moreChanges) {
    lines.push("  Changes:");
    for (const change of story.changes ?? []) {
      const ref = change.pullRequest !== undefined ? `#${change.pullRequest}` : change.commit.slice(0, 7);
      const by = change.by ? ` by ${escapeText(change.by)}` : "";
      lines.push(`    ${change.at.slice(0, 10)}  ${escapeText(ref)} ${escapeText(change.title ?? "")}${by}`.trimEnd());
    }
    if (story.moreChanges) lines.push(`    ${count(story.moreChanges, "more change", "more changes")}`);
  }
  if (story.testCount !== undefined) {
    lines.push(`  Tests:     ${count(story.testCount, "tagged test", "tagged tests")}`);
    for (const test of story.tests ?? []) lines.push(`    ${escapeText(test.file)}:${test.line}  ${escapeText(test.name)}`);
    for (const more of story.moreTests ?? []) lines.push(`    ${escapeText(more.file)}: ${count(more.count, "more test", "more tests")}`);
  }
  return lines.join("\n");
}

export const story = defineCommand({
  parse(rest: string[]) {
    const ids: string[] = [];
    const options = parseReadArgs(rest, () => false, ids);
    return options && ids.length ? { ...options, ids } : null;
  },

  async run(options) {
    const view = await loadView(options);
    if (!view) return;
    const { stories, missing } = getStories(view, options.ids);
    if (missing.length) process.exitCode = 1;
    if (options.format === "json") {
      printJson("stories", { stories, ...(missing.length ? { missing } : {}) });
      return;
    }
    if (stories.length) console.log(stories.map(found => storyText(view, found)).join("\n\n"));
    for (const { id, suggestions } of missing) {
      const hint = suggestions.length ? ` Did you mean ${suggestions.map(escapeText).join(", ")}?` : "";
      console.error(`${escapeText(id)}: no story with this ID in ${escapeText(options.map)}.${hint}`);
    }
  },
});

export const stories = defineCommand({
  parse(rest: string[]) {
    const statuses: StoryStatusFilter[] = [];
    const releases: string[] = [];
    const activities: string[] = [];
    const personas: string[] = [];
    const jobs: string[] = [];
    let query: string | undefined;
    let changedWithinDays: ChangedWithinDays | undefined;
    const options = parseReadArgs(rest, (name, value) => {
      if (name === "--status") {
        for (const status of value().split(",").map(part => part.trim()).filter(Boolean)) {
          if (!statusChoices.includes(status)) throw new ArgumentError(`--status must be ${statusChoices.join(", ")}, not ${status}`);
          statuses.push(...(status === "all" ? storyStatuses : [status as StoryStatusFilter]));
        }
      } else if (name === "--release") {
        releases.push(...value().split(",").map(part => part.trim()).filter(Boolean));
      } else if (name === "--activity") {
        activities.push(...value().split(",").map(part => part.trim()).filter(Boolean));
      } else if (name === "--persona") {
        personas.push(...value().split(",").map(part => part.trim()).filter(Boolean));
      } else if (name === "--job") {
        jobs.push(...value().split(",").map(part => part.trim()).filter(Boolean));
      } else if (name === "--query") {
        query = value();
      } else if (name === "--changed-within") {
        const days = value();
        changedWithinDays = changedWithinOptions.find(option => String(option) === days.replace(/d$/, ""));
        if (!changedWithinDays) throw new ArgumentError(`--changed-within must be ${changedWithinOptions.join(", ")} days, not ${days}`);
      } else {
        return false;
      }
      return true;
    });
    return options && { ...options, statuses, releases, activities, personas, jobs, query, changedWithinDays };
  },

  async run(options) {
    const view = await loadView(options);
    if (!view) return;
    let unknown = false;
    const choices = {
      release: view.releases,
      activity: view.activities,
      persona: view.personas ?? [],
      job: (view.personas ?? []).flatMap(persona => persona.jobs),
    };
    const asked = [["release", options.releases], ["activity", options.activities], ["persona", options.personas], ["job", options.jobs]] as const;
    for (const [kind, ids] of asked) {
      const known = new Set(choices[kind].map(item => item.id));
      for (const id of ids.filter(id => !known.has(id))) {
        console.error(`--${kind} ${escapeText(id)}: no ${kind} with this ID in ${escapeText(options.map)}.`);
        unknown = true;
      }
    }
    if (unknown) {
      process.exitCode = 1;
      return;
    }
    if (!view.history && (options.changedWithinDays || options.statuses.includes("stalled"))) {
      console.error(`warning: --${options.changedWithinDays ? "changed-within" : "status stalled"} needs --history, so it is ignored`);
    }
    const found = findStories(view, {
      query: options.query,
      status: options.statuses,
      changedWithinDays: options.changedWithinDays,
      releases: options.releases,
      activities: options.activities,
      ...(options.personas.length ? { persona: options.personas } : {}),
      ...(options.jobs.length ? { job: options.jobs } : {}),
    });
    if (options.format === "json") {
      printJson("stories", { filter: found.filter, stories: found.stories });
      return;
    }
    const idWidth = Math.max(0, ...found.stories.map(item => item.id.length));
    const statusWidth = Math.max(0, ...found.stories.map(item => statusLabel(item).length));
    const releaseWidth = Math.max(0, ...found.stories.map(item => item.release.length));
    for (const item of found.stories) {
      console.log([escapeText(item.id).padEnd(idWidth), statusLabel(item).padEnd(statusWidth), escapeText(item.release).padEnd(releaseWidth), escapeText(item.title)].join("  "));
    }
    const hidden = found.filter.hidden;
    const hiddenText = hidden && [hidden.blocked && `${hidden.blocked} blocked`, hidden.cut && `${hidden.cut} cut`].filter(Boolean).join(" and ");
    console.error(`${count(found.stories.length, "story", "stories")} of ${found.filter.total}${hiddenText ? `; ${hiddenText} hidden, shown with --status all` : ""}`);
  },
});

function releaseText(release: InternalReleaseLabel): string {
  const total = Object.values(release.storyCounts).reduce((sum, n) => sum + n, 0);
  const counts = storyStatuses.filter(status => release.storyCounts[status]).map(status => `${release.storyCounts[status]} ${storyStatusLabels[status].toLowerCase()}`);
  const lines = [`${escapeText(release.id)}  ${escapeText(release.title)}`];
  field(lines, "Stories", `${total}${counts.length ? ` (${counts.join(", ")})` : ""}`);
  if (release.estimates) {
    field(lines, "Estimate", releaseEstimatesText(release.estimates));
  }
  field(lines, "Summary", release.summary);
  field(lines, "Notes", release.notes);
  if (release.impact?.length) {
    lines.push("  Impact:");
    for (const item of release.impact) {
      lines.push(`    ${item.draft ? "[draft] " : ""}${escapeText(item.metric)}`);
      lines.push(`      Expected: ${escapeText(item.expected)}`);
      if (item.solves) lines.push(`      Solves:   ${escapeText(item.solves)}`);
      if (item.actual) lines.push(`      Actual:   ${escapeText(item.actual)}`);
    }
  }
  return lines.join("\n");
}

export const releases = defineCommand({
  parse(rest: string[]) {
    const ids: string[] = [];
    const options = parseReadArgs(rest, () => false, ids);
    return options && { ...options, ids };
  },

  async run(options) {
    const view = await loadView(options);
    if (!view) return;
    const known = new Set(view.releases.map(release => release.id));
    const missing = options.ids.filter(id => !known.has(id));
    const chosen = options.ids.length ? view.releases.filter(release => options.ids.includes(release.id)) : view.releases;
    if (missing.length) process.exitCode = 1;
    if (options.format === "json") {
      printJson("releases", { releases: chosen, ...(missing.length ? { missing } : {}) });
      return;
    }
    if (chosen.length) console.log(chosen.map(releaseText).join("\n\n"));
    for (const id of missing) console.error(`${escapeText(id)}: no release with this ID in ${escapeText(options.map)}.`);
  },
});
