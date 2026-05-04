import { existsSync, readFileSync } from "fs";
import { Graph, NodeType } from "../graph/model.js";
import { makeNodeId } from "../utils/nodeId.js";

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
  const spName = name.includes(".") ? name.split(".").slice(1).join(".") : name;
  const spSchema = name.includes(".") ? name.split(".")[0] : schema;
  const spId = makeNodeId(NodeType.StoredProcedure, `${spSchema}.${spName}`);
  const node = graph.getNode(spId);

  if (!node) {
    return { name: spName, schema: spSchema, sql: "", lineCount: 0, error: `Stored procedure '${spSchema}.${spName}' not found in graph` };
  }

  const filePath = node.metadata.filePath as string | undefined;
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
