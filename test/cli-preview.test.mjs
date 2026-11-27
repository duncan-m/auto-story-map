import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const sample = await readFile(new URL("./fixtures/builder-estimates.yaml", import.meta.url), "utf8");

/** Starts story-map preview on a free port and resolves with its base URL once it is listening. */
async function startPreview(t, ...args) {
  const child = spawn(process.execPath, [cli, "preview", "--port", "0", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  let output = "";
  const base = await new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      output += chunk;
      const found = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
      if (found) resolve(`http://127.0.0.1:${found[1]}`);
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("exit", code => reject(new Error(`preview exited with ${code}: ${output}`)));
  });
  return base;
}

/** A GET with a chosen Host header, which fetch does not allow. */
function get(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request({ host: target.hostname, port: target.port, path: target.pathname + target.search, headers: host ? { Host: host } : {} }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function scratchMap(t, source = sample) {
  const directory = await mkdtemp(join(tmpdir(), "story-map-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "map.yaml");
  await writeFile(file, source);
  return file;
}

test("ESM-746: preview serves the internal and customer views of a map on loopback", async t => {
  const file = await scratchMap(t);
  const base = await startPreview(t, file);
  assert.match(base, /^http:\/\/127\.0\.0\.1:/, "it listens on the loopback address");

  const internal = await get(`${base}/story-map`);
  assert.equal(internal.status, 200);
  assert.equal(internal.headers["cache-control"], "private, no-store");
  assert.match(internal.body, /Draft an estimate against a project/);
  assert.match(internal.body, /Draft an estimate against a project/);
  assert.doesNotMatch(internal.body, /cut hidden/);
  assert.match(internal.body, /href="\/story-map\/export\?view=internal/);

  const customer = await get(`${base}/story-map?view=customer`);
  assert.equal(customer.status, 200);
  assert.match(customer.body, /Draft a project estimate/, "customers see customer copy");
  assert.doesNotMatch(customer.body, /Draft an estimate against a project/);
  assert.doesNotMatch(customer.body, /Alex Morgan/);

  const api = JSON.parse((await get(`${base}/api/story-map?view=customer`)).body);
  assert.equal(api.audience, "all-users");
  assert.equal((await get(`${base}/story-map.css`)).status, 200);
  assert.equal((await get(`${base}/story-map-board.js`)).status, 200);
  assert.equal((await get(`${base}/elsewhere`)).status, 404);

  const exported = await get(`${base}/story-map/export?view=internal&format=csv`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers["content-type"], /text\/csv/);
  assert.equal((await get(`${base}/story-map/export?view=customer&format=csv`)).status, 403);
});

test("ESM-746: preview refuses requests for any other host", async t => {
  const base = await startPreview(t, await scratchMap(t));
  const port = new URL(base).port;
  assert.equal((await get(`${base}/story-map`, `localhost:${port}`)).status, 200);
  const rebound = await get(`${base}/story-map`, `attacker.example:${port}`);
  assert.equal(rebound.status, 421);
  assert.doesNotMatch(rebound.body, /estimate/i);
  assert.equal((await get(`${base}/api/story-map`, "127.0.0.1:1")).status, 421);
});

test("ESM-746: preview shows validation errors on the page and picks up edits without a restart", async t => {
  const file = await scratchMap(t, sample.replace("release: finance-follow-up\n", "release: finance-later\n"));
  const base = await startPreview(t, file);
  const broken = await get(`${base}/story-map`);
  assert.equal(broken.status, 200);
  assert.match(broken.body, /The map is not valid/);
  assert.match(broken.body, /Unknown release &#x27;finance-later&#x27;\./);
  assert.equal((await get(`${base}/api/story-map`)).status, 422);

  await writeFile(file, sample.replace("title: Draft an estimate against a project", "title: Draft an estimate for a site"));
  const fixed = await get(`${base}/story-map`);
  assert.doesNotMatch(fixed.body, /The map is not valid/);
  assert.match(fixed.body, /Draft an estimate for a site/);
});

test("ESM-746: preview explains an internal-only map to the customer view", async t => {
  const base = await startPreview(t, await scratchMap(t, sample.replace(/^visibility: all-users$/m, "visibility: internal")));
  const customer = await get(`${base}/story-map?view=customer`);
  assert.match(customer.body, /visibility: internal, so signed-in customers see nothing/);
});

test("ESM-746: preview exits 1 for a missing map and 2 for a bad port", () => {
  const missing = spawnSync(process.execPath, [cli, "preview", "--port", "0", "no-such-map.yaml"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no map here/);
  assert.equal(spawnSync(process.execPath, [cli, "preview", "--port", "http"]).status, 2);
});

test("ESM-128: preview leaves a valid map's warnings to the Actions tab, with each action's line", async t => {
  // A blocked story with no reason is a warning, not an error.
  const file = await scratchMap(t, sample.replace("    release: builder-mvp\n    status: in-progress\n", "    release: builder-mvp\n    status: blocked\n"));
  const base = await startPreview(t, file);
  const board = await get(`${base}/story-map`);
  assert.equal(board.status, 200);
  assert.doesNotMatch(board.body, /<section class="preview-issues|Validation warnings|The map is still valid|The map is not valid/);
  const actions = await get(`${base}/story-map?view=actions&action-kind=missing-status-reason`);
  assert.match(actions.body, /Say why a story stopped/);
  assert.match(actions.body, /<td class="esm-action-line">\d+<\/td>/);
});
