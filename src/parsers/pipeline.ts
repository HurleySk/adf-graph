import { GraphNode, GraphEdge, NodeType } from "../graph/model.js";
import { ParseResult, extractTablesFromSql } from "./parseResult.js";
import { parseActivity } from "./activities/index.js";

// Re-export for backward compatibility — other files import these from pipeline.ts
export { ParseResult, extractTablesFromSql };

export function parsePipelineFile(json: unknown): ParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object") {
    warnings.push("Invalid pipeline JSON: not an object");
    return { nodes, edges, warnings };
  }

  const root = json as Record<string, unknown>;
  const pipelineName = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;
  const activities = (properties?.activities as unknown[]) ?? [];

  // Pipeline node
  const pipelineId = `${NodeType.Pipeline}:${pipelineName}`;
  const paramDefs = (properties?.parameters as Record<string, unknown>) ?? {};
  const parameters = Object.entries(paramDefs).map(([name, def]) => {
    const d = def as Record<string, unknown> | null;
    return {
      name,
      type: (d?.type as string) ?? "String",
      defaultValue: d?.defaultValue ?? null,
    };
  });
  nodes.push({
    id: pipelineId,
    type: NodeType.Pipeline,
    name: pipelineName,
    metadata: { parameters },
  });

  // Parse each activity via the dispatcher
  for (const act of activities) {
    const activity = act as Record<string, unknown>;
    const result = parseActivity(activity, { pipelineId, pipelineName });
    nodes.push(result.node);
    edges.push(...result.edges);
    warnings.push(...result.warnings);
  }

  return { nodes, edges, warnings };
}
