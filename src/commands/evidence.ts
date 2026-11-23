import { resolve } from "node:path";
import { gatherStoryEvidence, StoryEvidenceError, type StoryEvidence } from "../evidence.js";
import { count, defineCommand, escapeText, loadInputsOrReport, loadMapOrReport, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "json"] as const;

interface EvidenceOptions {
  format: (typeof formats)[number];
  map: string;
  root: string;
  defaultBranch?: string;
  history?: string;
  shippedTags?: string;
  plans: string[];
  tests: string[];
  ids: string[];
}

function storyText(story: StoryEvidence, defaultBranch: string | undefined): string {
  const lines = [`${escapeText(story.id)}  ${escapeText(story.title)}`];
  const suggestion = story.suggestedStatus === story.status ? "no change suggested" : `suggests ${story.suggestedStatus}`;
  lines.push(`  Status:    ${story.status}${story.stalled ? " (stalled)" : ""}, ${suggestion}`);
  for (const reason of story.reasons) lines.push(`    ${escapeText(reason)}`);
  if (story.shippedIn) lines.push(`  Shipped in: ${escapeText(story.shippedIn.tag)} (${escapeText(story.shippedIn.commit.slice(0, 7))})`);
  if (story.branches.length) {
    lines.push("  Branches:");
    for (const branch of story.branches) {
      lines.push(`    ${escapeText(branch.name)} (${escapeText(branch.commit.slice(0, 7))}, ${escapeText(branch.committedAt.slice(0, 10))}${branch.merged ? ", merged" : ""})`);
    }
  }
  if (story.commits.length) {
    lines.push(`  Commits on ${escapeText(defaultBranch ?? "the default branch")}:`);
    for (const commit of story.commits) {
      const ref = commit.pullRequest ? `#${commit.pullRequest} ` : "";
      lines.push(`    ${escapeText(commit.committedAt.slice(0, 10))}  ${ref}${escapeText(commit.commit.slice(0, 7))} ${escapeText(commit.subject)} [${commit.changes}${commit.named === "message" ? ", below the title" : ""}]`);
    }
    if (story.moreCommits) lines.push(`    ${count(story.moreCommits, "more commit", "more commits")}`);
  }
  if (story.plans.length) {
    lines.push("  Plans:");
    for (const mention of story.plans) lines.push(`    ${escapeText(mention.file)}:${mention.line}  ${escapeText(mention.text)}`);
    if (story.morePlans) lines.push(`    ${count(story.morePlans, "more mention", "more mentions")}`);
  }
  lines.push(`  Tests:     ${story.tests.length || story.moreTests ? count(story.tests.length + (story.moreTests ?? 0), "tagged test", "tagged tests") : "none tagged"}`);
  for (const test of story.tests) lines.push(`    ${escapeText(test.file)}:${test.line}  ${escapeText(test.name)}`);
  if (story.moreTests) lines.push(`    ${count(story.moreTests, "more test", "more tests")}`);
  if (story.brokenSources.length) {
    lines.push("  Broken sources:");
    for (const source of story.brokenSources) lines.push(`    ${escapeText(source.source)}: ${escapeText(source.message)}`);
  }
  return lines.join("\n");
}

export default defineCommand({
  parse(rest: string[]): EvidenceOptions | null {
    const options: EvidenceOptions = { format: "text", map: "product/story-map.yaml", root: ".", plans: [], tests: [], ids: [] };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (["--format", "--map", "--root", "--default-branch", "--history", "--shipped-tags", "--plans", "--tests"].includes(name)) {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--format") options.format = readFormat(value, formats);
        else if (name === "--map") options.map = value;
        else if (name === "--root") options.root = value;
        else if (name === "--default-branch") options.defaultBranch = value;
        else if (name === "--history") options.history = value;
        else if (name === "--shipped-tags") options.shippedTags = value;
        else if (name === "--plans") options.plans.push(value);
        else options.tests.push(value);
      } else if (arg.startsWith("-")) {
        return null;
      } else {
        options.ids.push(arg);
      }
    }
    return options;
  },

  async run(options) {
    const loaded = await loadMapOrReport(options.map);
    if (!loaded) return;
    const inputs = await loadInputsOrReport({ history: options.history });
    if (!inputs) return;
    let result;
    try {
      result = await gatherStoryEvidence(loaded, {
        root: resolve(options.root),
        map: resolve(options.map),
        ids: options.ids,
        defaultBranch: options.defaultBranch,
        plans: options.plans.length ? options.plans : undefined,
        tests: options.tests.length ? options.tests : undefined,
        history: inputs.history,
        shippedTags: options.shippedTags,
      });
    } catch (error) {
      console.error(`story-map: ${escapeText(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = error instanceof StoryEvidenceError ? 2 : 1;
      return;
    }
    if (result.missing.length) process.exitCode = 1;
    if (options.format === "json") {
      printJson("evidence", result);
      return;
    }
    for (const note of result.notes) console.error(`note: ${escapeText(note)}`);
    if (result.stories.length) console.log(result.stories.map(story => storyText(story, result.defaultBranch)).join("\n\n"));
    else if (!result.missing.length) console.log("No active stories.");
    for (const { id, suggestions } of result.missing) {
      const hint = suggestions.length ? ` Did you mean ${suggestions.map(escapeText).join(", ")}?` : "";
      console.error(`${escapeText(id)}: no story with this ID in ${escapeText(options.map)}.${hint}`);
    }
  },
});
