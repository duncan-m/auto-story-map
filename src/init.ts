import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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

async function writeNew(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { flag: "wx" });
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
  const title = `${words.charAt(0).toUpperCase()}${words.slice(1)} story map`;
  return { id, title };
}

/**
 * Sets up Auto Story Map in a host repository: a starter map, the story
 * map guide, the agent instructions and a validation workflow. Existing files
 * are never overwritten, so it is safe to run again.
 */
export async function initStoryMap(root: string, options: InitOptions = {}): Promise<InitStep[]> {
  const steps: InitStep[] = [];

  const mapPath = "product/story-map.yaml";
  if (await exists(join(root, mapPath))) {
    steps.push({ path: mapPath, action: "skipped", reason: "already exists" });
  } else {
    const { id, title } = describeProduct(await productName(root));
    const map = (await template("story-map.yaml")).replace("__ID__", id).replace("__TITLE__", title);
    await writeNew(join(root, mapPath), map);
    steps.push({ path: mapPath, action: "created" });
  }

  const guidePath = "docs/story-map.md";
  const guide = await readFile(new URL("docs/story-map.md", packageRoot), "utf8");
  if (!(await exists(join(root, guidePath)))) {
    await writeNew(join(root, guidePath), guide);
    steps.push({ path: guidePath, action: "created" });
  } else if (await readFile(join(root, guidePath), "utf8") === guide) {
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
  if (!(await exists(join(root, agentsPath)))) {
    await writeNew(join(root, agentsPath), agents);
    steps.push({ path: agentsPath, action: "created" });
  } else {
    const current = await readFile(join(root, agentsPath), "utf8");
    if (current.includes(agentsMarker)) {
      steps.push({ path: agentsPath, action: "skipped", reason: "already has the story map section" });
    } else {
      const separator = current.length === 0 || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
      await appendFile(join(root, agentsPath), separator + agents);
      steps.push({ path: agentsPath, action: "updated", reason: "added the story map section" });
    }
  }

  if (options.ci !== false) {
    const workflowPath = ".github/workflows/story-map.yml";
    if (await exists(join(root, workflowPath))) {
      steps.push({ path: workflowPath, action: "skipped", reason: "already exists" });
    } else if (!(await exists(join(root, "package-lock.json")))) {
      steps.push({
        path: workflowPath,
        action: "skipped",
        reason: "no package-lock.json; add `story-map validate --format github product/story-map.yaml` to your CI",
      });
    } else {
      await writeNew(join(root, workflowPath), await template("story-map-ci.yml"));
      steps.push({ path: workflowPath, action: "created" });
    }
  }

  return steps;
}
