import type { StoryEvidence } from "./evidence.js";
import { jobStatement } from "./personas.js";
import { isActiveStatus } from "./status.js";
import type { InternalReleaseLabel, InternalStoryCard, PersonaJobLabel, PersonaLabel, StoryMapLabel, StoryMapView } from "./view.js";

/** A document the brief asks the agent to read before it changes anything. */
export interface StoryMapBriefDocument {
  /** A path in the repository, such as `docs/ENGINEERING-OVERVIEW.md`, or a link. */
  path: string;
  /** What the agent will find there, such as "architecture and the behaviour to preserve". */
  about?: string;
}

export interface StoryMapBriefOptions {
  /** The map file, relative to the repository root. Defaults to `product/story-map.yaml`. */
  mapPath?: string;
  /** Documents to read first, in order. The brief also links each target's plan. Defaults to none. */
  readFirst?: readonly StoryMapBriefDocument[];
  /** The command that validates the map. Defaults to `npx story-map validate <mapPath>`. */
  validateCommand?: string;
  /** The command that runs the tests. Defaults to `npm test`. */
  testCommand?: string;
  /** The branch the pull request goes into, for the `story-map diff` summary. Defaults to `main`. */
  baseBranch?: string;
  /**
   * Puts each target's notes, persona context and every tagged test in the brief,
   * for agents that cannot run commands to fetch them. Defaults to false.
   */
  full?: boolean;
  /**
   * What `gatherStoryEvidence` found for the targets, such as branches, commits,
   * claims and broken sources, for the brief's in-flight section. The brief never
   * reads Git itself. Stories that are not targets are ignored.
   */
  evidence?: readonly StoryEvidence[];
}

/**
 * What a brief covers: one story, several stories, a release's open stories, or an
 * activity's open stories, each by its ID.
 */
export type StoryMapBriefTarget = { story: string } | { stories: readonly string[] } | { release: string } | { activity: string };

/** What to brief and how. */
export type StoryMapBriefRequest = StoryMapBriefTarget & StoryMapBriefOptions;

/** The brief's tagged sections, each as its lines without the tags. A section with no lines is left out of the brief. */
export interface StoryMapBriefSections {
  rules: string[];
  target: string[];
  context: string[];
  in_flight: string[];
  open_decisions: string[];
  done_when: string[];
}

/** A brief with its parts, as `story-map brief --format json` prints it. */
export interface StoryMapBriefResult {
  scope: "story" | "stories" | "release" | "activity";
  /** The story, release or activity IDs the brief was asked for. */
  for: string[];
  /** The stories the agent is asked to build, in the brief's order. */
  targets: string[];
  /** The branch the brief names. */
  branch: string;
  /** The line before the brief's tagged sections. */
  intro: string;
  /** Each section's lines, with text from the map escaped as in the brief. */
  sections: StoryMapBriefSections;
  /** The whole brief as Markdown, the same text `storyMapBrief` returns. */
  brief: string;
}

/** Most bytes in a story brief before its "Already built" and "Not yet" lists are cut down. */
export const storyBriefMaxBytes = 4 * 1024;
/** Most bytes in a release brief before its "Already built" and "Not yet" lists are cut down. */
export const releaseBriefMaxBytes = 16 * 1024;
/** Most characters in a branch name the brief suggests. */
export const briefBranchMaxLength = 50;
/** Most merged or shipped stories a story brief lists as already built in its activity. */
export const briefBuiltNearbyMaxItems = 5;

const testsPerTarget = 5;
const branchesPerTarget = 3;
const changesPerTarget = 3;

// Words left out of branch names, so they keep the words that say what the work is.
const branchStopWords = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "from", "with", "by", "at", "as", "is", "be", "it", "its", "so", "that", "this", "into"]);
const branchWords = 3;

/**
 * Suggests a branch for the work, following the naming rule in `AGENTS.md`:
 * `feat/<ID>-<first words of the title>`, such as `feat/esm-111-show-edit-command`.
 * Lower case, letters, digits and hyphens only, at most 50 characters. Short words
 * such as "the" and "in" are skipped, and a release title's leading version, such as
 * "0.7.5:", is dropped because the release ID already has it.
 */
export function storyMapBriefBranch(id: string, title: string): string {
  // Splitting on runs of other characters, rather than trimming hyphens with a regex, stays linear on any input.
  const slugWords = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let branch = `feat/${slugWords(id).join("-") || "work"}`.slice(0, briefBranchMaxLength);
  while (branch.endsWith("-")) branch = branch.slice(0, -1);
  const words = slugWords(title.replace(/^\s*v?\d+(?:\.\d+)*\s*:\s*/i, "")).filter(word => !branchStopWords.has(word));
  for (const word of words.slice(0, branchWords)) {
    if (branch.length + 1 + word.length > briefBranchMaxLength) break;
    branch += `-${word}`;
  }
  return branch;
}

/**
 * Makes text from the map safe to put in the brief: one line, with `&`, `<` and `>`
 * escaped, so a title or summary cannot close a section, open one or start a line
 * that reads as a rule.
 */
function safe(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attribute(text: string): string {
  return safe(text).replace(/"/g, "&quot;");
}

/** A command or path in backticks, with any backtick in it removed so it cannot end the code span. */
function code(text: string): string {
  return `\`${safe(text).replace(/`/g, "")}\``;
}

/** The first Markdown link with a #heading, the same rule as the board's Engineering overview link. */
export function planSource(sources: readonly string[] | undefined): string | undefined {
  return sources?.find(source => {
    if (/\s/.test(source) || !/#./.test(source)) return false;
    return /\.md$/i.test(source.split("#")[0]!.split("?")[0]!);
  });
}

/** Last change time in ms, or -Infinity when the history does not say. */
function changedAt(story: InternalStoryCard) {
  const at = Date.parse(story.lastEdit?.at ?? story.lastChangedAt ?? "");
  return Number.isNaN(at) ? -Infinity : at;
}

const isBuilt = (story: InternalStoryCard) => story.status === "merged" || story.status === "shipped";

type InternalView = Extract<StoryMapView, { audience: "internal" }>;

interface Neighbour {
  story: InternalStoryCard;
  where: string;
}

interface BriefParts {
  scope: StoryMapBriefResult["scope"];
  for: string[];
  branch: string;
  intro: string;
  attributes: string;
  rules: string[];
  targets: InternalStoryCard[];
  built: Neighbour[];
  builtLabel: string;
  notYet: Neighbour[];
  decisions: string[];
  doneWhen: string[];
  maxBytes: number;
}

function storyLine(entry: Neighbour) {
  return `- ${entry.story.id} (${entry.story.status}${entry.where ? `, ${entry.where}` : ""})  ${safe(entry.story.title)}`;
}

function list(entries: readonly Neighbour[], keep: number) {
  const lines = entries.slice(0, keep).map(storyLine);
  const left = entries.length - Math.min(keep, entries.length);
  if (left > 0) lines.push(`- ${left} more not listed. Run \`npx story-map stories\` to see them.`);
  return lines;
}

/**
 * Writes a handoff brief for a coding agent: a compact Markdown prompt with tagged
 * sections for the rules, the target stories, the work already built nearby, what not
 * to build yet, work already in flight, open decisions and when the work is done. It
 * points to files and commands instead of copying them, because the agent can read
 * the repository.
 *
 * Pass `{ story: "ESM-111" }` for one story, or `{ release: "v0-7-6" }` for every
 * planned and in-progress story in a release. Takes the unfiltered internal view from
 * `getStoryMapForViewer`, with the history and tests index when the host has them, so
 * the brief can list the tests and changes that already name each target. Throws a
 * `TypeError` for a customer view or a filtered view, because a brief carries internal
 * notes, estimates and draft jobs, and a `RangeError` when the story or release is not
 * in the view.
 */
export function storyMapBrief(view: StoryMapView, request: StoryMapBriefRequest): string {
  return storyMapBriefDetails(view, request).brief;
}

/**
 * Writes the same brief as `storyMapBrief`, with its parts: the scope, the target
 * story IDs, the branch and each section's lines. `story-map brief --format json`
 * prints it. Pass `{ stories: [...] }` for several stories, or `{ activity }` for an
 * activity's planned and in-progress stories, as well as the scopes `storyMapBrief`
 * takes. Throws as `storyMapBrief` does.
 */
export function storyMapBriefDetails(view: StoryMapView, request: StoryMapBriefRequest): StoryMapBriefResult {
  if (view.audience !== "internal") {
    throw new TypeError("Only the internal view has briefs. A brief carries internal notes, estimates and draft jobs.");
  }
  if (view.filter) {
    throw new TypeError("Brief from the unfiltered view from getStoryMapForViewer: a brief lists the stories around its target.");
  }
  const mapPath = request.mapPath ?? "product/story-map.yaml";
  const options: ResolvedOptions = {
    mapPath,
    readFirst: request.readFirst,
    validateCommand: request.validateCommand ?? `npx story-map validate ${mapPath}`,
    testCommand: request.testCommand ?? "npm test",
    baseBranch: request.baseBranch ?? "main",
    full: request.full ?? false,
    evidence: new Map((request.evidence ?? []).map(found => [found.id, found])),
  };
  const parts = "story" in request ? storyParts(view, request.story, options)
    : "stories" in request ? storiesParts(view, request.stories, options)
      : "release" in request ? releaseParts(view, request.release, options)
        : activityParts(view, request.activity, options);
  const { brief, sections } = render(view, parts, options);
  return { scope: parts.scope, for: parts.for, targets: parts.targets.map(story => story.id), branch: parts.branch, intro: parts.intro, sections, brief };
}

interface ResolvedOptions {
  mapPath: string;
  readFirst?: readonly StoryMapBriefDocument[];
  validateCommand: string;
  testCommand: string;
  baseBranch: string;
  full: boolean;
  evidence: ReadonlyMap<string, StoryEvidence>;
}

function releaseIndexes(view: InternalView) {
  return new Map(view.releases.map((release, index) => [release.id, index]));
}

/**
 * The stories around one story, as a brief chooses them: up to five merged or shipped
 * stories in its activity, most recently changed first, to reuse, and the planned
 * stories in its activity in the same or a later release, to leave alone. `story-map plan`
 * uses the same choice for a plan's What it builds on.
 */
export function storyNeighbours(view: InternalView, story: InternalStoryCard): { built: InternalStoryCard[]; notYet: InternalStoryCard[] } {
  const releaseOrder = releaseIndexes(view);
  const order = releaseOrder.get(story.release) ?? 0;
  const neighbours = view.stories.map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate !== story && candidate.activity === story.activity);
  const built = neighbours.filter(({ candidate }) => isBuilt(candidate))
    .sort((a, b) => changedAt(b.candidate) - changedAt(a.candidate) || b.index - a.index)
    .slice(0, briefBuiltNearbyMaxItems)
    .map(({ candidate }) => candidate);
  const notYet = neighbours.filter(({ candidate }) => candidate.status === "planned" && (releaseOrder.get(candidate.release) ?? 0) >= order)
    .sort((a, b) => (releaseOrder.get(a.candidate.release) ?? 0) - (releaseOrder.get(b.candidate.release) ?? 0) || a.index - b.index)
    .map(({ candidate }) => candidate);
  return { built, notYet };
}

function storyParts(view: InternalView, id: string, options: ResolvedOptions): BriefParts {
  const story = view.stories.find(candidate => candidate.id === id);
  if (!story) throw new RangeError(`Story ${id} is not in the map.`);
  const releaseTitle = (releaseId: string) => releaseId === story.release ? "same release" : `release ${releaseId}`;
  const nearby = storyNeighbours(view, story);
  const built = nearby.built.map(candidate => ({ story: candidate, where: "" }));
  const notYet = nearby.notYet.map(candidate => ({ story: candidate, where: releaseTitle(candidate.release) }));

  const branch = storyMapBriefBranch(story.id, story.title);
  const rules = [
    "Follow AGENTS.md. It covers the story map, branch, commit, PR and test-naming rules.",
    ...(story.status === "planned"
      ? [`Before your first code change, run \`npx story-map edit ${story.id} --status in-progress --write\` and commit the change with your work.`]
      : []),
    `Branch: \`${branch}\`. Name ${story.id} in every commit, and start the PR title with "${story.id}: ".`,
    `Start each new test's name with "${story.id}: ".`,
    "Build only the target story. Stories under \"Not yet\" are out of scope.",
    "Do not set or change an estimate. Ask before you remove `draft` from anything.",
  ];

  const decisions = targetDecisions(view, [story]);
  if (story.status !== "planned" && story.status !== "in-progress") {
    decisions.unshift(`${story.id} is ${story.status}${story.statusReason ? `: ${safe(story.statusReason)}` : ""}. Check with a person before you start work on it.`);
  }
  decisions.push(...blockedInRelease(view, story.release, new Set([story.id])));

  const plan = planSource(story.sources);
  return {
    scope: "story",
    for: [story.id],
    branch,
    intro: `Build story ${story.id} from the ${safe(view.title)} story map in this repository. Read the files linked below before you change anything.`,
    attributes: `map="${attribute(options.mapPath)}" scope="story" target="${attribute(story.id)}"`,
    rules,
    targets: [story],
    built,
    builtLabel: "Already built in this activity. Reuse it, do not rebuild it:",
    notYet,
    decisions,
    doneWhen: [
      plan
        ? `Every point in the linked plan section is met, with tests named "${story.id}: …".`
        : `The summary above is met, with tests named "${story.id}: …".`,
      `${code(options.validateCommand)} and ${code(options.testCommand)} pass.`,
      `The PR description includes the \`npx story-map diff origin/${safe(options.baseBranch).replace(/`/g, "")}\` summary.`,
    ],
    maxBytes: storyBriefMaxBytes,
  };
}

function releaseParts(view: InternalView, id: string, options: ResolvedOptions): BriefParts {
  const index = view.releases.findIndex(release => release.id === id);
  if (index < 0) throw new RangeError(`Release ${id} is not in the map.`);
  const release = view.releases[index]!;
  const before = view.releases[index - 1];
  const after = view.releases[index + 1];
  const activityOrder = new Map(view.activities.map((activity, position) => [activity.id, position]));
  const inRelease = (releaseId: string | undefined) => view.stories.map((story, position) => ({ story, position }))
    .filter(({ story }) => releaseId !== undefined && story.release === releaseId)
    .sort((a, b) => (activityOrder.get(a.story.activity) ?? 0) - (activityOrder.get(b.story.activity) ?? 0) || a.position - b.position)
    .map(({ story }) => story);

  const stories = inRelease(release.id);
  const targets = stories.filter(story => story.status === "planned" || story.status === "in-progress");
  const built = [
    ...stories.filter(isBuilt).map(story => ({ story, where: "same release" })),
    ...inRelease(before?.id).filter(isBuilt).map(story => ({ story, where: `release ${before!.id}` })),
  ];
  const notYet = inRelease(after?.id).filter(story => story.status === "planned").map(story => ({ story, where: `release ${after!.id}` }));

  const example = targets[0]?.id ?? "<ID>";
  const branch = storyMapBriefBranch(release.id, release.title);
  const rules = manyRules(branch, example);

  const decisions = targetDecisions(view, targets);
  decisions.push(...blockedInRelease(view, release.id, new Set()));
  if (!targets.length) decisions.unshift(`Release ${release.id} has no planned or in-progress stories. Check with a person before you start work on it.`);

  return {
    scope: "release",
    for: [release.id],
    branch,
    intro: `Build release ${release.id} (${safe(release.title)}) from the ${safe(view.title)} story map in this repository. Read the files linked below before you change anything.`,
    attributes: `map="${attribute(options.mapPath)}" scope="release" target="${attribute(release.id)}"`,
    rules,
    targets,
    built,
    builtLabel: "Already built. Reuse it, do not rebuild it:",
    notYet,
    decisions,
    doneWhen: manyDoneWhen(options),
    maxBytes: releaseBriefMaxBytes,
  };
}

/** The rules for a brief with several target stories, from a list, a release or an activity. */
function manyRules(branch: string, example: string) {
  return [
    "Follow AGENTS.md. It covers the story map, branch, commit, PR and test-naming rules.",
    `When you start work on a story, run \`npx story-map edit <ID> --status in-progress --write\` for that story and commit the change with your work. Do not mark them all at once.`,
    `Branch: \`${branch}\`. Name the story IDs in every commit, and start the PR title with the story ID when it covers one story, such as "${example}: ".`,
    `Start each new test's name with the ID of the story it covers, such as "${example}: ".`,
    "Build only the target stories. Stories under \"Not yet\" are out of scope.",
    "Do not set or change an estimate. Ask before you remove `draft` from anything.",
  ];
}

function manyDoneWhen(options: ResolvedOptions) {
  return [
    "Every point in each target's linked plan section is met, with tests named after the story they cover.",
    `${code(options.validateCommand)} and ${code(options.testCommand)} pass.`,
    `The PR description includes the \`npx story-map diff origin/${safe(options.baseBranch).replace(/`/g, "")}\` summary.`,
  ];
}

function storiesParts(view: InternalView, ids: readonly string[], options: ResolvedOptions): BriefParts {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new RangeError("Name at least one story to brief.");
  if (unique.length === 1) return storyParts(view, unique[0]!, options);
  const targets = unique.map(id => {
    const found = view.stories.find(candidate => candidate.id === id);
    if (!found) throw new RangeError(`Story ${id} is not in the map.`);
    return found;
  });
  const chosen = new Set(unique);
  const seen = new Set<string>();
  const built: Neighbour[] = [];
  const notYet: Neighbour[] = [];
  for (const story of targets) {
    const nearby = storyNeighbours(view, story);
    for (const candidate of nearby.built) {
      if (chosen.has(candidate.id) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      built.push({ story: candidate, where: "" });
    }
    for (const candidate of nearby.notYet) {
      if (chosen.has(candidate.id) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      notYet.push({ story: candidate, where: `release ${candidate.release}` });
    }
  }
  const first = targets[0]!;
  const branch = storyMapBriefBranch(first.id, first.title);
  const decisions = targetDecisions(view, targets);
  for (const story of [...targets].reverse()) {
    if (story.status !== "planned" && story.status !== "in-progress") {
      decisions.unshift(`${story.id} is ${story.status}${story.statusReason ? `: ${safe(story.statusReason)}` : ""}. Check with a person before you start work on it.`);
    }
  }
  for (const release of new Set(targets.map(story => story.release))) decisions.push(...blockedInRelease(view, release, chosen));
  return {
    scope: "stories",
    for: unique,
    branch,
    intro: `Build stories ${joinWords(unique.map(safe))} from the ${safe(view.title)} story map in this repository. Read the files linked below before you change anything.`,
    attributes: `map="${attribute(options.mapPath)}" scope="stories" target="${attribute(unique.join(" "))}"`,
    rules: manyRules(branch, first.id),
    targets,
    built,
    builtLabel: "Already built in these activities. Reuse it, do not rebuild it:",
    notYet,
    decisions,
    doneWhen: manyDoneWhen(options),
    maxBytes: releaseBriefMaxBytes,
  };
}

function activityParts(view: InternalView, id: string, options: ResolvedOptions): BriefParts {
  const activity = view.activities.find(candidate => candidate.id === id);
  if (!activity) throw new RangeError(`Activity ${id} is not in the map.`);
  const releaseOrder = releaseIndexes(view);
  const stories = view.stories.map((story, position) => ({ story, position }))
    .filter(({ story }) => story.activity === activity.id);
  const targets = stories.filter(({ story }) => story.status === "planned" || story.status === "in-progress")
    .sort((a, b) => (releaseOrder.get(a.story.release) ?? 0) - (releaseOrder.get(b.story.release) ?? 0) || a.position - b.position)
    .map(({ story }) => story);
  const built = stories.filter(({ story }) => isBuilt(story))
    .sort((a, b) => changedAt(b.story) - changedAt(a.story) || b.position - a.position)
    .map(({ story }) => ({ story, where: `release ${story.release}` }));
  const branch = storyMapBriefBranch(activity.id, activity.title);
  const decisions = targetDecisions(view, targets);
  decisions.push(...stories.filter(({ story }) => story.status === "blocked")
    .map(({ story }) => `${story.id} in the same activity is blocked${story.statusReason ? `: ${safe(story.statusReason)}` : ""}. Do not build it, and do not depend on it.`));
  if (!targets.length) decisions.unshift(`Activity ${activity.id} has no planned or in-progress stories. Check with a person before you start work on it.`);
  return {
    scope: "activity",
    for: [activity.id],
    branch,
    intro: `Build the open stories in activity ${activity.id} (${safe(activity.title)}) from the ${safe(view.title)} story map in this repository, earliest release first. Read the files linked below before you change anything.`,
    attributes: `map="${attribute(options.mapPath)}" scope="activity" target="${attribute(activity.id)}"`,
    rules: manyRules(branch, targets[0]?.id ?? "<ID>"),
    targets,
    built,
    builtLabel: "Already built in this activity. Reuse it, do not rebuild it:",
    notYet: [],
    decisions,
    doneWhen: manyDoneWhen(options),
    maxBytes: releaseBriefMaxBytes,
  };
}

function jobLabels(view: InternalView) {
  const jobs = new Map<string, { job: PersonaJobLabel; persona: PersonaLabel }>();
  for (const persona of view.personas ?? []) {
    for (const job of persona.jobs) if (!jobs.has(job.id)) jobs.set(job.id, { job, persona });
  }
  return jobs;
}

function targetDecisions(view: InternalView, targets: readonly InternalStoryCard[]): string[] {
  const jobs = jobLabels(view);
  const drafts = [...new Set(targets.flatMap(story => story.jobs ?? []))].filter(id => jobs.get(id)?.job.draft);
  const decisions: string[] = [];
  if (drafts.length) {
    decisions.push(`${drafts.length === 1 ? "Job" : "Jobs"} ${joinWords(drafts.map(safe))} ${drafts.length === 1 ? "is" : "are"} draft. Treat ${drafts.length === 1 ? "it" : "them"} as intent, not agreed scope.`);
  }
  for (const story of targets) {
    if (!isActiveStatus(story.status) || isBuilt(story)) continue;
    if (story.estimate === undefined) decisions.push(`${story.id} has no agreed estimate. Do not set one. Flag it in the PR.`);
    if (!planSource(story.sources)) decisions.push(`${story.id} has no plan linked in its sources. Ask what done means before you build more than its summary.`);
  }
  return decisions;
}

function blockedInRelease(view: InternalView, releaseId: string, skip: ReadonlySet<string>): string[] {
  return view.stories
    .filter(story => story.release === releaseId && story.status === "blocked" && !skip.has(story.id))
    .map(story => `${story.id} in the same release is blocked${story.statusReason ? `: ${safe(story.statusReason)}` : ""}. Do not build it, and do not depend on it.`);
}

function joinWords(words: readonly string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function targetLines(view: InternalView, story: InternalStoryCard, full: boolean): string[] {
  const releases = new Map<string, InternalReleaseLabel>(view.releases.map(release => [release.id, release]));
  const activities = new Map<string, StoryMapLabel>(view.activities.map(activity => [activity.id, activity]));
  const personas = new Map((view.personas ?? []).map(persona => [persona.id, persona]));
  const jobs = jobLabels(view);
  const release = releases.get(story.release);
  const activity = activities.get(story.activity);
  const facts = [
    `status: ${story.status}`,
    `release: ${story.release}${release ? ` (${safe(release.title)})` : ""}`,
    `activity: ${story.activity}${activity ? ` (${safe(activity.title)})` : ""}`,
    `estimate: ${story.estimate === undefined ? "none" : `${story.estimate} ${story.estimate === 1 ? "pt" : "pts"}`}`,
  ];
  const lines = [`${story.id}  ${safe(story.title)}`, `  ${facts.join(" · ")}`];
  if (story.summary) lines.push(`  summary: ${safe(story.summary)}`);
  if (full && story.notes) lines.push(`  notes: ${safe(story.notes)}`);
  const plan = planSource(story.sources);
  if (plan) lines.push(`  plan: ${safe(plan)}`);
  const others = (story.sources ?? []).filter(source => source !== plan);
  if (others.length) lines.push(`  sources: ${others.map(safe).join(", ")}`);
  const who = (story.personas ?? []).map(id => `${safe(id)}${personas.get(id) ? ` (${safe(personas.get(id)!.title)})` : ""}`);
  const jobText = (story.jobs ?? []).map(id => `${safe(id)}${jobs.get(id)?.job.core ? " (core job)" : ""}`);
  if (who.length || jobText.length) {
    lines.push(`  ${[who.length ? `for: ${who.join(", ")}` : "", jobText.length ? `jobs: ${jobText.join(", ")}` : ""].filter(Boolean).join(" · ")}`);
  }
  if (full) {
    for (const id of story.personas ?? []) {
      const context = personas.get(id)?.context;
      if (!context) continue;
      const facts = [
        context.success ? `success: ${safe(context.success)}` : "",
        context.usesToday?.length ? `uses today: ${context.usesToday.map(safe).join(", ")}` : "",
        context.constraints?.length ? `constraints: ${context.constraints.map(safe).join("; ")}` : "",
      ].filter(Boolean);
      if (facts.length) lines.push(`  persona ${safe(id)}: ${facts.join(" · ")}`);
    }
    for (const id of story.jobs ?? []) {
      const found = jobs.get(id);
      if (found) lines.push(`  job ${safe(id)}: ${safe(jobStatement(found.job))}${found.job.draft ? " (draft)" : ""}`);
    }
  }
  lines.push(`  details: npx story-map story ${story.id}`);
  return lines;
}

function inFlightLines(story: InternalStoryCard, options: ResolvedOptions): string[] {
  const found = options.evidence.get(story.id);
  // The tests index is the board's list. Without one, the tests evidence found in the checkout stand in.
  const tests: { kind?: string; file: string; line: number; name: string }[] = story.tests?.length ? story.tests : found?.tests ?? [];
  const keepTests = options.full ? Infinity : testsPerTarget;
  const moreTests = (story.tests?.length ? (story.moreTests ?? []).reduce((sum, entry) => sum + entry.count, 0) : found?.moreTests ?? 0)
    + Math.max(0, tests.length - keepTests);
  const lines: string[] = [];
  if (found?.claim) {
    const claim = found.claim;
    lines.push(claim.problem
      ? `  - claim: unreadable, ${safe(claim.problem)}`
      : `  - claim: ${safe(claim.agent)}${claim.branch ? ` on ${safe(claim.branch)}` : ""}, ${claim.expired ? "expired" : "expires"} ${safe(claim.expiresAt.slice(0, 16))}${claim.stale ? ", stale" : ""}`);
  }
  for (const branch of (found?.branches ?? []).slice(0, branchesPerTarget)) {
    lines.push(`  - branch ${safe(branch.name)} (${safe(branch.commit.slice(0, 7))}, ${safe(branch.committedAt.slice(0, 10))}${branch.merged ? ", merged" : ""})`);
  }
  const moreBranches = Math.max(0, (found?.branches.length ?? 0) - branchesPerTarget);
  if (moreBranches) lines.push(`  - ${moreBranches} more ${moreBranches === 1 ? "branch" : "branches"}`);
  for (const entry of tests.slice(0, keepTests)) lines.push(`  - ${entry.kind ?? "test"}: ${safe(entry.file)}:${entry.line}  ${safe(entry.name)}`);
  if (moreTests) lines.push(`  - ${moreTests} more tagged ${moreTests === 1 ? "test" : "tests"}`);
  // Git is the fresher record of the commits, so evidence replaces the history file's changes when it has some.
  if (found?.commits.length) {
    for (const commit of found.commits.slice(0, changesPerTarget)) {
      const label = commit.pullRequest ? `pull request #${commit.pullRequest}` : "commit";
      lines.push(`  - ${label} ${safe(commit.commit.slice(0, 7))} on ${safe(commit.committedAt.slice(0, 10))}  ${safe(commit.subject)}`);
    }
    const more = (found.moreCommits ?? 0) + Math.max(0, found.commits.length - changesPerTarget);
    if (more) lines.push(`  - ${more} more ${more === 1 ? "commit" : "commits"}`);
  } else {
    const changes = story.changes ?? [];
    for (const change of changes.slice(0, changesPerTarget)) {
      const label = change.pullRequest ? `pull request #${change.pullRequest}` : "commit";
      lines.push(`  - ${label} ${safe(change.commit.slice(0, 7))} on ${safe(change.at.slice(0, 10))}${change.title ? `  ${safe(change.title)}` : ""}`);
    }
    const moreChanges = (story.moreChanges ?? 0) + Math.max(0, changes.length - changesPerTarget);
    if (moreChanges) lines.push(`  - ${moreChanges} more ${moreChanges === 1 ? "change" : "changes"}`);
  }
  for (const source of found?.brokenSources ?? []) lines.push(`  - broken source: ${safe(source.source)}, ${safe(source.message)}`);
  return lines.length ? [`${story.id}:`, ...lines] : [];
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

function render(view: InternalView, parts: BriefParts, options: ResolvedOptions): { brief: string; sections: StoryMapBriefSections } {
  const write = (keepBuilt: number, keepNotYet: number) => {
    const text: string[] = [parts.intro, "", `<brief ${parts.attributes}>`, ""];
    const sections = {} as StoryMapBriefSections;
    const section = (tag: keyof StoryMapBriefSections, lines: string[]) => {
      sections[tag] = lines;
      if (lines.length) text.push(`<${tag}>`, ...lines, `</${tag}>`, "");
    };
    section("rules", parts.rules.map(rule => `- ${rule}`));
    section("target", parts.targets.flatMap((story, index) => [...(index ? [""] : []), ...targetLines(view, story, options.full)]));

    const context: string[] = [];
    if (options.readFirst?.length) {
      context.push("Read first:", ...options.readFirst.map(doc => `- ${safe(doc.path)}${doc.about ? `: ${safe(doc.about)}` : ""}`));
    }
    if (parts.built.length) {
      if (context.length) context.push("");
      context.push(parts.builtLabel, ...list(parts.built, keepBuilt));
    }
    if (parts.notYet.length) {
      if (context.length) context.push("");
      context.push("Not yet. Do not build these:", ...list(parts.notYet, keepNotYet));
    }
    section("context", context);
    section("in_flight", parts.targets.flatMap(story => inFlightLines(story, options)));
    section("open_decisions", parts.decisions.map(decision => `- ${decision}`));
    section("done_when", parts.doneWhen.map(line => `- ${line}`));
    text.push("</brief>");
    return { brief: `${text.join("\n")}\n`, sections };
  };

  let keepBuilt = parts.built.length;
  let keepNotYet = parts.notYet.length;
  let written = write(keepBuilt, keepNotYet);
  // Cut the neighbour lists, longest first, until the brief fits. The targets are never cut.
  // Work out the cut from each line's size first, so a long brief is rendered a few times, not once per line.
  let over = bytes(written.brief) - parts.maxBytes;
  if (over > 0) {
    const size = (entry: Neighbour | undefined) => entry ? bytes(storyLine(entry)) + 1 : 0;
    const moreLine = bytes(list(parts.built.length ? parts.built : parts.notYet, 0)[0] ?? "") + 1;
    while (over > 0 && (keepBuilt > 0 || keepNotYet > 0)) {
      const cutNotYet = keepNotYet >= keepBuilt;
      const entries = cutNotYet ? parts.notYet : parts.built;
      const keep = cutNotYet ? keepNotYet : keepBuilt;
      over -= size(entries[keep - 1]) - (keep === entries.length ? moreLine : 0);
      if (cutNotYet) keepNotYet--;
      else keepBuilt--;
    }
    written = write(keepBuilt, keepNotYet);
  }
  // The "more not listed" lines can differ in length from the estimate, so check the result.
  while (bytes(written.brief) > parts.maxBytes && (keepBuilt > 0 || keepNotYet > 0)) {
    if (keepNotYet >= keepBuilt) keepNotYet--;
    else keepBuilt--;
    written = write(keepBuilt, keepNotYet);
  }
  return written;
}
