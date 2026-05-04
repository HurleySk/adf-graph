import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { makeNodeId } from "../utils/nodeId.js";
import { parseActivityId } from "../utils/nodeId.js";

interface ColumnInfo {
  name: string;
  type?: string;
  nullable?: boolean;
}

interface Consumer {
  pipeline: string;
  activity: string;
  direction: "reads" | "writes";
}

interface SpConsumer {
  spName: string;
  direction: "reads" | "writes";
}

export interface DescribeTableResult {
  name: string;
  schema: string;
  columnCount: number;
  columns: ColumnInfo[];
  consumers: Consumer[];
  storedProcedureConsumers: SpConsumer[];
  error?: string;
}

export function handleDescribeTable(
  graph: Graph,
  table: string,
): DescribeTableResult {
  const schema = table.includes(".") ? table.split(".")[0] : "dbo";
  const tableName = table.includes(".") ? table.split(".").slice(1).join(".") : table;
  const tableId = makeNodeId(NodeType.Table, `${schema}.${tableName}`);
  const node = graph.getNode(tableId);

  if (!node) {
    return {
      name: tableName,
      schema,
      columnCount: 0,
      columns: [],
      consumers: [],
      storedProcedureConsumers: [],
      error: `Table '${schema}.${tableName}' not found in graph`,
    };
  }

  const columns = (node.metadata.columns as ColumnInfo[]) ?? [];
  const columnCount = (node.metadata.columnCount as number) ?? columns.length;

  const consumers: Consumer[] = [];
  const spConsumers: SpConsumer[] = [];

  for (const edge of graph.getIncoming(tableId)) {
    const srcNode = graph.getNode(edge.from);
    if (!srcNode) continue;

    if (srcNode.type === NodeType.Activity) {
      const { pipeline, activity } = parseActivityId(srcNode.id);
      if (edge.type === EdgeType.ReadsFrom) {
        consumers.push({ pipeline, activity, direction: "reads" });
      } else if (edge.type === EdgeType.WritesTo) {
        consumers.push({ pipeline, activity, direction: "writes" });
      }
    } else if (srcNode.type === NodeType.StoredProcedure) {
      if (edge.type === EdgeType.ReadsFrom) {
        spConsumers.push({ spName: srcNode.name, direction: "reads" });
      } else if (edge.type === EdgeType.WritesTo) {
        spConsumers.push({ spName: srcNode.name, direction: "writes" });
      }
    }
  }

  return {
    name: tableName,
    schema,
    columnCount,
    columns,
    consumers,
    storedProcedureConsumers: spConsumers,
  };
}
