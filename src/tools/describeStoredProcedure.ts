import { existsSync, readFileSync } from "fs";
import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { makeNodeId } from "../utils/nodeId.js";
import { parseActivityId } from "../utils/nodeId.js";

interface CallerInfo {
  pipeline: string;
  activity: string;
  parameterValues?: Record<string, unknown>;
}

interface ColumnMapping {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  transformExpression?: string;
}

export interface DescribeStoredProcedureResult {
  name: string;
  schema: string;
  parameters: Array<{ name: string; type: string }>;
  readTables: string[];
  writeTables: string[];
  confidence: string;
  mappingCount: number;
  calledBy: CallerInfo[];
  columnMappings?: ColumnMapping[];
  sqlBody?: string;
  error?: string;
}

export function handleDescribeStoredProcedure(
  graph: Graph,
  name: string,
  depth: "summary" | "full",
): DescribeStoredProcedureResult {
  const schema = name.includes(".") ? name.split(".")[0] : "dbo";
  const spName = name.includes(".") ? name.split(".").slice(1).join(".") : name;
  const spId = makeNodeId(NodeType.StoredProcedure, `${schema}.${spName}`);
  const node = graph.getNode(spId);

  if (!node) {
    return {
      name: spName,
      schema,
      parameters: [],
      readTables: [],
      writeTables: [],
      confidence: "unknown",
      mappingCount: 0,
      calledBy: [],
      error: `Stored procedure '${schema}.${spName}' not found in graph`,
    };
  }

  const parameters = (node.metadata.parameters as Array<{ name: string; type: string }>) ?? [];
  const confidence = (node.metadata.spConfidence as string) ?? "unknown";
  const mappingCount = (node.metadata.spMappingCount as number) ?? 0;

  const readTables: string[] = [];
  const writeTables: string[] = [];
  for (const edge of graph.getOutgoing(spId)) {
    if (edge.type === EdgeType.ReadsFrom) {
      const tNode = graph.getNode(edge.to);
      readTables.push(tNode?.name ?? edge.to);
    } else if (edge.type === EdgeType.WritesTo) {
      const tNode = graph.getNode(edge.to);
      writeTables.push(tNode?.name ?? edge.to);
    }
  }

  const calledBy: CallerInfo[] = [];
  for (const edge of graph.getIncoming(spId)) {
    if (edge.type === EdgeType.CallsSp) {
      const actNode = graph.getNode(edge.from);
      if (actNode) {
        const { pipeline, activity } = parseActivityId(actNode.id);
        const spParams = actNode.metadata.storedProcedureParameters as Record<string, unknown> | undefined;
        calledBy.push({
          pipeline,
          activity,
          ...(spParams ? { parameterValues: spParams } : {}),
        });
      }
    }
  }

  const result: DescribeStoredProcedureResult = {
    name: spName,
    schema,
    parameters,
    readTables,
    writeTables,
    confidence,
    mappingCount,
    calledBy,
  };

  if (depth === "full") {
    const columnMappings: ColumnMapping[] = [];
    for (const edge of graph.getOutgoing(spId)) {
      if (edge.type === EdgeType.MapsColumn && edge.to === spId) {
        columnMappings.push({
          sourceTable: edge.metadata.sourceTable as string,
          sourceColumn: edge.metadata.sourceColumn as string,
          targetTable: edge.metadata.targetTable as string,
          targetColumn: edge.metadata.targetColumn as string,
          ...(edge.metadata.transformExpression ? { transformExpression: edge.metadata.transformExpression as string } : {}),
        });
      }
    }
    result.columnMappings = columnMappings;

    const filePath = node.metadata.filePath as string | undefined;
    if (filePath && existsSync(filePath)) {
      try {
        result.sqlBody = readFileSync(filePath, "utf-8");
      } catch { /* ignore read errors for optional body */ }
    }
  }

  return result;
}
