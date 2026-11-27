import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse as parseYaml } from "yaml";
import { initParts, initStoryMap, type InitPart } from "../init.js";
import { describeUpgradeState, upgradeReport, type UpgradePart, type UpgradePartId, type UpgradeReport } from "../upgrade.js";
import { applyUpgrade, parseUpgradeParts, type UpgradeAnswers, type UpgradeApplyMode, type UpgradeApplyResult } from "../upgrade-apply.js";
import { upgradeOverviewLines } from "../upgrade-overview.js";
import { ArgumentError, defineCommand, escapeText, optionValue } from "./shared.js";
import upgrade, { askOnTerminal, atTerminal } from "./upgrade.js";

interface InitCommandOptions {
  ci: boolean;
  skill: boolean;
  dir: string;
  /** Set by --mode, or advanced by --apply. Left out, the map's settings.upgrade decides, or simple. */
  mode?: UpgradeApplyMode;
  /** The parts named with --apply. */
  parts?: UpgradePartId[];
  answers: UpgradeAnswers;
}

const pad = (text: string, width: number) => text.padEnd(width);
const isInitPart = (part: UpgradePartId): part is InitPart => (initParts as readonly string[]).includes(part);

export default defineCommand({
  parse(rest: string[]): InitCommandOptions | null {
    const options: InitCommandOptions = { ci: true, skill: false, dir: ".", answers: {} };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      if (arg === "--no-ci") {
        options.ci = false;
        continue;
      }
      if (arg === "--skill") {
        options.skill = true;
        continue;
      }
      const name = arg.split("=")[0];
      if (!["--dir", "--mode", "--apply", "--plans", "--story-ids"].includes(name)) return null;
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--dir") options.dir = value;
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
      if (options.mode === "simple") throw new ArgumentError("--apply names the parts to add in advanced mode; simple mode adds the recommended set");
      if (!options.ci && options.parts.includes("workflow")) throw new ArgumentError("--no-ci leaves out the workflow, so leave it out of --apply too");
      options.mode = "advanced";
    }
    return { ...options, dir: resolve(options.dir) };
  },

  async run(options) {
    let report;
    try {
      report = await upgradeReport({ root: options.dir });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    if (report.overview.kind !== "install") {
      await handOver(options, report);
      return;
    }

    const mode = options.mode ?? (await recordedMode(options.dir)) ?? "simple";
    let parts: InitPart[] | undefined;
    if (mode === "simple") parts = recommendedParts(report, options);
    else if (options.parts) parts = chosenParts(options.parts, options);

    if (!parts) {
      // Advanced mode with nothing chosen yet: show the parts, and ask at a terminal.
      console.log(installText(report, options));
      if (!atTerminal({ format: "text" })) {
        console.log(`\nNothing was written. To add the parts you choose, run init again with --apply <parts>, such as --apply ${recommendedParts(report, options).join(",")}.`);
        return;
      }
      parts = await askForParts(recommendedParts(report, options));
      if (!parts.length) {
        console.log("\nNothing was written.");
        return;
      }
    } else {
      console.log(installText(report, options, parts));
    }

    let steps;
    try {
      steps = await initStoryMap(options.dir, { ci: options.ci, skill: options.skill, parts });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    console.log("");
    for (const step of steps) {
      console.log(`${step.action.padEnd(8)} ${step.path}${step.reason ? ` (${step.reason})` : ""}`);
    }

    let choices;
    try {
      choices = await recordChoices(options);
    } catch (error) {
      console.error(`story-map: ${escapeText(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = 1;
      return;
    }
    for (const change of choices.changes.filter(change => change.action === "record")) {
      console.log(`${"recorded".padEnd(8)} ${change.title.toLowerCase()} (settings.${change.part}: ${JSON.stringify(change.value)})`);
    }
    for (const question of choices.questions) {
      console.log(`${"ask".padEnd(8)} ${question.part === "plans" ? "delivery plans" : "story ID policy"} (not chosen yet; see ${question.link})`);
    }
    const asks = choices.questions.map(question => (question.part === "plans" ? "whether to use delivery plans" : "which story ID policy to use"));
    console.log(`
Next, ask an agent in this repository to populate the map:

  Populate product/story-map.yaml for this product using the first-run workflow
  in docs/story-map.md. Start with the primary user journey and cite the
  evidence for each story. Validate the map and flag any uncertain release or
  status decisions for review.${asks.length ? `
  Then ask me ${asks.join(" and ")},
  linking to the guide sections listed above, and record my answers with
  \`story-map settings\`.` : ""}`);
  },
});

/**
 * The parts simple mode adds: every part, as init always has, less the
 * workflow with --no-ci, and the skill only with --skill.
 */
function recommendedParts(report: UpgradeReport, options: InitCommandOptions): InitPart[] {
  return report.parts
    .map(part => part.part)
    .filter(isInitPart)
    .filter(part => (part === "workflow" ? options.ci : part === "skill" ? options.skill : true));
}

/** The parts named with --apply, with the skill when --skill is given too. The choices are asked either way. */
function chosenParts(named: readonly UpgradePartId[], options: InitCommandOptions): InitPart[] {
  const parts = named.filter(isInitPart);
  if (options.skill && !parts.includes("skill")) parts.push("skill");
  return parts;
}

/** What init does with one part, in a few words. */
function initChange(part: UpgradePart, options: InitCommandOptions, parts: readonly InitPart[] | undefined): string {
  if (part.kind === "choice") {
    const answer = options.answers[part.part as "plans" | "storyIds"];
    return answer === undefined ? "ask the person; not now leaves it unset" : `record ${JSON.stringify(answer)}`;
  }
  if (part.part === "workflow" && !options.ci) return "left out (--no-ci)";
  if (!parts) return part.recommendation === "optional" ? "optional; add it with --apply skill" : "add";
  if (!parts.includes(part.part as InitPart)) return part.part === "skill" ? "not added; add it with --skill" : "not added (not chosen)";
  return part.part === "skill" ? "add, with a short pointer in AGENTS.md" : "add";
}

/** The install overview, then the list of parts, all not added, and what init does with each. */
export function installText(report: UpgradeReport, options: InitCommandOptions, parts?: readonly InitPart[]): string {
  const rows = report.parts.map(part => [part.title, describeUpgradeState(part), initChange(part, options, parts)].map(escapeText));
  const widths = [0, 1].map(column => Math.max(...[["Part", "State"][column], ...rows.map(row => row[column])].map(text => text.length)));
  return [
    ...upgradeOverviewLines(report.overview).map(escapeText),
    "",
    `Parts of the set-up, from auto-story-map ${escapeText(report.packageVersion)}`,
    "",
    `${pad("Part", widths[0])}  ${pad("State", widths[1])}  Change`,
    ...rows.map(([title, state, change]) => `${pad(title, widths[0])}  ${pad(state, widths[1])}  ${change}`),
  ].join("\n");
}

/** Asks at a terminal which parts to add. Enter takes the recommended set. */
async function askForParts(recommended: readonly InitPart[]): Promise<InitPart[]> {
  const lines = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (;;) {
      const answer = (await lines.question(`\nWhich parts should init add? (${initParts.join(", ")}, separated by commas, none, or Enter for ${recommended.join(",")}) `)).trim();
      if (!answer) return [...recommended];
      if (answer === "none") return [];
      try {
        const parts = parseUpgradeParts(answer).filter(isInitPart);
        if (parts.length) return parts;
      } catch {
        // Ask again.
      }
      console.error(`Name one or more of ${initParts.join(", ")}, or none.`);
    }
  } finally {
    lines.close();
  }
}

/**
 * Records the person's answers to the product choices, asking them first at
 * a terminal, through the upgrade review, so the answers pass the same checks
 * as `story-map settings`. Only the choices change: every file part is kept.
 */
async function recordChoices(options: InitCommandOptions): Promise<UpgradeApplyResult> {
  const apply = (answers: UpgradeAnswers, write: boolean) =>
    applyUpgrade({ root: options.dir, mode: "advanced", parts: ["plans", "storyIds"], answers, write });
  let answers = options.answers;
  if (atTerminal({ format: "text" })) {
    const planned = await apply(answers, false);
    if (planned.questions.length) answers = { ...answers, ...(await askOnTerminal(planned.questions)) };
  }
  return apply(answers, true);
}

/**
 * The mode the person chose for the review, from the map's `settings.upgrade`.
 * Stand-in until ESM-170's `upgradeReport().mode` lands.
 */
async function recordedMode(dir: string): Promise<UpgradeApplyMode | undefined> {
  try {
    const map = parseYaml(await readFile(join(dir, "product/story-map.yaml"), "utf8")) as { settings?: { upgrade?: unknown } } | null;
    const mode = map?.settings?.upgrade;
    return mode === "simple" || mode === "advanced" ? mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A repository that is already set up gets the upgrade review instead, as a
 * dry run, with the same mode, parts and answers. Nothing is written.
 */
async function handOver(options: InitCommandOptions, report: UpgradeReport) {
  const answered = options.answers.plans !== undefined || options.answers.storyIds !== undefined;
  // Answers apply only in a mode, so with no mode they go with simple mode's dry run.
  const mode = options.mode ?? (answered ? "simple" : undefined);
  const args = [
    ...(options.parts ? ["--apply", options.parts.join(",")] : mode ? ["--mode", mode] : []),
    ...(options.answers.plans === undefined ? [] : ["--plans", options.answers.plans === false ? "off" : options.answers.plans]),
    ...(options.answers.storyIds === undefined ? [] : ["--story-ids", options.answers.storyIds]),
  ];
  console.log("This repository is already set up, so init hands over to story-map upgrade.\n");
  await upgrade.run(upgrade.parse(["--root", options.dir, ...args])!);
  if (process.exitCode || (report.overview.kind === "current" && !args.length)) return;
  const apply = args.length ? args.join(" ") : "--mode simple";
  console.log(`\nTo apply the changes, run story-map upgrade ${apply} --write${options.parts ? "" : ", or --apply <parts> --write for only the parts you accept"}.`);
}
