import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTextFileWithin } from "../dist/read-text.js";

test("ESM-178: reads a file up to the size limit and skips a larger one", async t => {
  const dir = await mkdtemp(join(tmpdir(), "story-map-read-text-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "notes.md");
  await writeFile(file, "# Notes\n\nçà\n");
  const size = Buffer.byteLength("# Notes\n\nçà\n");

  assert.equal(await readTextFileWithin(file, size), "# Notes\n\nçà\n");
  assert.equal(await readTextFileWithin(file, size - 1), undefined);
  await assert.rejects(readTextFileWithin(join(dir, "missing.md"), size), { code: "ENOENT" });
});
