// Tests for the export file name slug in src/export-response.ts.
//
// ESM-175 replaced the trim regex /^[-.]+|-+$/g, which CodeQL flagged as
// polynomial on long runs of hyphens, with a scan from each end. The reference
// below is the slug it replaced (commit 575aa60), kept as the reference for
// what the file name should be. fast-check generates names that are dense in
// the characters the trim treats specially and checks both agree.
//
// For a longer run:
//   FC_NUM_RUNS=300000 node --test test/export-slug.property.test.js
// A failure prints a seed and path; pass them to fc.assert to replay it.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { fileSlug } from "../dist/export-response.js";
import { assertFasterThan } from "./fixtures/timing.mjs";

const numRuns = Number(process.env.FC_NUM_RUNS) || 1000;

// The reference implementation.
const referenceFileSlug = value =>
  value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 80);

const nameChar = fc.constantFrom("-", "-", "-", ".", ".", "_", " ", "a", "Z", "0", "é", "🚀", "\r", "\n", '"', "/");
const name = fc.oneof(
  fc.string({ unit: nameChar, maxLength: 200 }),
  fc.string({ maxLength: 120 }),
);

test("ESM-175: the export slug matches the regex it replaced", () => {
  fc.assert(
    fc.property(name, value => {
      assert.equal(fileSlug(value), referenceFileSlug(value));
    }),
    { numRuns },
  );
});

test("ESM-175: the export slug stays fast on a long run of hyphens", () => {
  const value = `.-.-${"-".repeat(50_000)}Map.${"-".repeat(50_000)}x${"-".repeat(100_000)}`;
  const started = performance.now();
  const slug = fileSlug(value);
  assertFasterThan(started, 100);
  assert.equal(slug, `map.${"-".repeat(76)}`);
});
