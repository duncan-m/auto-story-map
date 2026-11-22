import { readFile, realpath, writeFile } from "node:fs/promises";
import { proposeStoryMapEdit, StoryMapEditError, type StoryMapEditOperation } from "../edit.js";
import { resolveRootedPath } from "../references.js";
import { ArgumentError, defineCommand, escapeText, optionValue, printJson, readFormat, report } from "./shared.js";

const formats = ["text", "json"] as const;

interface CommonOptions {
  map: string;
  write: boolean;
  format: (typeof formats)[number];
  customer: boolean;
  updatedBy?: string;
  checkSources: boolean;
}

/**
 * Parses the options every editing command takes. `extra` handles a command's own
 * options and returns false for one it does not know. Positionals go to `positional`.
 */
function parseEditArgs(rest: string[], extra: (name: string, value: () => string) => boolean, positional: string[]): CommonOptions | null {
  const options: CommonOptions = { map: "product/story-map.yaml", write: false, format: "text", customer: false, checkSources: false };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const name = arg.split("=")[0];
    const value = () => {
      const [found, next] = optionValue(rest, index, name);
      index = next;
      return found;
    };
    if (arg === "--write") options.write = true;
    else if (arg === "--customer") options.customer = true;
    else if (arg === "--check-sources") options.checkSources = true;
    else if (name === "--format") options.format = readFormat(value(), formats);
    else if (name === "--map") options.map = value();
    else if (name === "--updated-by") options.updatedBy = value();
    else if (arg.startsWith("-")) {
      if (!extra(name, value)) return null;
    } else positional.push(arg);
  }
  return options;
}

/** Reads a file the edit was given, refusing one outside the repository. */
async function readInside(root: string, path: string) {
  const resolved = await resolveRootedPath(root, await realpath(root), path);
  if (resolved.kind === "issue") throw new StoryMapEditError(`${path}: ${resolved.issue.message}`);
  if (resolved.kind === "missing") throw new StoryMapEditError(`${path}: no such file.`);
  return { path: resolved.path, text: await readFile(resolved.path, "utf8") };
}

async function runEdit(options: CommonOptions, operations: () => Promise<StoryMapEditOperation[]>) {
  const root = process.cwd();
  const refuse = (error: unknown) => {
    if (!(error instanceof StoryMapEditError)) throw error;
    process.exitCode = 1;
    if (options.format === "json") printJson("edit", { written: false, refused: { message: error.message, ...(error.operation === undefined ? {} : { operation: error.operation }) } });
    else console.error(`story-map: ${escapeText(error.message)}`);
  };
  let result;
  let mapPath: string;
  try {
    const map = await readInside(root, options.map);
    mapPath = map.path;
    result = await proposeStoryMapEdit(map.text, await operations(), {
      allowCustomer: options.customer,
      updatedBy: options.updatedBy,
      check: { root, checkSources: options.checkSources },
    });
  } catch (error) {
    refuse(error);
    return;
  }
  const written = options.write && result.valid && result.changed;
  if (written) await writeFile(mapPath, result.source);
  if (!result.valid) process.exitCode = 1;

  if (options.format === "json") {
    printJson("edit", {
      written,
      valid: result.valid,
      changed: result.changed,
      ...(result.addedIds.length ? { addedIds: result.addedIds } : {}),
      lineDiff: result.lineDiff,
      ...(result.diff ? { diff: result.diff, summary: result.summary } : {}),
      check: result.check,
      newIssues: result.newIssues,
    });
    return;
  }
  if (!result.changed) {
    console.error("Nothing to change: the map already says this.");
    return;
  }
  process.stdout.write(escapeDiff(result.lineDiff));
  if (result.summary) console.log(`\n${escapeDiff(result.summary.trimEnd())}`);
  // Errors stop the write wherever they are. Warnings the map already had are not this edit's doing.
  const shown = result.check.issues.filter(issue => issue.severity === "error" || result.newIssues.includes(issue));
  for (const issue of shown) report(options.map, issue);
  const older = result.check.warnings - shown.filter(issue => issue.severity === "warning").length;
  if (older) console.error(`${older} ${older === 1 ? "warning" : "warnings"} the map already had, not shown. Run story-map validate to see them.`);
  for (const id of result.addedIds) console.error(`Added ${escapeText(id)}.`);
  if (!result.valid) console.error(`The edited map is not valid, so ${options.write ? "it was not written" : "it cannot be written"}.`);
  else if (written) console.error(`Wrote ${escapeText(options.map)}.`);
  else console.error("Dry run: nothing written. Run again with --write to save.");
}

/** Each diff line is map text, so escape its controls but keep the line structure. */
const escapeDiff = (diff: string) => diff.split("\n").map(escapeText).join("\n");

export const edit = defineCommand({
  parse(rest: string[]) {
    const fields: Partial<Record<"status" | "reason" | "release" | "activity" | "title" | "summary" | "notes" | "customerTitle" | "customerSummary" | "from", string>> = {};
    const lists: [option: string, op: string, key: string][] = [
      ["--add-source", "add-source", "source"], ["--remove-source", "remove-source", "source"],
      ["--add-job", "add-job", "job"], ["--remove-job", "remove-job", "job"],
      ["--add-persona", "add-persona", "persona"], ["--remove-persona", "remove-persona", "persona"],
    ];
    const listEdits: unknown[] = [];
    const ids: string[] = [];
    const names: Record<string, keyof typeof fields> = {
      "--status": "status", "--reason": "reason", "--release": "release", "--activity": "activity", "--title": "title",
      "--summary": "summary", "--notes": "notes", "--customer-title": "customerTitle", "--customer-summary": "customerSummary", "--from": "from",
    };
    const common = parseEditArgs(rest, (name, value) => {
      const list = lists.find(([option]) => option === name);
      if (list) listEdits.push({ op: list[1], [list[2]]: value() });
      else if (names[name]) fields[names[name]] = value();
      else return false;
      return true;
    }, ids);
    if (!common) return null;
    if (fields.from) {
      if (ids.length || Object.keys(fields).length > 1 || listEdits.length) throw new ArgumentError("--from takes every edit from the file, so give no story ID or other edits with it");
      return { ...common, from: fields.from };
    }
    if (ids.length !== 1) return null;
    const [id] = ids;
    if (fields.reason && !fields.status) throw new ArgumentError("--reason goes with --status blocked or --status cut");
    const operations: unknown[] = [];
    if (fields.status) operations.push({ op: "status", id, status: fields.status, ...(fields.reason ? { reason: fields.reason } : {}) });
    for (const key of ["release", "activity", "title", "summary", "notes"] as const) {
      if (fields[key]) operations.push({ op: key, id, [key]: fields[key] });
    }
    for (const listEdit of listEdits) operations.push({ ...(listEdit as object), id });
    if (fields.customerTitle) operations.push({ op: "customer-title", id, title: fields.customerTitle });
    if (fields.customerSummary) operations.push({ op: "customer-summary", id, summary: fields.customerSummary });
    if (!operations.length) throw new ArgumentError("say what to change, such as --status in-progress");
    return { ...common, operations: operations as StoryMapEditOperation[] };
  },

  async run(options) {
    await runEdit(options, async () => {
      if (!("from" in options)) return options.operations;
      const file = await readInside(process.cwd(), options.from);
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.text);
      } catch (error) {
        throw new StoryMapEditError(`${options.from}: not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      const operations = Array.isArray(parsed) ? parsed : (parsed as { operations?: unknown })?.operations;
      if (!Array.isArray(operations)) throw new StoryMapEditError(`${options.from}: expected a JSON list of edits, or an object with an operations list.`);
      return operations as StoryMapEditOperation[];
    });
  },
});

export const add = defineCommand({
  parse(rest: string[]) {
    const fields: Record<string, string> = {};
    const sources: string[] = [];
    const jobs: string[] = [];
    const personas: string[] = [];
    const positional: string[] = [];
    const common = parseEditArgs(rest, (name, value) => {
      if (["--id", "--title", "--activity", "--release", "--status", "--reason", "--summary", "--notes"].includes(name)) fields[name.slice(2)] = value();
      else if (name === "--source") sources.push(value());
      else if (name === "--job") jobs.push(value());
      else if (name === "--persona") personas.push(value());
      else return false;
      return true;
    }, positional);
    if (!common || positional.length) return null;
    for (const required of ["title", "activity", "release"]) {
      if (!fields[required]) throw new ArgumentError(`--${required} is required`);
    }
    const operation = {
      op: "add", ...fields, ...(sources.length ? { sources } : {}), ...(jobs.length ? { jobs } : {}), ...(personas.length ? { personas } : {}),
    } as StoryMapEditOperation;
    return { ...common, operations: [operation] };
  },
  async run(options) {
    await runEdit(options, async () => options.operations);
  },
});

export const releaseImpact = defineCommand({
  parse(rest: string[]) {
    const fields: Record<string, string> = {};
    const releases: string[] = [];
    const common = parseEditArgs(rest, (name, value) => {
      if (["--metric", "--expected", "--solves"].includes(name)) fields[name.slice(2)] = value();
      else return false;
      return true;
    }, releases);
    if (!common || releases.length !== 1) return null;
    for (const required of ["metric", "expected"]) {
      if (!fields[required]) throw new ArgumentError(`--${required} is required`);
    }
    return { ...common, operations: [{ op: "release-impact", release: releases[0], ...fields } as StoryMapEditOperation] };
  },
  async run(options) {
    await runEdit(options, async () => options.operations);
  },
});
