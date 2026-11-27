import { checkPlanReferences, checkSources, type ReferenceIssue } from "./references.js";
import { describeIssueTarget, loadStoryMap, StoryMapValidationError, type StoryMapIssueSeverity, type StoryMapWarningKind } from "./schema.js";
import { checkStoryTests, findStoryTests } from "./tests.js";

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
  /** What a warning asks for, such as `missing-estimate`. Absent on errors and on warnings about other files. */
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
  /** Which of the optional file checks ran. */
  checked: ("sources" | "plans" | "tests")[];
  /** Issues in the map first, in source order, then those in other files. */
  issues: StoryMapCheckIssue[];
}

function toCheckIssue(issue: ReferenceIssue): StoryMapCheckIssue {
  return {
    severity: issue.severity,
    ...(issue.file ? { file: issue.file } : {}),
    ...(issue.line ? { line: issue.line } : {}),
    ...(issue.column ? { column: issue.column } : {}),
    path: issue.path,
    ...(issue.path.length ? { target: describeIssueTarget(issue) } : {}),
    ...(issue.itemId ? { itemId: issue.itemId } : {}),
    message: issue.message,
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
  let loaded;
  try {
    loaded = loadStoryMap(source);
  } catch (error) {
    if (!(error instanceof StoryMapValidationError)) throw error;
    const issues = error.issues.map(toCheckIssue);
    const errors = issues.filter(issue => issue.severity === "error").length;
    return { valid: false, errors, warnings: issues.length - errors, checked, issues };
  }
  const root = options.root ?? process.cwd();
  const found: ReferenceIssue[] = [];
  if (options.checkSources) found.push(...await checkSources(loaded, root));
  if (options.plans?.length) found.push(...await checkPlanReferences(loaded, root, options.plans));
  if (options.tests?.length) {
    const tests = await findStoryTests(loaded, root, { paths: options.tests });
    found.push(...tests.issues, ...checkStoryTests(loaded, tests.tests));
  }
  const issues = ([...found, ...loaded.warnings] as ReferenceIssue[])
    .sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || (a.line ?? 0) - (b.line ?? 0))
    .map(toCheckIssue);
  const errors = issues.filter(issue => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const { map } = loaded;
  return {
    valid: errors === 0 && !(options.strict && warnings),
    counts: { activities: map.activities.length, releases: map.releases.length, stories: map.stories.length },
    errors,
    warnings,
    checked,
    issues,
  };
}
