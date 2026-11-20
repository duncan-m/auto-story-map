import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

export interface InitOptions {
  /** Write a GitHub Actions workflow that validates the map. Defaults to true. */
  ci?: boolean;
}

export interface InitStep {
  /** Path relative to the host repository root. */
  path: string;
  action: "created" | "updated" | "skipped";
  reason?: string;
}

const packageRoot = new URL("../", import.meta.url);
const template = (name: string) => readFile(new URL(`templates/${name}`, packageRoot), "utf8");
const agentsMarker = "<!-- auto-story-map:start -->";

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function isInside(realRoot: string, path: string) {
  const rel = relative(realRoot, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolves a destination inside the host repository, following any symbolic
 * links along the way only while they stay inside it. The result contains no
 * links, so later writes cannot be redirected outside the root by one.
 */
async function destination(realRoot: string, path: string) {
  let current = realRoot;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    const next = join(current, part);
    let info;
    try {
      info = await lstat(next);
    } catch (error) {
      if (isMissing(error)) return join(next, ...parts.slice(index + 1));
      throw error;
    }
    if (!info.isSymbolicLink()) {
      current = next;
      continue;
    }
    let target;
    try {
      target = await realpath(next);
    } catch (error) {
      if (isMissing(error)) throw new Error(`${path}: ${relative(realRoot, next)} is a broken symbolic link; remove it and run init again`);
      throw error;
    }
    if (!isInside(realRoot, target)) {
      throw new Error(`${path}: ${relative(realRoot, next)} is a symbolic link that points outside the repository`);
    }
    current = target;
  }
  return current;
}

async function writeNew(realRoot: string, path: string, contents: string) {
  const target = await destination(realRoot, path);
  await mkdir(dirname(target), { recursive: true });
  // Check again in case a link appeared while the folders were created.
  if ((await destination(realRoot, path)) !== target) throw new Error(`${path} changed while it was being created`);
  // `wx` fails if anything, including a link, already exists at the path.
  await writeFile(target, contents, { flag: "wx" });
}

/** Appends the guidance through one handle opened without following a final link. */
async function appendGuidance(realRoot: string, path: string, agents: string) {
  const target = await destination(realRoot, path);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(target, constants.O_RDWR | constants.O_APPEND | noFollow);
  } catch (error) {
    if (!["EACCES", "EPERM", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    // A read-only file that already has the section needs no write access.
    const reader = await open(target, constants.O_RDONLY | noFollow).catch(() => undefined);
    if (!reader) throw error;
    try {
      if ((await reader.stat()).isFile() && (await reader.readFile("utf8")).includes(agentsMarker)) return false;
    } finally {
      await reader.close();
    }
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`${path} is not a file`);
    const current = await handle.readFile("utf8");
    if (current.includes(agentsMarker)) return false;
    const separator = current.length === 0 || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    await handle.appendFile(separator + agents);
    return true;
  } finally {
    await handle.close();
  }
}

async function productName(root: string) {
  try {
    const { name } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name?: unknown };
    if (typeof name === "string" && name.trim()) return name.replace(/^@[^/]+\//, "");
  } catch {
    // Fall back to the directory name.
  }
  return basename(root);
}

/** Turns a package or folder name into a valid map ID and a readable title. */
export function describeProduct(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64).replace(/-+$/, "") || "product";
  const words = id.replace(/[-_]+/g, " ").trim();
  // “[App Name] Story Map”, such as “Field Ops Story Map”.
  const title = `${words.replace(/(^|\s)\S/g, letter => letter.toUpperCase())} Story Map`;
  return { id, title };
}

/**
 * Sets up Auto Story Map in a host repository: a starter map, the story
 * map guide, the agent instructions and a validation workflow. Existing files
 * are never overwritten, so it is safe to run again.
 */
export async function initStoryMap(root: string, options: InitOptions = {}): Promise<InitStep[]> {
  const steps: InitStep[] = [];
  const realRoot = await realpath(root);
  const at = (path: string) => destination(realRoot, path);

  const mapPath = "product/story-map.yaml";
  if (await exists(await at(mapPath))) {
    steps.push({ path: mapPath, action: "skipped", reason: "already exists" });
  } else {
    const { id, title } = describeProduct(await productName(root));
    const map = (await template("story-map.yaml")).replace("__ID__", id).replace("__TITLE__", title);
    await writeNew(realRoot, mapPath, map);
    steps.push({ path: mapPath, action: "created" });
  }

  const guidePath = "docs/story-map.md";
  const guide = await readFile(new URL("docs/story-map.md", packageRoot), "utf8");
  if (!(await exists(await at(guidePath)))) {
    await writeNew(realRoot, guidePath, guide);
    steps.push({ path: guidePath, action: "created" });
  } else if (await readFile(await at(guidePath), "utf8") === guide) {
    steps.push({ path: guidePath, action: "skipped", reason: "already up to date" });
  } else {
    steps.push({
      path: guidePath,
      action: "skipped",
      reason: "differs from this version's guide; compare it with node_modules/auto-story-map/docs/story-map.md",
    });
  }

  const agentsPath = "AGENTS.md";
  const agents = await template("AGENTS.md");
  if (!(await exists(await at(agentsPath)))) {
    await writeNew(realRoot, agentsPath, agents);
    steps.push({ path: agentsPath, action: "created" });
  } else if (await appendGuidance(realRoot, agentsPath, agents)) {
    steps.push({ path: agentsPath, action: "updated", reason: "added the story map section" });
  } else {
    steps.push({ path: agentsPath, action: "skipped", reason: "already has the story map section" });
  }

  if (options.ci !== false) {
    const workflowPath = ".github/workflows/story-map.yml";
    if (await exists(await at(workflowPath))) {
      steps.push({ path: workflowPath, action: "skipped", reason: "already exists" });
    } else if (!(await exists(join(root, "package-lock.json")))) {
      steps.push({
        path: workflowPath,
        action: "skipped",
        reason: "no package-lock.json; add `story-map validate --format github product/story-map.yaml` to your CI",
      });
    } else {
      await writeNew(realRoot, workflowPath, await template("story-map-ci.yml"));
      steps.push({ path: workflowPath, action: "created" });
    }
  }

  return steps;
}
