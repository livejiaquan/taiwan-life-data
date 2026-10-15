import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "node", args: [process.argv[2]] });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
console.log("server:", JSON.stringify(client.getServerVersion()));
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(","));
const calls = [["outdoor_brief", { county: "台南市", town: "安南" }], ["grid_carbon", {}], ["reservoirs", { query: "曾文" }], ["data_status", {}], ["history", { feed: "power" }], ["list_towns", { county: "連江縣" }], ["outdoor_brief", { town: "中正區" }]];
for (const [name, args] of calls) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n===== ${name} ${JSON.stringify(args)} ${Date.now() - t0}ms isError=${!!r.isError}\n${r.content[0].text}`);
}
await client.close();
