import { createInterface } from "node:readline/promises";
import { describeUpgradeState, upgradeReport, type AgentsRuleReview, type AgentsRuleState, type UpgradePart, type UpgradePartId, type UpgradeReport } from "../upgrade.js";
import { applyUpgrade, parseUpgradeParts, type UpgradeAnswers, type UpgradeApplyMode, type UpgradeApplyResult, type UpgradeQuestion } from "../upgrade-apply.js";
import { upgradeOverviewLines } from "../upgrade-overview.js";
import { ArgumentError, defineCommand, escapeText, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "markdown", "json"] as const;

interface UpgradeOptions {
  format: (typeof formats)[number];
  root: string;
  map?: string;
  diff: boolean;
  /** Set by --mode, or advanced by --apply. Left out, the command only reports. */
  mode?: UpgradeApplyMode;
  parts?: UpgradePartId[];
  write: boolean;
  answers: UpgradeAnswers;
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
    const options: UpgradeOptions = { format: "text", root: ".", diff: false, write: false, answers: {} };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      if (arg === "--diff" || arg === "--write") {
        options[arg === "--diff" ? "diff" : "write"] = true;
        continue;
      }
      const name = arg.split("=")[0];
      if (!["--format", "--root", "--map", "--mode", "--apply", "--plans", "--story-ids"].includes(name)) return null;
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--format") options.format = readFormat(value, formats);
      else if (name === "--root") options.root = value;
      else if (name === "--map") options.map = value;
      else if (name === "--mode") {
        if (value !== "simple" && value !== "advanced") throw new ArgumentError(`--mode must be simple or advanced, not ${value}`);
        options.mode = value;
      } else if (name === "--apply") {
        try {
          options.parts = parseUpgradeParts(value);
        } catch (error) {
          throw new ArgumentError((error as Error).message);
        }
      } else if (name === "--plans") options.answers.plans = value === "off" ? false : value;
      else {
        if (value !== "next" && value !== "lowest-free") throw new ArgumentError(`--story-ids must be next or lowest-free, not ${value}`);
        options.answers.storyIds = value;
      }
    }
    if (options.parts) {
      if (options.mode === "simple") throw new ArgumentError("--apply names the parts to take in advanced mode; simple mode takes the recommended ones");
      options.mode = "advanced";
    }
    const applying = options.mode === "simple" || !!options.parts;
    if (!applying && (options.write || options.answers.plans !== undefined || options.answers.storyIds !== undefined)) {
      throw new ArgumentError("--write, --plans and --story-ids apply the review: add --mode simple, or --apply <parts> for the parts you accept");
    }
    return options;
  },

  async run(options) {
    if (options.mode === "advanced" && !options.parts) {
      options.diff = true;
    } else if (options.mode) {
      await runApply(options);
      return;
    }
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
    else {
      console.log(upgradeText(report, options.diff));
      if (options.mode === "advanced") console.log("\nTo apply the parts you accept, run again with --apply <parts> --write, such as --apply guide,workflow.");
    }
  },
});

/** True when a person is at a terminal to answer questions, and the output is for them. */
export const atTerminal = (options: { format: string }) => options.format === "text" && !!process.stdin.isTTY && !!process.stdout.isTTY;

export async function askOnTerminal(questions: readonly UpgradeQuestion[]): Promise<UpgradeAnswers> {
  const lines = createInterface({ input: process.stdin, output: process.stderr });
  const answers: UpgradeAnswers = {};
  try {
    for (const question of questions) {
      const hint = question.part === "plans" ? "a folder such as docs/plans, off, or Enter for not now" : "next, lowest-free, or Enter for not now";
      for (;;) {
        const answer = (await lines.question(`${question.question} (${hint}; see ${question.link}) `)).trim();
        if (!answer) break;
        if (question.part === "plans") {
          answers.plans = answer === "off" ? false : answer;
          break;
        }
        if (answer === "next" || answer === "lowest-free") {
          answers.storyIds = answer;
          break;
        }
        console.error("Answer next or lowest-free, or press Enter for not now.");
      }
    }
  } finally {
    lines.close();
  }
  return answers;
}

const changeWords: Record<UpgradeApplyResult["changes"][number]["action"], string> = {
  add: "add",
  replace: "replace",
  update: "update",
  record: "record",
  ask: "ask",
  keep: "keep",
};

/** What applying the review changes, as people read it at a terminal: the overview, the changes, then the questions. */
export function upgradeApplyText(result: UpgradeApplyResult, diff = false): string {
  const shown = result.changes.filter(change => change.action !== "keep" && change.action !== "ask");
  const lines = [...upgradeOverviewLines(result.overview).map(escapeText), ""];
  if (shown.length) {
    const rows = shown.map(change => [change.title, changeWords[change.action], change.change].map(escapeText));
    const widths = [0, 1].map(column => Math.max(...[["Part", "Action"][column], ...rows.map(row => row[column])].map(text => text.length)));
    lines.push(
      result.written ? "Changed:" : "Changes:",
      "",
      `${pad("Part", widths[0])}  ${pad("Action", widths[1])}  Change`,
      ...rows.map(([title, action, change]) => `${pad(title, widths[0])}  ${pad(action, widths[1])}  ${change}`),
    );
    if (diff) for (const change of shown.filter(change => change.diff)) lines.push("", `${escapeText(change.path)}:`, ...change.diff!.trimEnd().split("\n").map(escapeText));
  } else {
    lines.push("Nothing to change.");
  }
  if (result.questions.length) {
    lines.push("", "To ask the person, and record only their answer:", "");
    for (const question of result.questions) lines.push(`- ${question.question} Answer with ${question.option}. See ${question.link}`);
    lines.push("", "Not now leaves a choice unset, so it is asked again.");
  }
  lines.push("");
  if (result.written) lines.push(`Wrote ${result.files.map(escapeText).join(", ")}. Review the changes, and commit them in a pull request.`);
  else if (result.changed) lines.push(`Apply these changes? Run again with --write.${diff ? "" : " Add --diff to see each file's diff."}`);
  else lines.push("Nothing was changed.");
  return lines.join("\n");
}

/** The result as Markdown for a pull request description: the overview, then a table of the changes. */
export function upgradeApplyMarkdown(result: UpgradeApplyResult): string {
  const [heading, ...overview] = upgradeOverviewLines(result.overview);
  const shown = result.changes.filter(change => change.action !== "keep" && change.action !== "ask");
  const lines = [
    `### ${inline(heading)}`,
    ...overview.flatMap((line, index) => line && !line.startsWith("- ") && overview[index - 1] && !overview[index - 1].startsWith("- ") ? ["", inline(line)] : [inline(line)]),
  ];
  if (shown.length) {
    lines.push("", `### ${result.written ? "Changed" : "Changes"}`, "", "| Part | Action | Change |", "| --- | --- | --- |", ...shown.map(change => `| ${cell(change.title)} | ${cell(changeWords[change.action])} | ${cell(change.change)} |`));
  }
  if (result.questions.length) {
    lines.push("", "### To ask the person", "", ...result.questions.map(question => `- ${inline(question.question)} See ${inline(question.link)}`));
  }
  return `${lines.join("\n")}\n`;
}

async function runApply(options: UpgradeOptions) {
  const apply = (answers: UpgradeAnswers, write: boolean) =>
    applyUpgrade({ root: options.root, map: options.map, mode: options.mode, parts: options.parts, answers, write });
  let result;
  try {
    // At a terminal, ask the choices nobody has made before writing anything.
    let answers = options.answers;
    if (options.write && atTerminal(options)) {
      const planned = await apply(answers, false);
      if (planned.questions.length) answers = { ...answers, ...(await askOnTerminal(planned.questions)) };
    }
    result = await apply(answers, options.write);
  } catch (error) {
    // A refused upgrade, such as a file that changed meanwhile or a link out of the repository, writes nothing.
    if (!(error instanceof Error)) throw error;
    console.error(`story-map: ${escapeText(error.message)}`);
    process.exitCode = 1;
    return;
  }
  if (options.format === "json") {
    const { report, ...rest } = result;
    printJson("upgrade", { ...report, ...rest });
  } else if (options.format === "markdown") process.stdout.write(upgradeApplyMarkdown(result));
  else console.log(upgradeApplyText(result, options.diff));
}
