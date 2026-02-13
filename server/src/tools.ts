export const tools = [
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
    name: 'get_nodes_info',
    description:
      'Read properties of multiple Figma nodes in a single call. Returns an array of node info objects. More efficient than calling get_node_info repeatedly.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of Figma node IDs to inspect.',
        },
      },
      required: ['nodeIds'],
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
      'Get full node properties, annotations, and prototype reactions for the currently selected nodes in Figma. No parameters needed — reads whatever the user has selected.',
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
      'Export a Figma node as PNG, SVG, PDF, or JPG. Saves the file to disk and returns the file path.',
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
        outputPath: {
          type: 'string',
          description: 'Absolute file path to save the exported file. If omitted, saves to a temp directory.',
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
        offset: {
          type: 'number',
          description: 'Number of results to skip for pagination. Defaults to 0.',
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
];
