import { open } from "node:fs/promises";

/**
 * Reads a UTF-8 file, or returns undefined when it is larger than `maxBytes`. The size is checked
 * on the open file, so a file swapped in after the check is never read (ESM-178). A file that grows
 * after the check is still read in full.
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
