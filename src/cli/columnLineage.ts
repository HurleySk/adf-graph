#!/usr/bin/env node
import { readFileSync } from "fs";
import { buildGraph } from "../graph/builder.js";
import { handleColumnLineage, type ColumnLineageResult } from "../tools/columnLineage.js";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = opt("root");
const entity = opt("entity");
const requestsPath = opt("requests");
if (!root || (!entity && !requestsPath)) {
  console.error("usage: columnLineage --root <dir> (--entity <name> [--pipeline <name>] | --requests <file.json>)");
  process.exit(2);
}

const { graph } = buildGraph(root);
let failed = false;
let output: ColumnLineageResult | Record<string, ColumnLineageResult>;
if (requestsPath) {
  const requests = JSON.parse(readFileSync(requestsPath, "utf-8")) as { id: string; entity: string; pipeline?: string }[];
  const all: Record<string, ColumnLineageResult> = {};
  for (const r of requests) {
    all[r.id] = handleColumnLineage(graph, r.entity, r.pipeline);
    failed ||= !!all[r.id].error;
  }
  output = all;
} else {
  output = handleColumnLineage(graph, entity!, opt("pipeline"));
  failed = !!output.error;
}
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
process.exit(failed ? 1 : 0);
