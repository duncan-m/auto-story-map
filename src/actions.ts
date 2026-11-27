import { storyMapWarnings, storyMapWarningKinds, type LoadedStoryMap, type StoryMapDocument, type StoryMapWarning, type StoryMapWarningKind } from "./schema.js";
import type { StoryMapTests } from "./tests-index.js";

/** The groups the Actions tab sorts kinds into, in the order it lists them. */
export type StoryMapActionCategory = "gap" | "draft" | "estimate" | "test" | "other";

/** What the Actions tab says about one kind of action. */
export interface StoryMapActionKindInfo {
  category: StoryMapActionCategory;
  /** A short heading, such as “Confirm a drafted job”. */
  title: string;
  /** One sentence on why it matters. */
  why: string;
  /** True when only a person may act on it. Agents leave these alone. */
  needsPerson: boolean;
}

/**
 * Every kind of action, in the order the Actions tab and `story-map actions` list them:
 * gaps, drafts to confirm, estimates, tests, then the rest. A warning with a new kind
 * fails to compile until it has an entry here.
 */
export const storyMapActionKinds: Readonly<Record<StoryMapWarningKind, StoryMapActionKindInfo>> = {
  "job-without-stories": {
    category: "gap",
    title: "Fill a job with no stories",
    why: "Nothing on the map serves this job yet. A core job with no stories is the biggest gap a map can have.",
    needsPerson: false,
  },
  "step-without-stories": {
    category: "gap",
    title: "Fill a step with no stories",
    why: "The job has stories, but none in the activity where this step happens.",
    needsPerson: false,
  },
  "persona-without-stories": {
    category: "gap",
    title: "Tag stories for a persona",
    why: "No story says it is for this persona, so the map cannot show what they get.",
    needsPerson: false,
  },
  "stories-without-personas": {
    category: "gap",
    title: "Say who stories are for",
    why: "Most active stories name no persona or job, so the Personas tab and filters miss them.",
    needsPerson: false,
  },
  "persona-without-job": {
    category: "gap",
    title: "Link a story to a job",
    why: "The story is for a persona but serves none of their jobs, so it may not match a known need.",
    needsPerson: false,
  },
  "confirm-draft-job": {
    category: "draft",
    title: "Confirm a drafted job",
    why: "Stories that serve this job have shipped, but nobody has agreed the job is right.",
    needsPerson: true,
  },
  "confirm-draft-context": {
    category: "draft",
    title: "Confirm a persona's drafted context",
    why: "Stories for this persona have shipped, but nobody has agreed what success means to them.",
    needsPerson: true,
  },
  "confirm-draft-impact": {
    category: "draft",
    title: "Confirm a release's drafted impact",
    why: "The release has shipped stories, but its expected impact is still a draft.",
    needsPerson: true,
  },
  "missing-estimate": {
    category: "estimate",
    title: "Agree an estimate",
    why: "Other stories in the release are estimated, so its total leaves this one out.",
    needsPerson: true,
  },
  "story-without-tests": {
    category: "test",
    title: "Tag a test",
    why: "The story is in progress or merged, but no test names it, so nobody can see what checks it.",
    needsPerson: false,
  },
  "missing-impact": {
    category: "other",
    title: "Add a release's impact",
    why: "The release has active stories but says nothing about what it should change.",
    needsPerson: false,
  },
  "missing-status-reason": {
    category: "other",
    title: "Say why a story stopped",
    why: "The story is blocked or cut with no reason, so nobody can tell what would unblock it.",
    needsPerson: false,
  },
  "depends-on-cut": {
    category: "other",
    title: "Replan a dependency on cut work",
    why: "The story waits for work that will not land.",
    needsPerson: false,
  },
};

/** The kinds in the order they are listed. */
export const storyMapActionKindOrder: readonly StoryMapWarningKind[] = storyMapWarningKinds;

/** What an action is about, and where its panel or page is. */
export type StoryMapActionItem =
  | { type: "story" | "release" | "persona"; id: string; title: string }
  | { type: "map" };

/** One thing the map is waiting for, from one validate warning. */
export interface StoryMapAction {
  kind: StoryMapWarningKind;
  /** True when only a person may act on it, from `storyMapActionKinds`. */
  needsPerson: boolean;
  item: StoryMapActionItem;
  /** The release the item is in, or is, so the tab can filter by release. Absent for personas and the map. */
  release?: string;
  /** Location in the map, as in validate. */
  path: (string | number)[];
  /** 1-based line in the map file, when the source was given. */
  line?: number;
  message: string;
  /** The command that fixes it, or shows the draft to confirm. `<…>` marks a value to fill in. Absent when the fix is not a command. */
  command?: string;
}

/** The actions of one kind, with what the tab says about them. */
export interface StoryMapActionGroup extends StoryMapActionKindInfo {
  kind: StoryMapWarningKind;
  actions: StoryMapAction[];
}

export interface StoryMapActionOptions {
  /** The tests index from `story-map tests`. With it, in-progress and merged stories no test names are actions too. */
  tests?: StoryMapTests | null;
  /** Finds the line of a path, such as `LoadedStoryMap.locate`, so each action can say where it is. */
  locate?: LoadedStoryMap["locate"];
}

/**
 * A warning at the `status` of each `in-progress` or `merged` story that no test names, given
 * the IDs the tests are tagged with. `checkStoryTests` uses it with a scan, and the Actions tab
 * with the host's tests index.
 */
export function untestedStoryWarnings(map: StoryMapDocument, tagged: ReadonlySet<string>): StoryMapWarning[] {
  return map.stories.flatMap((story, index): StoryMapWarning[] => {
    if ((story.status !== "in-progress" && story.status !== "merged") || tagged.has(story.id)) return [];
    return [{
      severity: "warning",
      kind: "story-without-tests",
      path: ["stories", index, "status"],
      itemId: story.id,
      message: `No tests are tagged ${story.id}. Put the story ID in the name of each test that covers it.`,
    }];
  });
}

const quote = (value: string) => /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

/** The fixing command for a warning, built from the map, so IDs come from the map and not the message. */
function actionCommand(map: StoryMapDocument, warning: StoryMapWarning): string | undefined {
  const [field, index, sub, subIndex, , stepIndex] = warning.path;
  const story = field === "stories" && typeof index === "number" ? map.stories[index] : undefined;
  const release = field === "releases" && typeof index === "number" ? map.releases[index] : undefined;
  const persona = field === "personas" && typeof index === "number" ? map.personas?.[index] : undefined;
  const job = persona && sub === "jobs" && typeof subIndex === "number" ? persona.jobs?.[subIndex] : undefined;
  switch (warning.kind) {
    case "confirm-draft-job":
      return job && `npx story-map confirm ${quote(job.id)} --write`;
    case "confirm-draft-context":
      return persona && `npx story-map confirm ${quote(persona.id)} --write`;
    case "confirm-draft-impact":
      return release && typeof subIndex === "number" ? `npx story-map confirm ${quote(release.id)} --impact ${subIndex + 1} --write` : undefined;
    case "missing-impact":
      return release && `npx story-map release-impact ${quote(release.id)} --metric '<what you will measure>' --expected '<the change you expect>' --write`;
    case "missing-status-reason":
      return story && `npx story-map edit ${quote(story.id)} --status ${story.status} --reason '<why>' --write`;
    case "depends-on-cut": {
      const ref = story && typeof sub === "string" && typeof subIndex === "number" ? story.dependsOn?.[subIndex] : undefined;
      return story && ref ? `npx story-map edit ${quote(story.id)} --remove-dependency ${quote(ref)} --write` : undefined;
    }
    case "job-without-stories":
      return job && `npx story-map edit <story ID> --add-job ${quote(job.id)} --write`;
    case "step-without-stories":
      return job && typeof stepIndex === "number" ? `npx story-map edit <story ID> --add-job ${quote(job.id)} --write` : undefined;
    case "persona-without-stories":
      return persona && `npx story-map edit <story ID> --add-persona ${quote(persona.id)} --write`;
    case "persona-without-job":
      return story && `npx story-map edit ${quote(story.id)} --add-job <job ID> --write`;
    // An estimate is the team's to agree, the map-wide gap has no single fix, and a test tag goes in the test's name.
    default:
      return undefined;
  }
}

function actionItem(map: StoryMapDocument, warning: StoryMapWarning): { item: StoryMapActionItem; release?: string } {
  const [field, index] = warning.path;
  if (field === "stories" && typeof index === "number") {
    const story = map.stories[index];
    return { item: { type: "story", id: story.id, title: story.title }, release: story.release };
  }
  if (field === "releases" && typeof index === "number") {
    const release = map.releases[index];
    return { item: { type: "release", id: release.id, title: release.title }, release: release.id };
  }
  const persona = field === "personas" && typeof index === "number" ? map.personas?.[index] : undefined;
  if (persona) return { item: { type: "persona", id: persona.id, title: persona.title } };
  return { item: { type: "map" } };
}

/**
 * What the map is waiting for: every validate warning about the map, grouped by kind in
 * `storyMapActionKinds` order, then by release in map order, then in map order. Items in no
 * release come after the rest of their group. Groups with no actions are left out.
 *
 * The same list backs the board's Actions tab, the panels' Actions rows and `story-map actions`,
 * so they never disagree with each other or with validate.
 */
export function getStoryMapActions(map: StoryMapDocument, options: StoryMapActionOptions = {}): StoryMapActionGroup[] {
  const warnings: StoryMapWarning[] = [...storyMapWarnings(map)];
  if (options.tests) warnings.push(...untestedStoryWarnings(map, new Set(options.tests.tests.flatMap(test => test.storyIds))));
  const releaseOrder = new Map(map.releases.map((release, index) => [release.id, index]));
  const position = (path: (string | number)[]) => typeof path[1] === "number" ? path[1] : -1;
  const sections = ["personas", "releases", "stories"];
  const actions = warnings.map((warning, order) => {
    const { item, release } = actionItem(map, warning);
    const command = actionCommand(map, warning);
    const line = options.locate?.(warning.path).line;
    const action: StoryMapAction = {
      kind: warning.kind,
      needsPerson: storyMapActionKinds[warning.kind].needsPerson,
      item,
      ...(release ? { release } : {}),
      path: warning.path,
      ...(line ? { line } : {}),
      message: warning.message,
      ...(command ? { command } : {}),
    };
    return { action, order };
  });
  actions.sort((a, b) => {
    const releaseA = a.action.release !== undefined ? releaseOrder.get(a.action.release) ?? Infinity : Infinity;
    const releaseB = b.action.release !== undefined ? releaseOrder.get(b.action.release) ?? Infinity : Infinity;
    if (releaseA !== releaseB) return releaseA - releaseB;
    const sectionA = sections.indexOf(String(a.action.path[0]));
    const sectionB = sections.indexOf(String(b.action.path[0]));
    if (sectionA !== sectionB) return sectionA - sectionB;
    return position(a.action.path) - position(b.action.path) || a.order - b.order;
  });
  return storyMapActionKindOrder.flatMap(kind => {
    const list = actions.filter(({ action }) => action.kind === kind).map(({ action }) => action);
    return list.length ? [{ kind, ...storyMapActionKinds[kind], actions: list }] : [];
  });
}

/** The number of actions across groups. */
export const countStoryMapActions = (groups: readonly StoryMapActionGroup[]) => groups.reduce((total, group) => total + group.actions.length, 0);

/** What the tab, a panel or `story-map actions` narrows the list to. Each is optional. */
export interface StoryMapActionFilter {
  kind?: StoryMapWarningKind;
  /** Only actions on this kind of item: stories, releases, personas or the map as a whole. */
  itemType?: StoryMapActionItem["type"];
  /** Only actions in this release. */
  release?: string;
  /** Only actions on this story, release or persona. */
  item?: string;
  /** Only actions a person must take. */
  needsPerson?: boolean;
}

/** The groups narrowed by `filter`, leaving out groups that end up empty. */
export function filterStoryMapActions(groups: readonly StoryMapActionGroup[], filter: StoryMapActionFilter): StoryMapActionGroup[] {
  return groups.flatMap(group => {
    if (filter.kind && group.kind !== filter.kind) return [];
    if (filter.needsPerson && !group.needsPerson) return [];
    const actions = group.actions.filter(action =>
      (!filter.itemType || action.item.type === filter.itemType)
      && (!filter.release || action.release === filter.release)
      && (!filter.item || ("id" in action.item && action.item.id === filter.item)));
    return actions.length ? [{ ...group, actions }] : [];
  });
}

/** True when `value` names a kind of action. */
export const isStoryMapActionKind = (value: unknown): value is StoryMapWarningKind =>
  typeof value === "string" && (storyMapWarningKinds as readonly string[]).includes(value);

/** The kinds of item an action can be on, in the order the Actions tab offers them. */
export const storyMapActionItemTypes = ["persona", "story", "release", "map"] as const satisfies readonly StoryMapActionItem["type"][];

/** True when `value` names a kind of item. */
export const isStoryMapActionItemType = (value: unknown): value is StoryMapActionItem["type"] =>
  typeof value === "string" && (storyMapActionItemTypes as readonly string[]).includes(value);
