import { resolve } from "node:path";
import { storyMapBriefDetails, type StoryMapBriefRequest, type StoryMapBriefTarget } from "../brief.js";
import { gatherStoryEvidence, StoryEvidenceError, type StoryEvidence } from "../evidence.js";
import { getStoryMapForViewer, type StoryMapView } from "../view.js";
import { ArgumentError, defineCommand, escapeLines, escapeText, loadInputsOrReport, loadMapOrReport, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "json"] as const;

interface BriefCommandOptions {
  format: (typeof formats)[number];
  map: string;
  root: string;
  history?: string;
  tests?: string;
  target: StoryMapBriefTarget;
  full: boolean;
  readFirst: string[];
  evidence: boolean;
  defaultBranch?: string;
  claims?: { remote?: string; store?: string };
}

export default defineCommand({
  parse(rest: string[]): BriefCommandOptions | null {
    const ids: string[] = [];
    let release: string | undefined;
    let activity: string | undefined;
    const options: Omit<BriefCommandOptions, "target"> = { format: "text", map: "product/story-map.yaml", root: ".", full: false, readFirst: [], evidence: true };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (["--format", "--map", "--root", "--history", "--tests-index", "--release", "--activity", "--read-first", "--default-branch", "--claims-remote", "--claims-store"].includes(name)) {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--format") options.format = readFormat(value, formats);
        else if (name === "--map") options.map = value;
        else if (name === "--root") options.root = value;
        else if (name === "--history") options.history = value;
        else if (name === "--tests-index") options.tests = value;
        else if (name === "--release") release = value;
        else if (name === "--activity") activity = value;
        else if (name === "--read-first") options.readFirst.push(value);
        else if (name === "--default-branch") options.defaultBranch = value;
        else if (name === "--claims-remote") options.claims = { ...options.claims, remote: value };
        else options.claims = { ...options.claims, store: value };
      } else if (arg === "--full") {
        options.full = true;
      } else if (arg === "--claims") {
        options.claims = { ...options.claims };
      } else if (arg === "--no-evidence") {
        options.evidence = false;
      } else if (arg.startsWith("-")) {
        return null;
      } else {
        ids.push(arg);
      }
    }
    const scopes = [ids.length > 0, release !== undefined, activity !== undefined].filter(Boolean).length;
    if (scopes !== 1) throw new ArgumentError("brief needs story IDs, --release <ID> or --activity <ID>, and only one of them.");
    if (!options.evidence && options.claims) throw new ArgumentError("--claims reads claims with the evidence, so it cannot be used with --no-evidence.");
    const target: StoryMapBriefTarget = release !== undefined ? { release } : activity !== undefined ? { activity } : ids.length === 1 ? { story: ids[0] } : { stories: ids };
    return { ...options, target };
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    const inputs = await loadInputsOrReport({ history: options.history, tests: options.tests });
    if (!inputs) return;
    // Whoever runs the CLI has the YAML file, so the brief is always written from the internal view.
    const view = getStoryMapForViewer(loaded.map, {}, { canViewInternal: () => true, ...inputs }) as Extract<StoryMapView, { audience: "internal" }>;
    const request: StoryMapBriefRequest = {
      ...options.target,
      mapPath: options.map,
      full: options.full,
      ...(options.readFirst.length ? { readFirst: options.readFirst.map(path => ({ path })) } : {}),
    };

    let targets: string[];
    try {
      targets = storyMapBriefDetails(view, request).targets;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      console.error(`story-map: ${escapeText(error.message)}`);
      process.exitCode = 1;
      return;
    }

    // The in-flight section uses what story-map evidence finds, so the brief never reads Git a second way.
    let evidence: StoryEvidence[] = [];
    const notes: string[] = [];
    if (options.evidence && targets.length) {
      try {
        const found = await gatherStoryEvidence(loaded, {
          root: resolve(options.root),
          map: resolve(options.map),
          ids: targets,
          defaultBranch: options.defaultBranch,
          history: inputs.history,
          claims: options.claims,
        });
        evidence = found.stories;
        notes.push(...found.notes);
        if (found.defaultBranch) request.baseBranch = found.defaultBranch.replace(/^origin\//, "");
      } catch (error) {
        if (!(error instanceof StoryEvidenceError)) throw error;
        console.error(`story-map: ${escapeText(error.message)}`);
        process.exitCode = 2;
        return;
      }
    }

    const details = storyMapBriefDetails(view, { ...request, evidence });
    if (options.format === "json") {
      printJson("brief", { ...details, ...(notes.length ? { notes } : {}) });
      return;
    }
    for (const note of notes) console.error(`note: ${escapeText(note)}`);
    // Map text is already escaped for the brief. This also keeps control characters out of the terminal.
    process.stdout.write(escapeLines(details.brief).join("\n"));
  },
});
