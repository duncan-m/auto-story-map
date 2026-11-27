import { posix } from "node:path";
import { planSource, storyNeighbours } from "./brief.js";
import { slugify } from "./references.js";
import type { InternalStoryCard, StoryMapView } from "./view.js";

type InternalView = Extract<StoryMapView, { audience: "internal" }>;

/** The folder a plan goes in when the map has not chosen one. */
export const defaultPlansFolder = "docs/plans";

/** What `storyMapPlan` scaffolds: stories by ID, in build order, or every planned and in-progress story in a release. */
export type StoryMapPlanRequest = { stories: readonly string[] } | { release: string };

export interface StoryMapPlanOptions {
  /** The folder the plan will go in, so links to other plans are relative to it. Defaults to `docs/plans`. */
  plansFolder?: string;
}

/** A plan skeleton and where to save it. */
export interface StoryMapPlanSkeleton {
  /** The plan as Markdown, ready to fill in. */
  markdown: string;
  /** A suggested path for the plan, in the plans folder. */
  path: string;
  /** The stories it covers, in order. */
  stories: string[];
}

// Map text goes into Markdown, so keep each value on one line.
const line = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Builds a delivery plan skeleton for the stories asked for, in the structure from
 * Write a delivery plan in the guide: a status line, a numbered item for each story,
 * the stories it builds on and overlaps (chosen as `storyMapBrief` chooses them), empty
 * UI mockup, Decisions to make and Not now sections, and an effort table with the
 * agreed estimates. It reads the map only and never sets an estimate.
 *
 * Takes the unfiltered internal view from `getStoryMapForViewer`. Throws a `TypeError`
 * for a customer view and a `RangeError` for a story or release that is not in it, or a
 * release with no planned or in-progress stories.
 */
export function storyMapPlan(view: StoryMapView, request: StoryMapPlanRequest, options: StoryMapPlanOptions = {}): StoryMapPlanSkeleton {
  if (view.audience !== "internal") throw new TypeError("Only the internal view has plans: a plan carries internal notes and estimates.");
  const folder = trimSlashes(options.plansFolder ?? defaultPlansFolder) || ".";
  const targets = pickTargets(view, request);
  const releaseIds = [...new Set(targets.map(story => story.release))];
  const releaseTitle = (id: string) => view.releases.find(release => release.id === id)?.title ?? id;
  const title = "release" in request
    ? releaseTitle(request.release)
    : targets.length === 1 ? targets[0]!.title : releaseIds.length === 1 ? releaseTitle(releaseIds[0]!) : targets[0]!.title;

  const ids = targets.map(story => story.id);
  const releases = releaseIds.map(id => `**${line(releaseTitle(id))}**`);
  const estimated = targets.filter(story => story.estimate !== undefined).length;
  const estimates = estimated === targets.length
    ? "Every story has an agreed estimate."
    : estimated === 0 ? targets.length === 1 ? "It has no agreed estimate yet." : "None has an agreed estimate yet." : `${estimated} of ${targets.length} have an agreed estimate.`;
  const items = targets.map((story, index) => ({ story, heading: `${index + 1}. ${line(story.title)}` }));

  const link = (story: InternalStoryCard) => {
    const source = planSource(story.sources);
    if (!source) return `**${story.id}**, ${line(story.title)}`;
    const [file, fragment] = source.split("#", 2);
    const target = /^[a-z][a-z0-9+.-]*:/i.test(file!) ? file! : posix.relative(folder, file!) || posix.basename(file!);
    return `**${story.id}**, [${line(story.title)}](${target}#${fragment})`;
  };
  const taken = new Set(ids);
  const built: InternalStoryCard[] = [];
  const overlapping: InternalStoryCard[] = [];
  for (const story of targets) {
    const nearby = storyNeighbours(view, story);
    for (const [list, found] of [[built, nearby.built], [overlapping, nearby.notYet]] as const) {
      for (const candidate of found) {
        if (taken.has(candidate.id)) continue;
        taken.add(candidate.id);
        list.push(candidate);
      }
    }
  }
  const none = "- None found nearby. Search with `story-map stories --query <text> --status all` before you add one.";

  const total = targets.reduce((sum, story) => sum + (story.estimate ?? 0), 0);
  const totalText = estimated === 0 ? "not agreed" : estimated === targets.length ? `${total}` : `${total}, plus ${targets.length - estimated} not agreed`;

  const markdown = [
    `# Plan: ${line(title)}`,
    "",
    `Status: proposed. The work is ${listWords(ids)} in the ${listWords(releases)} release${releases.length === 1 ? "" : "s"} of the map. ${estimates}`,
    "",
    "<!-- Why: the problem, and who has it, in a short paragraph. -->",
    "",
    "Items are numbered in the order they should be built:",
    "",
    ...items.map(({ story, heading }, index) => `${index + 1}. [${line(story.title)}](#${slugify(heading)}) (${story.id})`),
    "",
    "## What it builds on",
    "",
    "Merged or shipped:",
    "",
    ...(built.length ? built.map(story => `- ${link(story)}: <!-- what this work reuses from it -->`) : [none]),
    "",
    "Planned, and overlapping:",
    "",
    ...(overlapping.length ? overlapping.map(story => `- ${link(story)}: <!-- how it overlaps, and which lands first -->`) : [none]),
    "",
    ...items.flatMap(({ story, heading }) => [
      `## ${heading}`,
      "",
      `${story.id}. ${story.summary ? line(story.summary) : "<!-- What this item delivers. -->"} <!-- Rewrite: what it changes, and how you will know it works. -->`,
      "",
    ]),
    "## UI mockup",
    "",
    "<!-- When the work adds or changes UI: an HTML mockup built on the product's real styles and markup, using stories from the map, a PNG of it, and how to regenerate the image. Link this section from each story it shows. Otherwise say there is no mockup, and why. -->",
    "",
    "## Decisions to make",
    "",
    "| Question | Proposal |",
    "| --- | --- |",
    "| <!-- A. An open question --> | <!-- What you propose, so a reviewer can agree or change it in one line --> |",
    "",
    "## Not now",
    "",
    "- <!-- What was considered and left out, and why. -->",
    "",
    "## Effort and release fit",
    "",
    "| Story | Points |",
    "| --- | --- |",
    ...targets.map(story => `| ${story.id}: ${line(story.title).replace(/[\\|]/g, "\\$&")} | ${story.estimate ?? "not agreed"} |`),
    `| **Total** | **${totalText}** |`,
    "",
    "<!-- Which stories could move to another release, and why. -->",
    "",
  ].join("\n");

  return { markdown, path: `${folder === "." ? "" : `${folder}/`}${slugify(line(title)) || "plan"}.md`, stories: ids };
}

function pickTargets(view: InternalView, request: StoryMapPlanRequest): InternalStoryCard[] {
  if ("release" in request) {
    if (!view.releases.some(release => release.id === request.release)) throw new RangeError(`Release ${request.release} is not in the map.`);
    const found = view.stories.filter(story => story.release === request.release && (story.status === "planned" || story.status === "in-progress"));
    if (!found.length) throw new RangeError(`Release ${request.release} has no planned or in-progress stories.`);
    return found;
  }
  if (!request.stories.length) throw new RangeError("Name at least one story.");
  return [...new Set(request.stories)].map(id => {
    const story = view.stories.find(candidate => candidate.id === id);
    if (!story) throw new RangeError(`Story ${id} is not in the map.`);
    return story;
  });
}

function listWords(words: readonly string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Drops trailing slashes without a regular expression, which could be slow on a long run of them. */
function trimSlashes(path: string) {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}
