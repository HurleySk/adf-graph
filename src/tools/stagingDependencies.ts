import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata } from "../graph/nodeMetadata.js";
import { parseActivityId, parseNodeId, makePipelineId } from "../utils/nodeId.js";
import { TRUNCATE_PATTERN } from "./toolUtils.js";

export interface TablePipelineUsage {
  pipeline: string;
  activity: string;
  usage: "reads" | "writes";
  hasTruncate: boolean;
}

export interface StagingTableEntry {
  table: string;
  writers: TablePipelineUsage[];
  readers: TablePipelineUsage[];
  isShared: boolean;
  hasTruncateConflict: boolean;
}

export interface StagingDependenciesResult {
  tables: StagingTableEntry[];
  sharedTables: StagingTableEntry[];
  summary: {
    totalTables: number;
    sharedTableCount: number;
    truncateConflictCount: number;
  };
  warnings: string[];
}

function activityHasTruncateFor(graph: Graph, activityId: string, tableName: string): boolean {
  const node = graph.getNode(activityId);
  if (!node) return false;
  const meta = getActivityMetadata(node);
  if (!meta.sqlQuery) return false;
  return TRUNCATE_PATTERN.test(meta.sqlQuery) && meta.sqlQuery.toLowerCase().includes(tableName.toLowerCase());
}

function pipelineHasTruncateFor(graph: Graph, pipelineId: string, tableName: string): boolean {
  const outgoing = graph.getOutgoing(pipelineId);
  for (const edge of outgoing) {
    if (edge.type !== EdgeType.Contains) continue;
    if (activityHasTruncateFor(graph, edge.to, tableName)) return true;
  }
  return false;
}

export function handleStagingDependencies(
  graph: Graph,
  tableFilter?: string,
): StagingDependenciesResult {
  const warnings: string[] = [];
  const tables: StagingTableEntry[] = [];

  const tableNodes = graph.getNodesByType(NodeType.Table);

  for (const tableNode of tableNodes) {
    const tableName = parseNodeId(tableNode.id).name;

    if (tableFilter && !tableName.toLowerCase().includes(tableFilter.toLowerCase())) continue;

    const incoming = graph.getIncoming(tableNode.id);
    const writers: TablePipelineUsage[] = [];
    const readers: TablePipelineUsage[] = [];
    const writingPipelines = new Set<string>();

    for (const edge of incoming) {
      const fromNode = graph.getNode(edge.from);
      if (!fromNode) continue;

      if (fromNode.type === NodeType.Activity) {
        const { pipeline, activity } = parseActivityId(edge.from);

        if (edge.type === EdgeType.WritesTo) {
          const pipelineId = makePipelineId(pipeline);
          const hasTruncate =
            activityHasTruncateFor(graph, edge.from, tableName) ||
            pipelineHasTruncateFor(graph, pipelineId, tableName);
          writers.push({ pipeline, activity, usage: "writes", hasTruncate });
          writingPipelines.add(pipeline);
        } else if (edge.type === EdgeType.ReadsFrom) {
          readers.push({ pipeline, activity, usage: "reads", hasTruncate: false });
        }
      } else if (fromNode.type === NodeType.StoredProcedure) {
        if (edge.type === EdgeType.WritesTo) {
          writers.push({ pipeline: "(stored procedure)", activity: fromNode.name, usage: "writes", hasTruncate: false });
        } else if (edge.type === EdgeType.ReadsFrom) {
          readers.push({ pipeline: "(stored procedure)", activity: fromNode.name, usage: "reads", hasTruncate: false });
        }
      }
    }

    if (writers.length === 0 && readers.length === 0) continue;

    const isShared = writingPipelines.size > 1;
    const hasTruncateConflict = isShared && writers.some((w) => w.hasTruncate);

    tables.push({
      table: tableName,
      writers,
      readers,
      isShared,
      hasTruncateConflict,
    });
  }

  tables.sort((a, b) => a.table.localeCompare(b.table));

  const sharedTables = tables.filter((t) => t.isShared);

  return {
    tables,
    sharedTables,
    summary: {
      totalTables: tables.length,
      sharedTableCount: sharedTables.length,
      truncateConflictCount: sharedTables.filter((t) => t.hasTruncateConflict).length,
    },
    warnings,
  };
}
