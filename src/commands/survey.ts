import { RepositorySurveyError, surveyRepository, type RepositorySurvey } from "../survey.js";
import { count, defineCommand, escapeText, optionValue, printJson, readFormat } from "./shared.js";

const formats = ["text", "json"] as const;

interface SurveyOptions {
  format: (typeof formats)[number];
  root: string;
  tags?: string;
  changelog?: string;
  docs: string[];
  plans: string[];
}

const more = (n: number | undefined, one: string, many: string) => (n ? [`    ${count(n, one, many)}`] : []);

function surveyText(survey: RepositorySurvey): string {
  const lines: string[] = [];
  if (survey.history) {
    const { commits, firstCommitAt, lastCommitAt } = survey.history;
    lines.push(`History:  ${count(commits, "commit", "commits")}, ${escapeText(firstCommitAt.slice(0, 10))} to ${escapeText(lastCommitAt.slice(0, 10))}`);
  }
  lines.push(`Releases: ${survey.releases.length + (survey.moreReleases ?? 0) || "none found"}`);
  lines.push(...more(survey.moreReleases, "older release left out", "older releases left out"));
  for (const release of survey.releases) {
    const from = [release.tag ? `tag ${escapeText(release.tag.name)}` : "", release.changelog ? escapeText(release.changelog.source) : ""].filter(Boolean).join(", ");
    const entries = release.changelog ? `, ${count(release.changelog.entries.length + (release.changelog.moreEntries ?? 0), "entry", "entries")}` : "";
    lines.push(`  ${escapeText(release.suggestedId)}  ${escapeText(release.version)}${release.date ? ` (${escapeText(release.date.slice(0, 10))})` : ""}  ${from}${entries}`);
  }
  lines.push(`Docs:     ${survey.docs.length + (survey.moreDocs ?? 0) || "none found"}`);
  for (const doc of survey.docs) {
    lines.push(`  ${escapeText(doc.file)}${doc.title ? `  ${escapeText(doc.title)}` : ""} (${count(doc.headings.length + (doc.moreHeadings ?? 0), "heading", "headings")})`);
  }
  lines.push(...more(survey.moreDocs, "more doc", "more docs"));
  lines.push(`Open plans: ${survey.plans.length + (survey.morePlans ?? 0) || "none found"}${survey.closedPlans ? `, and ${count(survey.closedPlans, "finished plan", "finished plans")} left out` : ""}`);
  for (const plan of survey.plans) {
    lines.push(`  ${escapeText(plan.file)}${plan.title ? `  ${escapeText(plan.title)}` : ""}`);
    if (plan.status) lines.push(`    Status: ${escapeText(plan.status)}`);
  }
  lines.push(...more(survey.morePlans, "more plan", "more plans"));
  lines.push(`TODO and FIXME comments: ${survey.todos.length + (survey.moreTodos ?? 0) || "none found"}`);
  for (const todo of survey.todos) lines.push(`  ${escapeText(todo.file)}:${todo.line}  ${todo.kind} ${escapeText(todo.text)}`);
  lines.push(...more(survey.moreTodos, "more comment", "more comments"));
  return lines.join("\n");
}

export default defineCommand({
  parse(rest: string[]): SurveyOptions | null {
    const options: SurveyOptions = { format: "text", root: ".", docs: [], plans: [] };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (!["--format", "--root", "--tags", "--changelog", "--docs", "--plans"].includes(name)) return null;
      const [value, next] = optionValue(rest, index, name);
      index = next;
      if (name === "--format") options.format = readFormat(value, formats);
      else if (name === "--root") options.root = value;
      else if (name === "--tags") options.tags = value;
      else if (name === "--changelog") options.changelog = value;
      else if (name === "--docs") options.docs.push(value);
      else options.plans.push(value);
    }
    return options;
  },

  async run(options) {
    let survey;
    try {
      survey = await surveyRepository({
        root: options.root,
        tags: options.tags,
        changelog: options.changelog,
        docs: options.docs.length ? options.docs : undefined,
        plans: options.plans.length ? options.plans : undefined,
      });
    } catch (error) {
      console.error(`story-map: ${escapeText(error instanceof Error ? error.message : String(error))}`);
      process.exitCode = error instanceof RepositorySurveyError ? 2 : 1;
      return;
    }
    if (options.format === "json") {
      printJson("survey", survey);
      return;
    }
    for (const note of survey.notes) console.error(`note: ${escapeText(note)}`);
    console.log(surveyText(survey));
  },
});
