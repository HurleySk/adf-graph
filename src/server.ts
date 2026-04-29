#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
import { loadConfig } from "./config.js";
import { GraphManager } from "./graph/manager.js";
import { registerTools } from "./registerTools.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const config = loadConfig();
const manager = new GraphManager(config);

const server = new McpServer({
  name: "adf-graph",
  version,
});

registerTools(server, manager);

const transport = new StdioServerTransport();
await server.connect(transport);
