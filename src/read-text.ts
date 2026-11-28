import { open } from "node:fs/promises";

/**
 * Reads a UTF-8 file, or returns undefined when it is larger than `maxBytes`. The size is checked
 * on the open file, so the file cannot be replaced between the check and the read (ESM-178).
 */
export async function readTextFileWithin(path: string, maxBytes: number): Promise<string | undefined> {
  const handle = await open(path, "r");
  try {
    if ((await handle.stat()).size > maxBytes) return undefined;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
