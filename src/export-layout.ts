import type { StoryMapExport } from "./export.js";
import { storyStatusLabels } from "./status.js";

/**
 * Lays out an export as a board: activity headers across the top, a lane per
 * release, and story cards stacked in each cell. Sizes are in inches from the
 * top left. Writers flip the y axis if their format needs it.
 */

export interface ExportTextRun {
  text: string;
  /** Points. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export interface ExportShape {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Each run is its own paragraph. */
  text: ExportTextRun[];
  /** No fill when absent. */
  fill?: string;
  /** No outline when absent. */
  line?: string;
  align?: "left" | "center";
  valign?: "top" | "middle";
  /** Shape data, such as a story's ID and status. */
  data?: Record<string, string>;
}

export interface ExportLayout {
  width: number;
  height: number;
  shapes: ExportShape[];
}

export const exportColors = {
  text: "#1B1F24",
  muted: "#5B6573",
  heading: "#1F3A5F",
  onHeading: "#FFFFFF",
  lane: "#F6F7F9",
  collapsedLane: "#EEF0F3",
  laneLine: "#C9CED6",
  card: "#FFFFFF",
  cardLine: "#9AA3AF",
} as const;

const margin = 0.5;
const gap = 0.1;
const laneHeaderWidth = 3.2;
const columnWidth = 2.6;
const cardWidth = 2.3;
const cardGap = 0.2;
/**
 * Story card text, in points. The ID and title share one size, because Miro uses
 * one size for all the text in a shape: with an 8-point ID, it drew titles at 8
 * points too. The ID stays grey. Titles wrap to at most `cardTitleLines` lines.
 */
const cardIdSize = 11;
const cardTitleSize = 11;
const cardTitleLines = 3;
/** Space between the lines of a release header, each its own shape. */
const headerLineGap = 0.03;
const lanePadding = 0.2;
const activityHeight = 0.6;
const minLaneHeight = 1.3;
const minCollapsedHeight = 0.6;
/** Inner text margins every writer must use, so the estimates below hold. */
export const textMargin = { x: 0.08, y: 0.06 } as const;
/** Space after each paragraph, in points. */
export const paragraphSpacing = 2;
const lineHeight = 1.2;

/**
 * Splits text into lines that fit `width` inches at `size` points. An estimate:
 * it assumes an average character width, slightly wider for bold. Counts code
 * points, so emoji are never split.
 */
export function wrapText(text: string, width: number, size: number, bold = false): string[] {
  const perLine = Math.max(1, Math.floor((width * 72) / (size * (bold ? 0.56 : 0.52))));
  const lines: string[] = [];
  let line: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let chars = Array.from(word);
    // Break words longer than a line.
    while (chars.length > perLine) {
      if (line.length) lines.push(line.join(""));
      lines.push(chars.slice(0, perLine).join(""));
      chars = chars.slice(perLine);
      line = [];
    }
    const next = line.length ? [...line, " ", ...chars] : chars;
    if (next.length > perLine) {
      lines.push(line.join(""));
      line = chars;
    } else {
      line = next;
    }
  }
  if (line.length || !lines.length) lines.push(line.join(""));
  return lines;
}

/** Cuts text to `maxLines` wrapped lines, ending in “…” when it is cut. */
export function fitText(text: string, width: number, size: number, maxLines: number, bold = false): string {
  const lines = wrapText(text, width, size, bold);
  if (lines.length <= maxLines) return text.trim();
  const kept = lines.slice(0, maxLines);
  const perLine = Math.max(1, Math.floor((width * 72) / (size * (bold ? 0.56 : 0.52))));
  let last = Array.from(kept[maxLines - 1]);
  if (last.length >= perLine) last = last.slice(0, perLine - 1);
  kept[maxLines - 1] = `${last.join("").trimEnd()}…`;
  return kept.join(" ");
}

function textHeight(runs: ExportTextRun[], width: number) {
  const inner = width - textMargin.x * 2;
  const points = runs.reduce(
    (sum, run) => sum + wrapText(run.text, inner, run.size, run.bold).length * run.size * lineHeight + paragraphSpacing,
    0,
  );
  return points / 72 + textMargin.y * 2;
}

/** A card tall enough for its ID and a title of `lines` lines, with a little room below. */
function cardHeightFor(lines: number) {
  return textHeight([{ text: "", size: cardIdSize }, { text: "", size: cardTitleSize }], cardWidth)
    + ((lines - 1) * cardTitleSize * lineHeight) / 72 + 0.08;
}

export function layoutStoryMapExport(model: StoryMapExport): ExportLayout {
  const shapes: ExportShape[] = [];
  const boardWidth = laneHeaderWidth + columnWidth * model.activities.length;
  let y = margin;

  const subtitle = [`Exported ${model.exportedOn}`];
  if (model.omitted > 0) {
    subtitle.push(`Showing the ${model.available - model.omitted} most recently changed of ${model.available} stories`);
  }
  const titleRuns: ExportTextRun[] = [
    { text: fitText(model.title, boardWidth - textMargin.x * 2, 16, 2, true), size: 16, bold: true, color: exportColors.text },
    { text: subtitle.join(" · "), size: 9, color: exportColors.muted },
  ];
  // One shape per size, as for release headers, so Miro keeps each size.
  titleRuns.forEach((run, index) => {
    const h = textHeight([run], boardWidth);
    shapes.push({ name: index === 0 ? "Map title" : "Map subtitle", x: margin, y, w: boardWidth, h, text: [run] });
    y += h;
  });
  y += gap;

  const cardTextWidth = cardWidth - textMargin.x * 2;
  const headerTextWidth = columnWidth - gap - textMargin.x * 2;
  model.activities.forEach((activity, i) => {
    shapes.push({
      name: `Activity ${activity.id}`,
      x: margin + laneHeaderWidth + i * columnWidth,
      y,
      w: columnWidth - gap,
      h: activityHeight,
      text: [{ text: fitText(activity.title, headerTextWidth, 11, 2, true), size: 11, bold: true, color: exportColors.onHeading }],
      fill: exportColors.heading,
      align: "center",
      valign: "middle",
      data: { Activity: activity.id },
    });
  });
  y += activityHeight + gap;

  for (const release of model.releases) {
    const header: ExportTextRun[] = [{ text: release.title, size: 11, bold: true, color: exportColors.text }];
    if (release.collapsed) {
      header.push({ text: `Collapsed · ${release.storyCount === 1 ? "1 story" : `${release.storyCount} stories`}`, size: 9, color: exportColors.muted });
      if (release.estimatesText) header.push({ text: release.estimatesText, size: 9, color: exportColors.muted });
    } else {
      header.push({ text: release.countsText, size: 9, color: exportColors.muted });
      if (release.estimatesText) header.push({ text: release.estimatesText, size: 9, color: exportColors.muted });
      for (const paragraph of release.notes) header.push({ text: paragraph, size: 9, color: exportColors.text });
      for (const item of release.impact) {
        const actual = item.actual ? ` (actual: ${item.actual})` : "";
        header.push({ text: `${item.draft ? "Draft · " : ""}${item.metric}: ${item.expected}${actual}`, size: 9, italic: true, color: exportColors.text });
      }
    }
    // Each line of the header is its own shape, sized to its text. Tools differ in how
    // they align and space paragraphs inside one tall shape: Miro centred them and
    // spread them out, so they spilled out of the lane.
    const headerWidth = laneHeaderWidth - gap * 2;
    const headerLines = header.map(run => ({ run, h: textHeight([run], headerWidth) }));
    const headerHeight = headerLines.reduce((sum, line) => sum + line.h, 0) + headerLineGap * (headerLines.length - 1);

    // Cards in a lane share one height, just tall enough for the longest title in it.
    const titles = new Map<string, string>();
    let titleLines = 1;
    for (const cell of release.cells.values()) {
      for (const story of cell) {
        const title = fitText(story.title, cardTextWidth, cardTitleSize, cardTitleLines);
        titles.set(story.id, title);
        titleLines = Math.max(titleLines, wrapText(title, cardTextWidth, cardTitleSize).length);
      }
    }
    const cardHeight = cardHeightFor(titleLines);

    const tallestCell = Math.max(0, ...[...release.cells.values()].map(cell => cell.length));
    const cardsHeight = tallestCell ? tallestCell * cardHeight + (tallestCell - 1) * cardGap + lanePadding * 2 : 0;
    const laneHeight = release.collapsed
      ? Math.max(minCollapsedHeight, headerHeight + gap)
      : Math.max(minLaneHeight, cardsHeight, headerHeight + gap);

    // The lane goes first, so it sits beneath its header and cards.
    shapes.push({
      name: `Release ${release.id}`,
      x: margin,
      y,
      w: boardWidth,
      h: laneHeight,
      text: [],
      fill: release.collapsed ? exportColors.collapsedLane : exportColors.lane,
      line: exportColors.laneLine,
      data: { Release: release.id, Collapsed: release.collapsed ? "Yes" : "No" },
    });
    // A collapsed lane centres its header. Others start it at the top.
    let lineY = release.collapsed ? y + (laneHeight - headerHeight) / 2 : y + gap / 2;
    headerLines.forEach(({ run, h }, index) => {
      shapes.push({
        name: index === 0 ? `Release header ${release.id}` : `Release header ${release.id} line ${index + 1}`,
        x: margin + gap,
        y: lineY,
        w: headerWidth,
        h,
        text: [run],
      });
      lineY += h + headerLineGap;
    });

    model.activities.forEach((activity, i) => {
      (release.cells.get(activity.id) ?? []).forEach((story, row) => {
        shapes.push({
          name: `Story ${story.id}`,
          x: margin + laneHeaderWidth + i * columnWidth + (columnWidth - gap - cardWidth) / 2,
          y: y + lanePadding + row * (cardHeight + cardGap),
          w: cardWidth,
          h: cardHeight,
          text: [
            { text: story.estimate === undefined ? story.id : `${story.id} · ${story.estimate} ${story.estimate === 1 ? "pt" : "pts"}`, size: cardIdSize, color: exportColors.muted },
            { text: titles.get(story.id)!, size: cardTitleSize, color: exportColors.text },
          ],
          fill: exportColors.card,
          line: exportColors.cardLine,
          data: {
            ID: story.id,
            Title: story.title,
            Status: storyStatusLabels[story.status],
            Activity: story.activity,
            Release: story.release,
            ...(story.estimate !== undefined ? { Estimate: String(story.estimate) } : {}),
            // Joined as in the CSV export, so Lucidchart can filter cards by them.
            ...(story.personas?.length ? { Personas: story.personas.join("; ") } : {}),
            ...(story.jobs?.length ? { Jobs: story.jobs.join("; ") } : {}),
          },
        });
      });
    });
    y += laneHeight + gap;
  }

  return { width: margin * 2 + boardWidth, height: y - gap + margin, shapes };
}
