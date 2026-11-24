import { access } from "node:fs/promises";
import { ArgumentError, defineCommand, escapeText, optionValue } from "./shared.js";

export default defineCommand({
  parse(rest: string[]) {
    const options = { map: "product/story-map.yaml", port: 4173, history: undefined as string | undefined, tests: undefined as string | undefined, sourceBaseUrl: undefined as string | undefined, writable: true };
    const paths: string[] = [];
    for (let index = 0; index < rest.length; index++) {
      const arg = rest[index];
      const name = arg.split("=")[0];
      if (name === "--port" || name === "--history" || name === "--tests-index" || name === "--source-base-url") {
        const [value, next] = optionValue(rest, index, name);
        index = next;
        if (name === "--port") {
          options.port = Number(value);
          if (!/^\d+$/.test(value) || options.port > 65535) throw new ArgumentError(`--port must be a port number from 0 to 65535, not ${value}`);
        } else if (name === "--history") {
          options.history = value;
        } else if (name === "--tests-index") {
          options.tests = value;
        } else {
          if (!/^https?:\/\//.test(value)) throw new ArgumentError(`--source-base-url must be an http or https URL, not ${value}`);
          options.sourceBaseUrl = value;
        }
      } else if (arg === "--writable" || arg === "--read-only") {
        // Writable is the default. --writable is kept so commands written for 0.7.6 still work.
        options.writable = arg === "--writable";
      } else if (arg.startsWith("-")) {
        return null;
      } else {
        paths.push(arg);
      }
    }
    if (paths.length > 1) return null;
    return { ...options, map: paths[0] ?? options.map };
  },

  async run(options) {
    try {
      await access(options.map);
    } catch {
      console.error(`${escapeText(options.map)}: no map here. Run story-map init to create one, or pass the map's path.`);
      process.exitCode = 1;
      return;
    }
    let preview: typeof import("../preview.js");
    try {
      preview = await import("../preview.js");
    } catch (error) {
      if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
      console.error("story-map preview renders the React board, so it needs react and react-dom. Install them with:\n\n  npm install --save-dev react react-dom");
      process.exitCode = 1;
      return;
    }
    const server = preview.createStoryMapPreviewServer({ map: options.map, history: options.history, tests: options.tests, sourceBaseUrl: options.sourceBaseUrl, writable: options.writable });
    await new Promise<void>(resolve => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        console.error(error.code === "EADDRINUSE" ? `Port ${options.port} is in use. Choose another with --port.` : error.message);
        process.exitCode = 1;
        resolve();
      });
      server.listen(options.port, preview.previewHost, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : options.port;
        console.log(`Previewing ${options.map} at http://${preview.previewHost}:${port}/story-map`);
        console.log("It reads the map on every request, so reload after an edit. Press Ctrl+C to stop.");
        console.log(options.writable ? "Edits on the Personas tab save to the map file. Start with --read-only to turn them off." : "Read-only: the Personas tab has no edit controls.");
      });
    });
  },
});
