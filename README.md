# Figma Design MCP

An MCP server that lets AI assistants (Claude, etc.) create and manipulate designs directly in Figma.

It works by running a local MCP server that bridges between your AI tool and a Figma plugin. The plugin polls the server for commands and executes them using the Figma Plugin API.

## Why not the official Figma MCP?

The [official Figma MCP server](https://www.figma.com/blog/introducing-figma-mcp-server/) is **read-only** — it extracts design context (layout, variables, components) so AI can generate code from existing designs.

Figma Design MCP is **bidirectional**. It can read designs *and* create them. Your AI assistant can create frames, add shapes, set auto-layout, apply styles, insert text, build components — basically design for you. It also reads back node properties, exports assets, inspects annotations and prototype reactions, and more.

| | Official Figma MCP | Figma Design MCP |
|---|---|---|
| Read design context | Yes | Yes |
| Create / modify / delete nodes | No | Yes |
| Export assets (PNG, SVG, PDF, JPG) | No | Yes |
| SVG import | No | Yes |
| Dev Mode annotations | No | Yes |
| Prototype reactions & interactions | No | Yes |
| Local styles & variables | No | Yes |
| Library component import | No | Yes |
| Requires API token | Yes | No (runs via plugin) |
| Setup | Token-based | Zero-config plugin |

Because it runs through the Figma Plugin API (not the REST API), there's no token management and no rate limits — just open the plugin and go.

It's also dramatically more token-efficient. The official Figma MCP returns the full deeply-nested design tree via the REST API, which can consume huge amounts of tokens per call. Figma Design MCP returns only the requested node's properties with children summarized as lightweight stubs (id, name, type). You drill deeper only when needed, so each call stays small and focused.

In short: official MCP is **design → code**, this is **code → design** (and back).

## Setup

### Prerequisites

- Node.js 18+
- Figma desktop app

### 1. Install dependencies and build

```sh
git clone https://github.com/nicholasheadway/figma-design-mcp.git
cd figma-design-mcp
npm install
cd server && npm install && cd ..
npm run build
```

### 2. Load the Figma plugin

1. Open Figma desktop
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select `plugin/manifest.json` from this repo

### 3. Add to your MCP client

Add to your Claude Code config (`~/.claude/claude_code_config.json`):

```json
{
  "mcpServers": {
    "figma-design": {
      "command": "node",
      "args": ["/absolute/path/to/figma-design-mcp/server/dist/index.js"]
    }
  }
}
```

Or for Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "figma-design": {
      "command": "node",
      "args": ["/absolute/path/to/figma-design-mcp/server/dist/index.js"]
    }
  }
}
```

### 4. Connect

1. Run the Figma plugin (Plugins > Development > Design from Claude)
2. The plugin will connect to the local server on port 3848
3. Start using your AI tool -- it can now create and modify Figma designs

## Tools

### Canvas Operations

| Tool | Description |
|------|-------------|
| `create_nodes` | Create frames, rectangles, text, ellipses, vectors, components, instances |
| `update_nodes` | Update properties (position, size, fills, strokes, effects, text, auto-layout) |
| `delete_nodes` | Delete nodes by ID |
| `group_nodes` | Group multiple nodes together |
| `ungroup_nodes` | Ungroup a group node |
| `create_from_svg` | Create nodes from an SVG string |

### Reading & Search

| Tool | Description |
|------|-------------|
| `get_node_info` | Get a node's properties (type, dimensions, fills, children, etc.) |
| `find_nodes` | Search nodes by name and/or type |
| `get_selection` | Get full node properties, annotations, and reactions for currently selected nodes |
| `get_annotations` | Get Dev Mode annotations for a node |
| `get_reactions` | Get prototype interactions for a node |
| `scan_annotations` | Recursively find all annotated/interactive nodes |

### Export & Assets

| Tool | Description |
|------|-------------|
| `export_node` | Export a node as PNG, SVG, PDF, or JPG (saves to disk, returns file path) |
| `get_styles` | List local paint, text, effect, and grid styles |
| `get_variables` | List local variables and variable collections |
| `list_fonts` | List all available fonts |
| `import_component` | Import a component from a team library by key |

### Pages

| Tool | Description |
|------|-------------|
| `list_pages` | List all pages in the file |
| `set_current_page` | Switch the active page |

## Architecture

```
AI Tool  <--stdio-->  MCP Server  ---->  HTTP Bridge (:3848)  <--polling-->  Figma Plugin
```

The MCP server exposes tools over stdio (MCP protocol) and runs an HTTP server on port 3848. The Figma plugin UI polls this HTTP server every 500ms, executes commands via the Figma Plugin API, and posts results back.

## Development

```sh
# Watch mode for the server
cd server && npm run dev

# Rebuild the plugin after changes
npm run build:plugin
```

## License

MIT
