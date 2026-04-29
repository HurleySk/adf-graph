import { Graph, NodeType } from "../graph/model.js";
import { handleValidatePipeline } from "./validatePipeline.js";

export interface BadColumnEntry {
  pipeline: string;
  activity: string;
  entity: string;
  badColumns: string[];
}

export interface FindBadColumnsResult {
  entries: BadColumnEntry[];
  summary: {
    pipelinesScanned: number;
    pipelinesWithIssues: number;
    totalBadColumns: number;
  };
  warnings: string[];
}

export function handleFindBadColumns(
  graph: Graph,
  schemaPath?: string,
): FindBadColumnsResult {
  const entries: BadColumnEntry[] = [];
  const warnings: string[] = [];
  const pipelinesWithIssues = new Set<string>();

  const pipelines = graph.getNodesByType(NodeType.Pipeline);

  for (const pipeline of pipelines) {
    const result = handleValidatePipeline(graph, pipeline.name, schemaPath);
    warnings.push(...result.warnings);

    for (const activity of result.activities) {
      const badCols = activity.columns
        .filter((c) => c.status === "invalid")
        .map((c) => c.alias);

      if (badCols.length > 0) {
        entries.push({
          pipeline: pipeline.name,
          activity: activity.activityName,
          entity: activity.entityName,
          badColumns: badCols,
        });
        pipelinesWithIssues.add(pipeline.name);
      }
    }
  }

  return {
    entries,
    summary: {
      pipelinesScanned: pipelines.length,
      pipelinesWithIssues: pipelinesWithIssues.size,
      totalBadColumns: entries.reduce((sum, e) => sum + e.badColumns.length, 0),
    },
    warnings,
  };
}
