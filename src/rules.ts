import { storyMapRepositoryUrl, storyMapVersion } from "./version.js";

/** What the guide says about one validation rule. */
export interface StoryMapRuleInfo {
  /** The heading in `docs/story-map.md` that explains the rule, as its GitHub anchor, such as `record-dependencies`. */
  section: string;
  /** One sentence on what the rule checks, as the guide's rules table gives it. */
  summary: string;
}

/**
 * Every rule an issue from `validate` can break, by its stable ID. The IDs never
 * come from message text, so a reworded message keeps its rule.
 *
 * To add a rule, add an entry here, set `rule` on the issue that reports it,
 * and add a row to the rules table in the guide's “Validation rules” section.
 * The tests fail until the row exists and `section` names a heading in the guide.
 */
export const storyMapRules = {
  "yaml-syntax": { section: "validate-a-change", summary: "The file is not valid YAML." },
  "duplicate-key": { section: "validate-a-change", summary: "A key appears twice in the same mapping." },
  "unknown-field": { section: "check-the-map-as-you-edit", summary: "A field the map format does not have." },
  "missing-field": { section: "check-the-map-as-you-edit", summary: "A required field is left out." },
  "invalid-value": { section: "check-the-map-as-you-edit", summary: "A value of the wrong type, length or format, or not one of the allowed values." },
  "duplicate-id": { section: "validate-a-change", summary: "Two personas, jobs, activities, releases or stories share an ID." },
  "unknown-reference": { section: "validate-a-change", summary: "A reference to an activity, release, persona, job or story that is not in the map." },
  "duplicate-reference": { section: "validate-a-change", summary: "The same job, persona or dependency is listed twice on a story." },
  "dependency-cycle": { section: "record-dependencies", summary: "A story depends on itself, directly or through other stories." },
  "empty-persona-context": { section: "describe-a-personas-context", summary: "A persona's context has none of its fields." },
  "customer-copy-required": { section: "audience-settings", summary: "Customer-facing copy is missing where the audience rules need it." },
  "invalid-source-path": { section: "validate-a-change", summary: "A source is not a valid path." },
  "missing-source": { section: "validate-a-change", summary: "A repository-relative source does not exist." },
  "missing-heading": { section: "validate-a-change", summary: "A source's `#heading` matches no heading in the Markdown file." },
  "source-too-large": { section: "validate-a-change", summary: "A source's Markdown file is too large to check its `#heading`." },
  "outside-repository": { section: "validate-a-change", summary: "A source, plan or test path leaves the repository." },
  "plans-not-found": { section: "validate-a-change", summary: "A `--plans` path has no Markdown files." },
  "unknown-plan-story": { section: "validate-a-change", summary: "A plan mentions a story ID that is not in the map." },
  "plan-status-words": { section: "check-plan-status-lines", summary: "A plan's status line starts with words other than the map's statuses." },
  "plan-status-behind": { section: "check-plan-status-lines", summary: "A plan's status line is behind every story it names." },
  "plan-status-release": { section: "check-plan-status-lines", summary: "A plan's status line names a release title the map no longer has." },
  "tests-not-found": { section: "link-tests-to-stories", summary: "A `--tests` path has no test files." },
  "unknown-test-story": { section: "link-tests-to-stories", summary: "A test name has a story ID that is not in the map." },
  "test-file-too-large": { section: "link-tests-to-stories", summary: "A test file is too large to read." },
  "unreadable-map": { section: "validate-a-change", summary: "The map file could not be read." },
  "choose-delivery-plans": { section: "choose-whether-to-use-delivery-plans", summary: "Nobody has chosen whether to use delivery plans." },
  "job-without-stories": { section: "personas-and-jobs-to-be-done", summary: "No story serves a job to be done." },
  "step-without-stories": { section: "break-a-job-into-steps", summary: "A job's step has no stories in its activity." },
  "persona-without-stories": { section: "personas-and-jobs-to-be-done", summary: "No story is for a persona." },
  "stories-without-personas": { section: "personas-and-jobs-to-be-done", summary: "Most active stories say nothing about who they are for." },
  "persona-without-job": { section: "personas-and-jobs-to-be-done", summary: "A story is for a persona but serves none of their jobs." },
  "confirm-draft-job": { section: "confirm-a-draft", summary: "A drafted job has shipped stories but is still a draft." },
  "confirm-draft-context": { section: "confirm-a-draft", summary: "A persona's drafted context has shipped stories but is still a draft." },
  "confirm-draft-impact": { section: "confirm-a-draft", summary: "A release's drafted impact has shipped stories but is still a draft." },
  "missing-estimate": { section: "estimate-effort", summary: "A story has no estimate while others in its release do." },
  "story-without-tests": { section: "link-tests-to-stories", summary: "An in-progress or merged story has no tagged tests." },
  "missing-impact": { section: "release-notes-and-impact", summary: "A release with active stories has no impact." },
  "missing-status-reason": { section: "blocked-and-cut-stories", summary: "A blocked or cut story has no `statusReason`." },
  "depends-on-cut": { section: "record-dependencies", summary: "A story depends on a cut story." },
} as const satisfies Record<string, StoryMapRuleInfo>;

/** The stable ID of a validation rule, such as `missing-status-reason`. */
export type StoryMapRuleId = keyof typeof storyMapRules;

/** Every rule ID, in the order the guide lists them. */
export const storyMapRuleIds = Object.keys(storyMapRules) as StoryMapRuleId[];

/** True when `value` is a rule ID. */
export const isStoryMapRuleId = (value: unknown): value is StoryMapRuleId =>
  typeof value === "string" && Object.hasOwn(storyMapRules, value);

/** The guide's path in a repository, which rule links point into. */
export const storyMapGuidePath = "docs/story-map.md";

/** The guide on GitHub at the installed version's tag, for when the repository has no copy with the heading. */
export const storyMapPackagedGuideUrl = `${storyMapRepositoryUrl}/blob/v${storyMapVersion}/${storyMapGuidePath}`;

/** The link to the section that explains `rule`, in the guide at `guide`, which defaults to the packaged guide on GitHub. */
export function storyMapRuleHelp(rule: StoryMapRuleId, guide: string = storyMapPackagedGuideUrl): string {
  return `${guide}#${storyMapRules[rule].section}`;
}
