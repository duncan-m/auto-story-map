import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { defineCommand, escapeText, optionValue } from "./shared.js";

export default defineCommand({
  parse(rest: string[]) {
    const options = { root: ".", map: "product/story-map.yaml", readOnly: false };
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (name === "--root" || name === "--map") {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--root") options.root = value;
        else options.map = value;
      } else if (arg === "--read-only") {
        options.readOnly = true;
      } else {
        return null;
      }
    }
    return options;
  },

  async run(options) {
    const root = resolve(options.root);
    try {
      await access(resolve(root, options.map));
    } catch {
      console.error(`${escapeText(options.map)}: no map here. Run story-map init to create one, or pass the map's path with --map.`);
      process.exitCode = 1;
      return;
    }
    let mcp: typeof import("../mcp.js");
    let stdio: typeof import("@modelcontextprotocol/sdk/server/stdio.js");
    try {
      [mcp, stdio] = await Promise.all([import("../mcp.js"), import("@modelcontextprotocol/sdk/server/stdio.js")]);
    } catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
      console.error("story-map mcp needs the Model Context Protocol SDK. Install it with:\n\n  npm install --save-dev @modelcontextprotocol/sdk");
      process.exitCode = 1;
      return;
    }
    const server = mcp.createStoryMapMcpServer({ root, map: options.map, readOnly: options.readOnly });
    // Standard output carries the protocol, so anything for people goes to standard error.
    await server.connect(new stdio.StdioServerTransport());
    console.error(`story-map MCP server for ${escapeText(options.map)} in ${escapeText(root)}${options.readOnly ? ", read-only" : ""}. It reads standard input and stops when it closes.`);
  },
});
