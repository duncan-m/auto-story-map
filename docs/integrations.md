# Integrations

Guides to taking the story map into other tools. Each one is a one-way snapshot: `product/story-map.yaml` stays the source of truth, and changes made in the other tool do not come back. To change the map, edit the YAML, then rebuild the snapshot.

For Lucidchart, Miro and spreadsheets, download a file from the board's **Export** menu instead. See [Export the map](story-map.md#export-the-map).

## Spreo

[Spreo](https://spreo.io) can build an interactive story board from the map. You ask an AI assistant connected to Spreo's MCP server to read the map and lay it out. The library has no Spreo code of its own: the assistant does the work through [Spreo's MCP integration](https://docs.spreo.io/boards/mcp).

Internal viewers can open this guide from the board's **Export** menu.

### What the prompt shares

The prompt gives the assistant the internal map, with its estimates, notes, sources and draft items. That content goes to your AI provider, under its terms, and onto a Spreo board in your organisation, where anyone who can open the board can read it. Only use it with a map you are allowed to share with both.

### Before you start

- You need a Spreo account on a trial or paid plan, and you must be a member of the organisation. Guests cannot connect an assistant.
- MCP must be switched on for the account. It is on by default. Owners and Admins can turn it off under **Manage**, then **Integrations**, then **MCP**.
- The connection uses OAuth. You sign in to Spreo once and are never asked for a password or API key. The connection can read, create and edit boards in the organisation you choose.

Spreo's MCP server is `https://mcp.spreo.io/mcp`. While it is in beta, you add it to your assistant by hand.

### From Claude Code

Claude Code can read the map straight from your checkout.

1. Add the server, then run `/mcp` in Claude Code and follow the sign-in prompt:

   ```bash
   claude mcp add --transport http spreo https://mcp.spreo.io/mcp
   ```

   Add `--scope user` to use it in every project, not just this one.
2. In the repository, paste this prompt:

   ```text
   Using the Spreo MCP tools, create a new Spreo board called "<product> story map" from product/story-map.yaml.
   Read the YAML first. It is the source of truth, and this board is a one-way snapshot of it.
   - Put the activities across the top as columns, in the order they appear in the YAML.
   - Under them, make a horizontal zone for each release, in YAML order, as a swimlane. Label it with the release title and the total of its story estimates in points.
   - Put each story as a card in the cell for its activity and release, in YAML order. Show its ID, such as ESM-123, then its title, and its estimate in points when it has one. Add its status to the card.
   - Leave out stories whose status is cut.
   - Don't invent stories, estimates or releases that are not in the YAML.
   When you have finished, give me the board's link and the number of stories you placed.
   ```

### From Claude

1. In Claude, go to **Customize**, then **Connectors**. Choose **+ Add**, then **Add custom connector**.
2. Name it `Spreo` and paste `https://mcp.spreo.io/mcp`. Keep the sign-in settings Claude suggests. If it asks for an OAuth client, choose **Register automatically**.
3. Choose **Add**, then **Connect**, and choose **Authorize** in the Spreo window.

   On a Team or Enterprise plan, an Owner first adds Spreo under **Organization settings**, then **Connectors**. Each member then connects it with their own Spreo account.
4. In a new chat, check that Spreo is switched on under **+**, then **Connectors**. Attach `product/story-map.yaml` and paste the prompt from [From Claude Code](#from-claude-code), with “from product/story-map.yaml” changed to “from the attached story-map.yaml”.

### From ChatGPT

ChatGPT supports custom MCP servers on Business, Enterprise and Edu plans, on the web. Pro can only read boards, so it cannot build one. On Business, only admins and owners can add Spreo.

1. Go to **Plugins**. Choose **+**, then **Add custom MCP server**.
2. Name it `Spreo`. Under **Connection**, paste `https://mcp.spreo.io/mcp`, and set authentication to **OAuth**.
3. Read the warning, tick **I understand and want to continue**, and choose **Create as a plugin**. Sign in to Spreo and choose **Authorize**, then install the plugin.
4. In a new conversation, attach `product/story-map.yaml`, type **@**, choose **Spreo**, and paste the prompt from [From Claude Code](#from-claude-code), with “from product/story-map.yaml” changed to “from the attached story-map.yaml”.

ChatGPT may ask you to confirm before it changes the board. Mention **@Spreo** again in any follow-up that needs it.

### Keep the board current

Spreo does not watch the YAML. When the map changes, ask the assistant to build a new board, or to update the existing one from the new YAML and give you its link. Large maps take several steps, so the first build can take a few minutes.
