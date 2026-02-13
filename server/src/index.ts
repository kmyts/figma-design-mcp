import { execSync } from 'child_process';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';

interface PendingCommand {
  id: string;
  type: string;
  payload: unknown;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

const commandQueue: PendingCommand[] = [];
const COMMAND_TIMEOUT_MS = 30_000;
const SWEEP_INTERVAL_MS = 5_000;
const HTTP_PORT = 3848;

setInterval(() => {
  const now = Date.now();
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    const cmd = commandQueue[i];
    if (now - cmd.createdAt > COMMAND_TIMEOUT_MS) {
      commandQueue.splice(i, 1);
      cmd.reject(new Error(`Command ${cmd.id} timed out after ${COMMAND_TIMEOUT_MS}ms — is the Figma plugin running?`));
    }
  }
}, SWEEP_INTERVAL_MS);

function enqueueCommand(type: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    commandQueue.push({
      id: uuidv4(),
      type,
      payload,
      resolve,
      reject,
      createdAt: Date.now(),
    });
  });
}

function killStaleInstances(): void {
  try {
    const lines = execSync(`lsof -ti :${HTTP_PORT}`, { encoding: 'utf-8' }).trim();
    if (!lines) return;

    for (const pidStr of lines.split('\n')) {
      const pid = Number(pidStr);
      if (!pid || pid === process.pid) continue;
      try {
        const cmdline = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf-8' }).trim();
        if (cmdline.includes('figma-design-mcp')) {
          process.kill(pid, 'SIGTERM');
          console.error(`[figma-design] Killed stale instance (PID ${pid})`);
        } else {
          console.error(`[figma-design] Port ${HTTP_PORT} in use by another program: ${cmdline}`);
        }
      } catch (_) { /* process already gone */ }
    }
    execSync('sleep 0.5');
  } catch (_) { /* no process on port */ }
}

killStaleInstances();

const app = express();

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => { res.sendStatus(200); });
app.use(express.json({ limit: '50mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', pendingCommands: commandQueue.length });
});

app.get('/commands/poll', (_req, res) => {
  if (commandQueue.length === 0) {
    res.sendStatus(204);
    return;
  }
  const cmd = commandQueue[0];
  res.json({ id: cmd.id, type: cmd.type, payload: cmd.payload });
});

app.post('/commands/:id/result', (req, res) => {
  const { id } = req.params;
  const idx = commandQueue.findIndex(c => c.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Command not found or already resolved' });
    return;
  }
  const cmd = commandQueue.splice(idx, 1)[0];
  const body = req.body as { success: boolean; result?: unknown; error?: string };
  if (body.success) {
    cmd.resolve(body.result);
  } else {
    cmd.reject(new Error(body.error || 'Plugin reported failure'));
  }
  res.json({ ok: true });
});

const httpServer = app.listen(HTTP_PORT, () => {
  console.error(`[figma-design] HTTP server listening on port ${HTTP_PORT}`);
});
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[figma-design] Port ${HTTP_PORT} in use — kill existing process or change port.`);
  } else {
    console.error('[figma-design] HTTP server error:', err);
  }
});

const mcpServer = new Server(
  { name: 'figma-design', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_nodes',
        description:
          'Create a tree of design nodes in Figma. Returns a mapping of tempId → actual Figma node ID for every created node. ' +
          'Supported node types: FRAME, RECTANGLE, ELLIPSE, TEXT, LINE, COMPONENT, INSTANCE, GROUP, VECTOR. ' +
          'Each node can specify geometry (x, y, width, height, rotation), appearance (fills, strokes, effects, cornerRadius), ' +
          'auto-layout properties (layoutMode, padding, itemSpacing, sizing modes), and text properties (characters, fontSize, fontFamily). ' +
          'Frames and components can have children arrays for nesting.',
        inputSchema: {
          type: 'object',
          properties: {
            parentNodeId: {
              type: 'string',
              description: 'ID of an existing Figma node to append children to. If omitted, nodes are created on the current page.',
            },
            nodes: {
              type: 'array',
              description: 'Array of DesignNode objects describing the tree to create.',
              items: { type: 'object' },
            },
          },
          required: ['nodes'],
        },
      },
      {
        name: 'update_nodes',
        description:
          'Update properties of existing Figma nodes. Pass an array of updates, each with a nodeId and the properties to change. ' +
          'Supports all the same properties as create_nodes (geometry, appearance, auto-layout, text).',
        inputSchema: {
          type: 'object',
          properties: {
            updates: {
              type: 'array',
              description: 'Array of { nodeId: string, properties: object } updates.',
              items: {
                type: 'object',
                properties: {
                  nodeId: { type: 'string' },
                  properties: { type: 'object' },
                },
                required: ['nodeId', 'properties'],
              },
            },
          },
          required: ['updates'],
        },
      },
      {
        name: 'delete_nodes',
        description: 'Delete nodes from the Figma canvas by their IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of Figma node IDs to delete.',
            },
          },
          required: ['nodeIds'],
        },
      },
      {
        name: 'get_node_info',
        description: 'Read back a Figma node\'s properties for verification. Returns type, name, dimensions, fills, children, and more.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: 'The Figma node ID to inspect.',
            },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'list_pages',
        description: 'List all pages in the current Figma file with their IDs and names.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'set_current_page',
        description: 'Switch the active page in the Figma file.',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: {
              type: 'string',
              description: 'The page ID to switch to.',
            },
          },
          required: ['pageId'],
        },
      },
      {
        name: 'get_annotations',
        description:
          'Get Dev Mode annotations for a specific Figma node. Returns the annotation labels, markdown content, and associated properties.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: 'The Figma node ID to read annotations from.',
            },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'get_reactions',
        description:
          'Get prototype interactions/reactions for a specific Figma node. Returns triggers (click, hover, drag, etc.), actions (navigate, overlay, swap, etc.), and transitions (dissolve, smart animate, slide, etc.) with durations and easing curves.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: 'The Figma node ID to read reactions from.',
            },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'get_selection',
        description:
          'Get annotations and prototype reactions for the currently selected nodes in Figma. No parameters needed — reads whatever the user has selected.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'scan_annotations',
        description:
          'Recursively scan a node tree for all nodes that have annotations or prototype reactions. If no nodeId is given, scans the entire current page. Returns a flat list of all annotated/interactive nodes found.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: 'Optional root node ID to scan from. If omitted, scans the entire current page.',
            },
          },
        },
      },
      {
        name: 'export_node',
        description:
          'Export a Figma node as PNG, SVG, PDF, or JPG. Returns base64-encoded data of the exported image.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: 'The Figma node ID to export.',
            },
            format: {
              type: 'string',
              enum: ['PNG', 'SVG', 'PDF', 'JPG'],
              description: 'Export format. Defaults to PNG.',
            },
            scale: {
              type: 'number',
              description: 'Export scale (e.g., 2 for 2x resolution). Defaults to 1. Only applies to PNG and JPG.',
            },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'get_styles',
        description:
          'List local styles in the Figma file (paint, text, effect, grid). Returns style names, IDs, and properties.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['PAINT', 'TEXT', 'EFFECT', 'GRID'],
              description: 'Optional filter by style type. If omitted, returns all style types.',
            },
          },
        },
      },
      {
        name: 'get_variables',
        description:
          'List all local variables and variable collections in the Figma file. Returns variable names, types, values per mode, and collection info.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'import_component',
        description:
          'Import a component from a team library by its key. Returns the imported component node info.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'The component key from the team library.',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'create_from_svg',
        description:
          'Create Figma nodes from an SVG string. Parses the SVG and creates corresponding vector nodes on the current page.',
        inputSchema: {
          type: 'object',
          properties: {
            svg: {
              type: 'string',
              description: 'The SVG markup string to create nodes from.',
            },
            x: {
              type: 'number',
              description: 'Optional X position for the created node.',
            },
            y: {
              type: 'number',
              description: 'Optional Y position for the created node.',
            },
          },
          required: ['svg'],
        },
      },
      {
        name: 'find_nodes',
        description:
          'Search for nodes by name, type, or both. Returns matching node IDs, names, and types.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Name substring to search for (case-insensitive).',
            },
            type: {
              type: 'string',
              description: 'Optional node type filter (e.g., FRAME, TEXT, RECTANGLE, COMPONENT, INSTANCE).',
            },
            parentNodeId: {
              type: 'string',
              description: 'Optional parent node ID to scope the search. Defaults to current page.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return. Defaults to 100.',
            },
          },
        },
      },
      {
        name: 'group_nodes',
        description:
          'Group multiple nodes together into a Group node. All nodes must share the same parent.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of node IDs to group together.',
            },
          },
          required: ['nodeIds'],
        },
      },
      {
        name: 'ungroup_nodes',
        description:
          'Ungroup a Group node, releasing its children back to the parent.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: 'The Group node ID to ungroup.',
            },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'list_fonts',
        description:
          'List all available fonts in Figma. Returns font family names and styles.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await enqueueCommand(name, args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[figma-design] MCP server running on stdio');
}

main().catch(console.error);
