import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { checkPlanReferences, checkSources, markdownAnchors, maxMarkdownBytes, resolveRootedPath, type ReferenceIssue } from "./references.js";
import { storyMapGuidePath, storyMapRuleHelp, storyMapRules, type StoryMapRuleId } from "./rules.js";
import { describeIssueTarget, loadStoryMap, StoryMapValidationError, type StoryMapIssueSeverity, type StoryMapWarningKind } from "./schema.js";
import { checkStoryTests, findStoryTests } from "./tests.js";
import { storyMapRepositoryUrl, storyMapVersion } from "./version.js";

/** Options for `checkStoryMap`. The file checks are off unless asked for, as with `story-map validate`. */
export interface StoryMapCheckOptions {
  /** Repository root that sources, plans and tests are relative to. Needed for the file checks. */
  root?: string;
  /** Check that repository-relative sources exist and that Markdown `#heading` fragments match a heading. */
  checkSources?: boolean;
  /** Check that story IDs in Markdown files under these paths exist in the map. */
  plans?: string[];
  /** Check story IDs in the names of tests under these paths. */
  tests?: string[];
  /** Treat warnings as errors when deciding `valid`. */
  strict?: boolean;
}

/** One problem found by `checkStoryMap`, ready to print or return as JSON. */
export interface StoryMapCheckIssue {
  severity: StoryMapIssueSeverity;
  /** File the issue is in, relative to the root. Absent for the map itself. */
  file?: string;
  line?: number;
  column?: number;
  /** Location in the map, such as `["stories", 3, "release"]`. Empty for the whole file or another file. */
  path: (string | number)[];
  /** The readable form of `path`, such as `stories.3.release (ESM-104)`. Absent when `path` is empty. */
  target?: string;
  /** ID of the activity, release or story that contains the issue. */
  itemId?: string;
  message: string;
  /** The rule the issue breaks, such as `unknown-reference`. Stable across releases. See `storyMapRules`. */
  rule: StoryMapRuleId;
  /**
   * The guide section that explains the rule: `docs/story-map.md#…` when the repository's copy of the
   * guide has that heading, otherwise the guide on GitHub at the installed version's tag.
   */
  help: string;
  /** What a warning asks for, such as `missing-estimate`. Absent on errors, notices and warnings about other files. */
  kind?: StoryMapWarningKind;
}

/** The outcome of `checkStoryMap`. */
export interface StoryMapCheckResult {
  /** False when there are errors, or warnings with `strict`. */
  valid: boolean;
  /** What the map holds. Absent when it could not be parsed. */
  counts?: { activities: number; releases: number; stories: number };
  errors: number;
  warnings: number;
  /** Questions for a person, such as whether to use delivery plans. They never make the map invalid, even with `strict`. */
  notices: number;
  /** Which of the optional file checks ran. */
  checked: ("sources" | "plans" | "tests")[];
  /** Issues in the map first, in source order, then those in other files. */
  issues: StoryMapCheckIssue[];
}

/** Turns a rule into its guide link. See `storyMapRuleLinker`. */
export type StoryMapRuleLinker = (rule: StoryMapRuleId) => string;

/**
 * Links each rule to the guide: the repository's own `docs/story-map.md` when it has the rule's
 * heading, otherwise the guide on GitHub at the installed version's tag, so an older or missing
 * copy never gives a broken link.
 */
export async function storyMapRuleLinker(root: string): Promise<StoryMapRuleLinker> {
  let anchors: Set<string> | undefined;
  try {
    const path = join(root, storyMapGuidePath);
    if ((await stat(path)).size <= maxMarkdownBytes) anchors = markdownAnchors(await readFile(path, "utf8"));
  } catch {
    // No copy of the guide, so link to the package's.
  }
  return rule => anchors?.has(storyMapRules[rule].section) ? storyMapRuleHelp(rule, storyMapGuidePath) : storyMapRuleHelp(rule);
}

function toCheckIssue(issue: ReferenceIssue, link: StoryMapRuleLinker): StoryMapCheckIssue {
  return {
    severity: issue.severity,
    ...(issue.file ? { file: issue.file } : {}),
    ...(issue.line ? { line: issue.line } : {}),
    ...(issue.column ? { column: issue.column } : {}),
    path: issue.path,
    ...(issue.path.length ? { target: describeIssueTarget(issue) } : {}),
    ...(issue.itemId ? { itemId: issue.itemId } : {}),
    message: issue.message,
    rule: issue.rule,
    help: link(issue.rule),
    ...(issue.kind ? { kind: issue.kind } : {}),
  };
}

/**
 * Validates map source text the way `story-map validate` does, and returns
 * every issue as data instead of printing it. Parse and schema errors are
 * returned as issues too, so this throws only for unexpected failures.
 */
export async function checkStoryMap(source: string, options: StoryMapCheckOptions = {}): Promise<StoryMapCheckResult> {
  const checked = [
    options.checkSources && "sources",
    options.plans?.length && "plans",
    options.tests?.length && "tests",
  ].filter(Boolean) as StoryMapCheckResult["checked"];
  const root = options.root ?? process.cwd();
  const link = await storyMapRuleLinker(root);
  let loaded;
  try {
    loaded = loadStoryMap(source);
  } catch (error) {
    if (!(error instanceof StoryMapValidationError)) throw error;
    const issues = error.issues.map(issue => toCheckIssue(issue, link));
    return { valid: false, ...tally(issues), checked, issues };
  }
  const found: ReferenceIssue[] = [];
  if (options.checkSources) found.push(...await checkSources(loaded, root));
  const planPaths = [...options.plans ?? []];
  const chosen = loaded.map.settings?.plans;
  // Once a host keeps plans, --check-sources checks the IDs in them too, unless --plans already covers the folder.
  if (options.checkSources && typeof chosen === "string" && !covered(root, planPaths, chosen) && await hasFolder(root, chosen)) {
    planPaths.push(chosen);
    if (!checked.includes("plans")) checked.push("plans");
  }
  if (planPaths.length) found.push(...await checkPlanReferences(loaded, root, planPaths));
  if (chosen === undefined) found.push(await plansNotice(root));
  if (options.tests?.length) {
    const tests = await findStoryTests(loaded, root, { paths: options.tests });
    found.push(...tests.issues, ...checkStoryTests(loaded, tests.tests));
  }
  const issues = ([...found, ...loaded.warnings] as ReferenceIssue[])
    .sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0))
    .map(issue => toCheckIssue(issue, link));
  const counted = tally(issues);
  const { map } = loaded;
  return {
    valid: counted.errors === 0 && !(options.strict && counted.warnings),
    counts: { activities: map.activities.length, releases: map.releases.length, stories: map.stories.length },
    ...counted,
    checked,
    issues,
  };
}

function tally(issues: readonly StoryMapCheckIssue[]) {
  const of = (severity: StoryMapIssueSeverity) => issues.filter(issue => issue.severity === severity).length;
  return { errors: of("error"), warnings: of("warning"), notices: of("notice") };
}

/** True when `folder` is one of `paths` or inside one of them, so its files are checked already. */
function covered(root: string, paths: readonly string[], folder: string) {
  const target = resolve(root, folder);
  return paths.some(path => {
    const rel = relative(resolve(root, path), target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/** A host that has said yes to plans may not have written one yet, so a missing folder is not a problem. */
async function hasFolder(root: string, folder: string) {
  try {
    return (await resolveRootedPath(root, await realpath(root), folder)).kind !== "missing";
  } catch {
    return false;
  }
}

/** The heading every prompt about delivery plans links to. */
export const deliveryPlanGuideSection = "docs/story-map.md#write-a-delivery-plan";

/**
 * Where to read about delivery plans: the host's own copy of the guide when it has the
 * section, or the guide on GitHub at this version's tag when the copy is older.
 */
export async function deliveryPlanGuideLink(root: string): Promise<string> {
  try {
    const guide = await readFile(join(root, "docs", "story-map.md"), "utf8");
    if (/^## Write a delivery plan\s*$/m.test(guide)) return deliveryPlanGuideSection;
  } catch {
    // No copy of the guide, so link to the package's.
  }
  return `${storyMapRepositoryUrl}/blob/v${storyMapVersion}/${deliveryPlanGuideSection}`;
}

/** Asks for the delivery plans choice while `settings.plans` is left out. */
async function plansNotice(root: string): Promise<ReferenceIssue> {
  return {
    severity: "notice",
    rule: "choose-delivery-plans",
    path: [],
    message: `Delivery plans: not chosen yet. Ask the person whether to use them, see ${await deliveryPlanGuideLink(root)}, and record the answer with \`story-map settings --plans <folder>\` or \`--plans off\`.`,
  };
}
