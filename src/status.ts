export const storyStatuses = ["planned", "in-progress", "shipped", "blocked", "cut"] as const;

export type StoryStatus = (typeof storyStatuses)[number];

/** Statuses the board shows by default. Blocked and cut stories are hidden until a viewer asks for them. */
export const activeStoryStatuses = ["planned", "in-progress", "shipped"] as const satisfies readonly StoryStatus[];

/** Statuses for work that is not going ahead as planned. They are hidden by default and never shown to customers. */
export const inactiveStoryStatuses = ["blocked", "cut"] as const satisfies readonly StoryStatus[];

export function isActiveStatus(status: StoryStatus): boolean {
  return (activeStoryStatuses as readonly StoryStatus[]).includes(status);
}

export const storyStatusLabels: Record<StoryStatus, string> = {
  planned: "Planned",
  "in-progress": "In progress",
  shipped: "Shipped",
  blocked: "Blocked",
  cut: "Cut",
};
