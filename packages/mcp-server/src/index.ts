#!/usr/bin/env node
/**
 * taiwan-life-data-mcp — stdio MCP server.
 *
 * Environment (all optional):
 *   TAIWAN_LIFE_DATA_SITE    base URL of the published site (default: the public site)
 *   TAIWAN_LIFE_DATA_DIRECT  "0" to never read official files directly, snapshots only
 *   MOENV_API_KEY            your own MOENV key for AQI direct reads; stays on this machine
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDataSource } from "./data";
import { createServer } from "./server";

const source = createDataSource({
  siteUrl: process.env.TAIWAN_LIFE_DATA_SITE || undefined,
  direct: process.env.TAIWAN_LIFE_DATA_DIRECT !== "0",
  moenvApiKey: process.env.MOENV_API_KEY || undefined,
});

await createServer(source).connect(new StdioServerTransport());
