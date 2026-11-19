export const storyStatuses = ["planned", "in-progress", "shipped"] as const;

export type StoryStatus = (typeof storyStatuses)[number];

export const storyStatusLabels: Record<StoryStatus, string> = {
  planned: "Planned",
  "in-progress": "In progress",
  shipped: "Shipped",
};
