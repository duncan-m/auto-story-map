// Property tests for escapeRegExp in src/references.ts.
//
// ESM-187 replaced seven hand-written copies with one helper. fast-check
// generates text dense in regular-expression metacharacters, backslash
// included, and checks the escaped pattern matches that text and nothing else.
//
// For a longer run:
//   FC_NUM_RUNS=300000 node --test test/escape-regexp.property.test.js
// A failure prints a seed and path; pass them to fc.assert to replay it.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { escapeRegExp } from "../dist/references.js";

const numRuns = Number(process.env.FC_NUM_RUNS) || 1000;

// Every metacharacter, plus characters that only matter in some positions
// (such as - and / ) and a few plain ones so literal runs appear too.
const special = [..."\\^$.*+?()[]{}|-/"];
const unit = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...special, "a", "b", "0", " ", "\n") },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", minLength: 1, maxLength: 1 }) },
);
const text = fc.string({ unit, maxLength: 12 });

const literal = s => new RegExp(`^${escapeRegExp(s)}$`);

// Strings one edit away from s: a character replaced, inserted or removed.
// A missing escape shows up here, as when "a.b" would also match "axb".
const nearMiss = text.chain(s =>
  fc.tuple(fc.nat({ max: s.length }), unit, fc.constantFrom("replace", "insert", "remove")).map(([at, c, edit]) => {
    const chars = [...s];
    if (edit === "insert") chars.splice(at, 0, c);
    else if (at < chars.length) chars.splice(at, 1, ...(edit === "replace" ? [c] : []));
    return { s, other: chars.join("") };
  }),
);

test("ESM-187: escaped text matches itself and nothing else", () => {
  fc.assert(
    fc.property(text, fc.array(text, { maxLength: 8 }), (s, others) => {
      const pattern = literal(s);
      assert.ok(pattern.test(s), `matches ${JSON.stringify(s)}`);
      for (const other of others) assert.equal(pattern.test(other), other === s, `${JSON.stringify(s)} against ${JSON.stringify(other)}`);
    }),
    { numRuns },
  );
});

test("ESM-187: escaped text does not match a string one edit away", () => {
  fc.assert(
    fc.property(nearMiss, ({ s, other }) => {
      assert.equal(literal(s).test(other), other === s, `${JSON.stringify(s)} against ${JSON.stringify(other)}`);
    }),
    { numRuns },
  );
});

test("ESM-187: escaped text matches itself inside a larger pattern and with flags", () => {
  fc.assert(
    fc.property(text, text, text, (before, s, after) => {
      for (const flags of ["", "i", "u", "m", "s"]) {
        const match = new RegExp(`(${escapeRegExp(s)})`, flags).exec(before + s + after);
        assert.ok(match, `finds ${JSON.stringify(s)} with flags "${flags}"`);
      }
    }),
    { numRuns },
  );
});

test("ESM-187: escapes every metacharacter, backslash included", () => {
  assert.equal(escapeRegExp("\\^$.*+?()[]{}|"), "\\\\\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|");
  assert.equal(escapeRegExp("ESM-187"), "ESM-187");
  assert.equal(escapeRegExp(""), "");
});
