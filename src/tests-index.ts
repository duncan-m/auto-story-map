import { z } from "zod";

/** One test or group in the tests index. */
export interface StoryTestEntry {
  /** The stories the test is listed for. Unknown IDs, and stories that reached `testsPerStoryMaxItems`, are left out. */
  storyIds: string[];
  /** Path relative to the repository root, with `/` separators. */
  file: string;
  /** 1-based line of the call. */
  line: number;
  /** The test's name as written, including any leading story ID, cut to `testNameMaxLength`. */
  name: string;
  kind: "test" | "group";
}

/** Tests a story has in a file beyond those the index lists. */
export interface OmittedStoryTests {
  storyId: string;
  file: string;
  count: number;
}

/** The JSON written by `story-map tests`. */
export interface StoryMapTests {
  version: 1;
  generatedAt: string;
  /** Sorted by file, then line. */
  tests: StoryTestEntry[];
  /** Tests left out by the limits, counted per story and file. Absent when none were left out. */
  omitted?: OmittedStoryTests[];
}

/** Most tests a tests index lists. */
export const testsMaxItems = 5000;
/** Most tests listed for one story. */
export const testsPerStoryMaxItems = 50;
/** The longest test name a tests index holds, in Unicode code points. */
export const testNameMaxLength = 250;
/** Most stories one test is listed for. */
export const testStoryIdsMaxItems = 20;
/** Most story and file pairs `omitted` counts. */
export const testsOmittedMaxItems = 100_000;

const codePoints = (text: string) => Array.from(text).length;
const storyId = z.string().min(1).max(64);
const file = z.string().min(1).max(1024);

export const storyMapTestsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  tests: z.array(z.object({
    storyIds: z.array(storyId).min(1).max(testStoryIdsMaxItems),
    file,
    line: z.number().int().min(1),
    name: z.string().min(1).refine(name => codePoints(name) <= testNameMaxLength, `Use at most ${testNameMaxLength} characters.`),
    kind: z.enum(["test", "group"]),
  })).max(testsMaxItems).superRefine((tests, context) => {
    const counts = new Map<string, number>();
    for (const test of tests) {
      for (const id of test.storyIds) {
        const count = (counts.get(id) ?? 0) + 1;
        counts.set(id, count);
        if (count === testsPerStoryMaxItems + 1) context.addIssue({ code: "custom", message: `Lists more than ${testsPerStoryMaxItems} tests for ${id}.` });
      }
    }
  }),
  omitted: z.array(z.object({
    storyId,
    file,
    count: z.number().int().min(1),
  })).max(testsOmittedMaxItems).optional(),
});

// The interfaces above document the format and the schema checks it. Fail the
// build if they ever describe different shapes.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
true satisfies Same<z.infer<typeof storyMapTestsSchema>, StoryMapTests>;

/** Parses the JSON written by `story-map tests`. Throws if it is not a valid tests index. */
export function parseStoryMapTests(json: string | unknown): StoryMapTests {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const result = storyMapTestsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid story map tests: ${result.error.issues.map(issue =>
      `${issue.path.join(".") || "file"}: ${issue.message}`).slice(0, 5).join("; ")}`);
  }
  return result.data;
}

