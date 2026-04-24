import { GraphNode, GraphEdge, NodeType, EdgeType } from "../graph/model.js";
import { ParseResult } from "./pipeline.js";

export { ParseResult };

export function parseDatasetFile(json: unknown): ParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object") {
    warnings.push("Invalid dataset JSON: not an object");
    return { nodes, edges, warnings };
  }

  const root = json as Record<string, unknown>;
  const datasetName = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;

  const datasetType = properties?.type as string | undefined;
  const parameters = (properties?.parameters as Record<string, unknown>) ?? {};
  const typeProperties = properties?.typeProperties as Record<string, unknown> | undefined;

  const datasetId = `${NodeType.Dataset}:${datasetName}`;

  nodes.push({
    id: datasetId,
    type: NodeType.Dataset,
    name: datasetName,
    metadata: {
      datasetType: datasetType ?? null,
      parameters,
    },
  });

  // Linked service edge
  const linkedServiceRef = properties?.linkedServiceName as Record<string, unknown> | undefined;
  const lsName = linkedServiceRef?.referenceName as string | undefined;
  if (lsName) {
    edges.push({
      from: datasetId,
      to: `linked_service:${lsName}`,
      type: EdgeType.UsesLinkedService,
      metadata: {},
    });
  }

  // Static table reference (only if both schema and table are plain strings, not Expressions)
  if (typeProperties) {
    const schema = typeProperties.schema;
    const table = typeProperties.table;

    const schemaStr =
      typeof schema === "string" ? schema : null;
    const tableStr =
      typeof table === "string" ? table : null;

    if (schemaStr && tableStr) {
      edges.push({
        from: datasetId,
        to: `${NodeType.Table}:${schemaStr}.${tableStr}`,
        type: EdgeType.ReadsFrom,
        metadata: {},
      });
    }
  }

  return { nodes, edges, warnings };
}
