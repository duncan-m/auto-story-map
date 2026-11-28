// Prints the coverage totals from c8's json-summary report as a Markdown table, against the floors in .c8rc.json.
// CI appends the output to the job summary (ESM-177). Run `npm run coverage` first.
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const config = JSON.parse(await readFile(new URL(".c8rc.json", root), "utf8"));
let summary;
try {
  summary = JSON.parse(await readFile(new URL("coverage/coverage-summary.json", root), "utf8"));
} catch {
  console.log("No coverage report was written. See the coverage step's log.");
  process.exit(0);
}

const rows = [
  ["Lines", summary.total.lines, config.lines],
  ["Branches", summary.total.branches, config.branches],
  ["Functions", summary.total.functions, config.functions],
];
const files = Object.keys(summary).length - 1;
console.log(`### Test coverage\n\n${files} production modules in \`src/\`.\n`);
console.log("| Measure | Covered | Total | Coverage | Floor |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const [name, { covered, total, pct }, floor] of rows) {
  const mark = pct < floor ? " ❌" : "";
  console.log(`| ${name} | ${covered} | ${total} | ${pct.toFixed(2)}%${mark} | ${floor}% |`);
}
