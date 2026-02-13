import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { enqueueCommand, startTimeoutSweep } from './queue.js';
import { startHttpServer } from './http.js';
import { tools } from './tools.js';

startHttpServer();
startTimeoutSweep();

const mcpServer = new Server(
  { name: 'figma-design', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

function saveExportToDisk(
  result: { nodeId: string; name: string; format: string; size: number; data: string },
  outputPath?: string,
): { filePath: string; nodeId: string; name: string; format: string; size: number } {
  const ext = result.format.toLowerCase();
  const safeName = (result.name || 'export').replace(/[^a-zA-Z0-9_-]/g, '_');

  let filePath: string;
  if (outputPath) {
    filePath = outputPath;
  } else {
    const dir = join(tmpdir(), 'figma-design-exports');
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, `${safeName}_${result.nodeId.replace(':', '-')}.${ext}`);
  }

  const buffer = Buffer.from(result.data, 'base64');
  writeFileSync(filePath, buffer);

  return {
    filePath,
    nodeId: result.nodeId,
    name: result.name,
    format: result.format,
    size: buffer.length,
  };
}

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await enqueueCommand(name, args);

    // For export_node, handle the base64 result
    if (name === 'export_node' && result && typeof result === 'object' && 'data' in result) {
      const exportResult = result as { nodeId: string; name: string; format: string; size: number; data: string };
      const outputPath = (args as Record<string, unknown>)?.outputPath as string | undefined;

      // SVG: return inline if small enough, otherwise save to disk
      const SVG_INLINE_MAX = 100_000; // 100KB threshold
      if (exportResult.format === 'SVG' && !outputPath) {
        const svg = Buffer.from(exportResult.data, 'base64').toString('utf-8');
        if (svg.length <= SVG_INLINE_MAX) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              nodeId: exportResult.nodeId,
              name: exportResult.name,
              format: 'SVG',
              size: svg.length,
              svg,
            }, null, 2) }],
          };
        }
        // SVG too large for inline — fall through to save to disk
      }

      // Binary formats (PNG, JPG, PDF) or SVG with explicit outputPath: save to disk
      const saved = saveExportToDisk(exportResult, outputPath);
      return {
        content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }],
      };
    }

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
