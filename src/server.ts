import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "adf-graph",
  version: "0.1.0",
});

server.tool(
  "echo",
  "Echoes the input message back to the caller.",
  {
    message: z.string().describe("The message to echo"),
  },
  async ({ message }) => ({
    content: [{ type: "text", text: message }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
