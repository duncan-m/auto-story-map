// Time limits for the tests that check code runs in linear time, such as ESM-175's (ESM-177).
import assert from "node:assert/strict";

/** True while V8 collects coverage, as under `npm run coverage`, where instrumented code runs measurably slower. */
export const measuringCoverage = Boolean(process.env.NODE_V8_COVERAGE);

/**
 * Asserts that less than `limitMs` has passed since `started`, a `performance.now()` reading.
 * Under coverage the time depends more on the instrumentation and the machine's load than on the code,
 * so only the limit is skipped there. The CI cells that run without coverage still enforce it.
 * `coverage` overrides the check for coverage, for testing this helper.
 */
export function assertFasterThan(started, limitMs, message, { coverage = measuringCoverage } = {}) {
  const elapsed = performance.now() - started;
  if (coverage) return;
  assert.ok(elapsed < limitMs, `${message ? `${message}: ` : ""}took ${elapsed.toFixed(1)}ms, over ${limitMs}ms`);
}
