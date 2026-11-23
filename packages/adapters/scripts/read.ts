#!/usr/bin/env tsx
// Prints what the read adapters find on this machine (MCP secrets masked, bodies omitted).
//
//   npm run read -- [--project <dir>] [--home <dir>] [--json]
import { homedir } from "node:os";
import { resolve } from "node:path";
import { maskToolConfig, type ToolConfig } from "@kitroom/model";
import { READERS } from "../index";
import type { PathContext } from "../types";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const project = resolve(opt("--project") ?? process.cwd());
const home = opt("--home");
const ctx: PathContext = home
  ? { home: resolve(home), project, env: {} }
  : { home: homedir(), project, env: process.env };

const configs: ToolConfig[] = [];
for (const read of Object.values(READERS)) configs.push(maskToolConfig(await read!(ctx)));

const short = (p: string) => p.replace(ctx.project, ".").replace(ctx.home, "~");

if (argv.includes("--json")) {
  console.log(JSON.stringify(configs, null, 2));
} else {
  for (const c of configs) {
    console.log(`\n== ${c.tool}  rules ${c.rules.length} · agents ${c.agents.length} · skills ${c.skills.length} · mcp ${c.mcpServers.length} · issues ${c.issues.length}`);
    for (const item of [...c.rules, ...c.agents, ...c.skills, ...c.mcpServers]) {
      const desc = item.description ? ` — ${item.description.slice(0, 50)}` : "";
      const flag = item.source.verified ? "" : " [unverified]";
      console.log(`  ${item.kind.padEnd(5)} ${item.source.scope.padEnd(7)} ${item.name}${desc}  (${short(item.source.path)})${flag}`);
    }
    for (const i of c.issues) console.log(`  ! ${short(i.path)}: ${i.message}`);
  }
}
