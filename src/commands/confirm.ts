import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { proposeDraftConfirmation, StoryMapEditError, type StoryMapDraft, type StoryMapDraftTarget } from "../edit.js";
import { jobStatement } from "../personas.js";
import { printEditResult, readInside } from "./edit.js";
import { ArgumentError, defineCommand, escapeLines, escapeText, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "json"] as const;

interface ConfirmOptions {
  map: string;
  write: boolean;
  format: (typeof formats)[number];
  target: StoryMapDraftTarget;
  /** The ID the person types back: the job, persona or release. */
  answer: string;
}

/** The lines a reader sees for one draft. */
export function describeDraft(draft: StoryMapDraft): string[] {
  if (draft.kind === "job") {
    const { job, persona } = draft;
    return [
      `Job ${job.id} (${persona.title}): ${jobStatement(job)}`,
      ...(job.steps ?? []).map(step => `  Step: ${step.title}${step.summary ? `. ${step.summary}` : ""}`),
    ];
  }
  if (draft.kind === "context") {
    const { context, persona } = draft;
    return [
      `Context of persona ${persona.id} (${persona.title}):`,
      ...(context.success ? ["  Success:", ...context.success.split("\n").map(line => (line ? `    ${line}` : ""))] : []),
      ...(context.usesToday?.length ? ["  Uses today:", ...context.usesToday.map(item => `    - ${item}`)] : []),
      ...(context.constraints?.length ? ["  Constraints:", ...context.constraints.map(item => `    - ${item}`)] : []),
    ];
  }
  const { item, release, position } = draft;
  return [
    `Impact ${position} of ${release.id} (${release.title}): ${item.metric}`,
    `  Expected: ${item.expected}`,
    ...(item.solves ? [`  Solves: ${item.solves}`] : []),
  ];
}

/**
 * Asks the person to type `answer` back and resolves true only for an exact match.
 * `ask` is the prompt, a readline question on the terminal.
 */
export async function personConfirms(answer: string, ask: (question: string) => Promise<string>): Promise<boolean> {
  return (await ask(`Type ${answer} to confirm: `)).trim() === answer;
}

async function askOnTerminal(question: string) {
  const lines = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await lines.question(question);
  } finally {
    lines.close();
  }
}

export default defineCommand({
  parse(rest: string[]): ConfirmOptions | null {
    let map = "product/story-map.yaml";
    let write = false;
    let format: ConfirmOptions["format"] = "text";
    let impact: string | undefined;
    let allIn: string | undefined;
    const ids: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      const value = () => {
        const [found, next] = optionValue(rest, index, name);
        index = next;
        return found;
      };
      if (arg === "--write") write = true;
      else if (name === "--format") format = readFormat(value(), formats);
      else if (name === "--map") map = value();
      else if (name === "--impact") impact = value();
      else if (name === "--all-in") allIn = value();
      else if (arg.startsWith("-")) return null;
      else ids.push(arg);
    }
    // JSON is for agents and scripts, which have no terminal to confirm on, so it only describes the change.
    if (write && format === "json") throw new ArgumentError("--write asks you to type the ID back, so it does not go with --format json");
    if (allIn !== undefined) {
      if (ids.length || impact !== undefined) throw new ArgumentError("--all-in confirms one persona's jobs, so give no other ID or --impact with it");
      return { map, write, format, target: { allJobsOf: allIn }, answer: allIn };
    }
    if (ids.length !== 1) return null;
    const [id] = ids;
    if (impact === undefined) return { map, write, format, target: { id }, answer: id };
    if (!/^\d+$/.test(impact)) throw new ArgumentError(`--impact must be the item's number in the release's impact list, from 1, not ${impact}`);
    return { map, write, format, target: { release: id, impact: Number(impact) }, answer: id };
  },

  async run(options) {
    const root = process.cwd();
    const refuse = (message: string) => {
      process.exitCode = 1;
      if (options.format === "json") printJson("confirm", { written: false, refused: { message } });
      else console.error(`story-map: ${escapeText(message)}`);
    };
    // Agents run commands without a terminal. Only a person at one can confirm a draft.
    if (options.write && !process.stdin.isTTY) {
      refuse("confirm --write asks you to type the ID back, so it needs a terminal. Agents must not confirm drafts: run it yourself, or leave out --write to see what it would change.");
      return;
    }
    let mapPath: string;
    let result;
    try {
      const map = await readInside(root, options.map);
      mapPath = map.path;
      result = await proposeDraftConfirmation(map.text, options.target, { check: { root } });
    } catch (error) {
      if (!(error instanceof StoryMapEditError)) throw error;
      refuse(error.message);
      return;
    }
    if (!result.valid) process.exitCode = 1;

    const what = "allJobsOf" in options.target ? `${options.target.allJobsOf} has no drafted jobs` : "release" in options.target ? `impact ${options.target.impact} of ${options.target.release} is not a draft` : `${options.target.id} is not a draft`;
    if (options.format === "json") {
      printJson("confirm", {
        written: false,
        valid: result.valid,
        changed: result.changed,
        drafts: result.drafts,
        lineDiff: result.lineDiff,
        ...(result.diff ? { diff: result.diff, summary: result.summary } : {}),
        check: result.check,
        newIssues: result.newIssues,
      });
      return;
    }
    if (!result.changed) {
      console.error(`Nothing to confirm: ${escapeText(what)}.`);
      return;
    }
    console.log(result.drafts.length === 1 ? "Confirms this draft:" : `Confirms these ${result.drafts.length} drafts:`);
    for (const draft of result.drafts) {
      console.log("");
      for (const line of describeDraft(draft).flatMap(escapeLines)) console.log(line);
    }
    console.log("");
    printEditResult(options, result, false);
    if (!options.write || !result.valid) return;
    if (!(await personConfirms(options.answer, askOnTerminal))) {
      process.exitCode = 1;
      console.error("That is not the ID, so nothing was written.");
      return;
    }
    await writeFile(mapPath, result.source);
    console.error(`Wrote ${escapeText(options.map)}.`);
  },
});
