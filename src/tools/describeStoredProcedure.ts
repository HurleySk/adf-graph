import { getActivityMetadata, getColumnMappingMetadata, getSpMetadata } from "../graph/nodeMetadata.js";
import { existsSync, readFileSync } from "fs";
import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { makeNodeId, parseActivityId, parseNodeId } from "../utils/nodeId.js";
import { resolveNode, splitQualifiedName } from "./toolUtils.js";

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
  const resolvedId = resolveNode(graph, NodeType.StoredProcedure, name);
  const qualified = resolvedId ? parseNodeId(resolvedId).name : name.includes(".") ? name : `dbo.${name}`;
  const [schema, spName] = splitQualifiedName(qualified);
  const spId = resolvedId ?? makeNodeId(NodeType.StoredProcedure, qualified);
  const node = resolvedId ? graph.getNode(resolvedId) : undefined;

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

  const spMeta = getSpMetadata(node);
  const parameters = spMeta.parameters;
  const confidence = spMeta.spConfidence;
  const mappingCount = spMeta.spMappingCount;

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
        const spParams = getActivityMetadata(actNode).storedProcedureParameters;
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
    for (const edge of graph.getOutgoing(spId, EdgeType.MapsColumn)) {
      if (edge.to !== spId) continue;
      const m = getColumnMappingMetadata(edge);
      columnMappings.push({
        sourceTable: m.sourceTable as string,
        sourceColumn: m.sourceColumn as string,
        targetTable: m.targetTable as string,
        targetColumn: m.targetColumn as string,
        ...(m.transformExpression ? { transformExpression: m.transformExpression } : {}),
      });
    }
    result.columnMappings = columnMappings;

    const filePath = spMeta.filePath;
    if (filePath && existsSync(filePath)) {
      try {
        result.sqlBody = readFileSync(filePath, "utf-8");
      } catch { /* ignore read errors for optional body */ }
    }
  }

  return result;
}
