import { z } from "zod";
import { parseDocument } from "yaml";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const title = z.string().trim().min(1).max(120);
const summary = z.string().trim().max(500).optional();
const customerCopy = z.object({ title, summary }).strict();
const group = z.object({ id, title, summary, customer: customerCopy.optional() }).strict();

export const storyStatuses = ["planned", "in-progress", "shipped"] as const;

const story = z.object({
  id,
  title,
  activity: id,
  release: id,
  summary,
  status: z.enum(storyStatuses).default("planned"),
  updatedBy: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(4000).optional(),
  sources: z.array(z.string().trim().min(1).max(250)).max(20).optional(),
  customer: customerCopy.optional(),
}).strict();

export const storyMapSchema = z.object({
  version: z.literal(1),
  id,
  title,
  summary,
  visibility: z.enum(["internal", "all-users"]).default("internal"),
  customer: customerCopy.optional(),
  activities: z.array(group).min(1).max(50),
  releases: z.array(group).min(1).max(50),
  stories: z.array(story).max(1000),
}).strict().superRefine((map, context) => {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });

  if (map.visibility === "all-users" && !map.customer) {
    issue(["customer"], "The all-users view requires customer-facing map copy.");
  }

  for (const field of ["activities", "releases", "stories"] as const) {
    const ids = new Set<string>();
    map[field].forEach((entry, index) => {
      if (ids.has(entry.id)) issue([field, index, "id"], `Duplicate ID '${entry.id}'.`);
      ids.add(entry.id);
    });
  }

  const activities = new Map(map.activities.map(activity => [activity.id, activity]));
  const releases = new Map(map.releases.map(release => [release.id, release]));

  map.stories.forEach((story, index) => {
    const activity = activities.get(story.activity);
    const release = releases.get(story.release);

    if (!activity) issue(["stories", index, "activity"], `Unknown activity '${story.activity}'.`);
    if (!release) issue(["stories", index, "release"], `Unknown release '${story.release}'.`);
    if (story.customer && activity && !activity.customer) {
      issue(["stories", index, "activity"], "A customer-facing story requires customer-facing copy for its activity.");
    }
    if (story.customer && release && !release.customer) {
      issue(["stories", index, "release"], "A customer-facing story requires customer-facing copy for its release.");
    }
  });
});

export type StoryMapDocument = z.infer<typeof storyMapSchema>;
export type StoryStatus = (typeof storyStatuses)[number];

export function parseStoryMap(source: string): StoryMapDocument {
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map(error => error.message).join("\n"));
  }
  const result = storyMapSchema.safeParse(parsed.toJS({ maxAliasCount: 20 }));
  if (!result.success) {
    throw new Error(result.error.issues.map(issue =>
      `${issue.path.join(".") || "map"}: ${issue.message}`
    ).join("\n"));
  }
  return result.data;
}
