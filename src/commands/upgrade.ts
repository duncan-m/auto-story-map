import { describeUpgradeState, upgradeReport, type AgentsRuleReview, type AgentsRuleState, type UpgradePart, type UpgradeReport } from "../upgrade.js";
import { upgradeOverviewLines } from "../upgrade-overview.js";
import { defineCommand, escapeText, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "markdown", "json"] as const;

interface UpgradeOptions {
  format: (typeof formats)[number];
  root: string;
  map?: string;
  diff: boolean;
}

const pad = (text: string, width: number) => text.padEnd(width);

const ruleStateWords: Record<AgentsRuleState, string> = {
  current: "current",
  outdated: "outdated",
  edited: "reworded",
  "edited-outdated": "reworded, changed here too",
  removed: "removed by you",
  new: "new",
  dropped: "dropped here",
  added: "yours",
};

/** The rules that need a look: every rule that is not current. */
const rulesToShow = (part: UpgradePart) => (part.rules ?? []).filter(rule => rule.state !== "current");

const ruleName = (rule: AgentsRuleReview) => rule.id ?? `“${rule.title}”`;

/** The rules of an `AGENTS.md` section that are not current, as a table, with each rule's diff after it when `diff` is set. */
function rulesText(part: UpgradePart, diff: boolean): string[] {
  const shown = rulesToShow(part);
  if (!part.rules || !shown.length) return [];
  const rows = shown.map(rule => [ruleName(rule), ruleStateWords[rule.state], rule.change].map(escapeText));
  const widths = [0, 1].map(column => Math.max(...[["Rule", "State"][column], ...rows.map(row => row[column])].map(text => text.length)));
  const current = part.rules.length - shown.length;
  const lines = [
    "",
    `${escapeText(part.title)}, rule by rule${current ? ` (${current} more ${current === 1 ? "is" : "are"} current)` : ""}:`,
    "",
    `${pad("Rule", widths[0])}  ${pad("State", widths[1])}  Change`,
    ...rows.map(([name, state, change]) => `${pad(name, widths[0])}  ${pad(state, widths[1])}  ${change}`),
  ];
  if (diff) {
    for (const rule of shown) {
      if (rule.diff) lines.push("", `Rule ${escapeText(ruleName(rule))}, from yours to this version's:`, ...rule.diff.trimEnd().split("\n").map(escapeText));
      else if (rule.state === "new") lines.push("", `Rule ${escapeText(ruleName(rule))}, new in this version:`, ...rule.template!.split("\n").map(line => `+${escapeText(line)}`));
    }
  }
  return lines;
}

/** The overview, then the table of parts, as people read it at a terminal, with each part's diff after it when `diff` is set. */
export function upgradeText(report: UpgradeReport, diff = false): string {
  const rows = report.parts.map(part => [part.title, describeUpgradeState(part), part.change].map(escapeText));
  const widths = [0, 1].map(column => Math.max(...[["Part", "State"][column], ...rows.map(row => row[column])].map(text => text.length)));
  const lines = [
    ...upgradeOverviewLines(report.overview).map(escapeText),
    "",
    `Set-up compared with auto-story-map ${escapeText(report.packageVersion)}`,
    "",
    `${pad("Part", widths[0])}  ${pad("State", widths[1])}  Change`,
    ...rows.map(([title, state, change]) => `${pad(title, widths[0])}  ${pad(state, widths[1])}  ${change}`),
  ];
  for (const part of report.parts) lines.push(...rulesText(part, diff));
  const withDiffs = report.parts.filter(part => part.diff);
  if (diff) {
    // A section compared rule by rule shows each rule's diff instead of the whole section's.
    for (const part of withDiffs.filter(part => !part.rules)) lines.push("", `${escapeText(part.title)} (${escapeText(part.path)}), from yours to this version's:`, ...part.diff!.trimEnd().split("\n").map(escapeText));
  } else if (withDiffs.length) {
    lines.push("", "Run again with --diff to see what differs, or --format json for each part's diff.");
  }
  lines.push("", "Nothing was changed.");
  return lines.join("\n");
}

/** One line of plain text as Markdown, keeping a leading bullet, so nothing else in it is read as markup. */
const inline = (text: string) => {
  const bullet = text.startsWith("- ") ? "- " : "";
  return bullet + text.slice(bullet.length).replace(/[\\`*_[\]<>|#]/g, "\\$&");
};

const cell = (text: string) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

/** The report as Markdown for a pull request description: the overview, the table, and each diff in a closed details block. */
export function upgradeMarkdown(report: UpgradeReport): string {
  const [heading, ...overview] = upgradeOverviewLines(report.overview);
  const lines = [
    `### ${inline(heading)}`,
    // Notes on lines of their own become paragraphs of their own.
    ...overview.flatMap((line, index) => line && !line.startsWith("- ") && overview[index - 1] && !overview[index - 1].startsWith("- ") ? ["", inline(line)] : [inline(line)]),
    "",
    `### Set-up compared with auto-story-map ${report.packageVersion}`,
    "",
    "| Part | State | Change |",
    "| --- | --- | --- |",
    ...report.parts.map((part: UpgradePart) => `| ${cell(part.title)} | ${cell(describeUpgradeState(part))} | ${cell(part.change)} |`),
  ];
  for (const part of report.parts.filter(part => rulesToShow(part).length)) {
    const shown = rulesToShow(part);
    lines.push(
      "",
      `<details><summary>${cell(part.title)}, rule by rule: ${shown.length} of ${part.rules!.length} ${part.rules!.length === 1 ? "rule needs" : "rules need"} a look</summary>`,
      "",
      "| Rule | State | Change |",
      "| --- | --- | --- |",
      ...shown.map(rule => `| ${cell(ruleName(rule))} | ${cell(ruleStateWords[rule.state])} | ${cell(rule.change)} |`),
    );
    for (const rule of shown.filter(rule => rule.diff)) {
      const fence = "`".repeat(Math.max(3, ...[...rule.diff!.matchAll(/`+/g)].map(match => match[0].length + 1)));
      lines.push("", `${cell(ruleName(rule))}, from yours to this version's:`, "", `${fence}diff`, rule.diff!.trimEnd(), fence);
    }
    lines.push("", "</details>");
  }
  for (const part of report.parts.filter(part => part.diff && !part.rules)) {
    const fence = "`".repeat(Math.max(3, ...[...part.diff!.matchAll(/`+/g)].map(match => match[0].length + 1)));
    lines.push("", `<details><summary>${cell(part.title)}: from yours to this version's</summary>`, "", `${fence}diff`, part.diff!.trimEnd(), fence, "", "</details>");
  }
  return `${lines.join("\n")}\n`;
}

export default defineCommand({
  parse(rest: string[]): UpgradeOptions | null {
    const options: UpgradeOptions = { format: "text", root: ".", diff: false };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      if (arg === "--diff") {
        options.diff = true;
        continue;
      }
      const name = arg.split("=")[0];
      if (!["--format", "--root", "--map"].includes(name)) return null;
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--format") options.format = readFormat(value, formats);
      else if (name === "--root") options.root = value;
      else options.map = value;
    }
    return options;
  },

  async run(options) {
    let report;
    try {
      report = await upgradeReport({ root: options.root, map: options.map });
    } catch (error) {
      console.error(`story-map: ${escapeText(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = 1;
      return;
    }
    if (options.format === "json") printJson("upgrade", report);
    else if (options.format === "markdown") process.stdout.write(upgradeMarkdown(report));
    else console.log(upgradeText(report, options.diff));
  },
});
