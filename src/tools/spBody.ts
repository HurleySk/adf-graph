import { getSpMetadata } from "../graph/nodeMetadata.js";
import { existsSync, readFileSync } from "fs";
import { Graph, NodeType } from "../graph/model.js";
import { parseNodeId } from "../utils/nodeId.js";
import { resolveNode, splitQualifiedName } from "./toolUtils.js";

export interface SpBodyResult {
  name: string;
  schema: string;
  sql: string;
  lineCount: number;
  error?: string;
}

export function handleSpBody(
  graph: Graph,
  name: string,
  schema: string,
): SpBodyResult {
  const requested = name.includes(".") ? name : `${schema}.${name}`;
  const resolvedId = resolveNode(graph, NodeType.StoredProcedure, requested);
  const qualified = resolvedId ? parseNodeId(resolvedId).name : requested;
  const [spSchema, spName] = splitQualifiedName(qualified);
  const node = resolvedId ? graph.getNode(resolvedId) : undefined;

  if (!node) {
    return { name: spName, schema: spSchema, sql: "", lineCount: 0, error: `Stored procedure '${spSchema}.${spName}' not found in graph` };
  }

  const { filePath } = getSpMetadata(node);
  if (!filePath) {
    return { name: spName, schema: spSchema, sql: "", lineCount: 0, error: `No file path stored for SP '${spSchema}.${spName}'` };
  }

  if (!existsSync(filePath)) {
    return { name: spName, schema: spSchema, sql: "", lineCount: 0, error: `SP file not found: ${filePath}` };
  }

  try {
    const sql = readFileSync(filePath, "utf-8");
    const lineCount = sql.split("\n").length;
    return { name: spName, schema: spSchema, sql, lineCount };
  } catch (err) {
    return { name: spName, schema: spSchema, sql: "", lineCount: 0, error: `Failed to read SP file: ${String(err)}` };
  }
}
