import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { validateDestQueryActivity, validatePipelineDefaults } from "./validatePipeline.js";

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
    const contained = graph.getOutgoing(pipeline.id);
    for (const edge of contained) {
      if (edge.type !== EdgeType.Contains) continue;
      const actNode = graph.getNode(edge.to);
      if (!actNode || actNode.type !== NodeType.Activity) continue;

      const result = validateDestQueryActivity(graph, actNode, schemaPath);
      if (!result) continue;

      warnings.push(...result.warnings);

      const badCols = result.validation.columns
        .filter((c) => c.status === "invalid")
        .map((c) => c.alias);

      if (badCols.length > 0) {
        entries.push({
          pipeline: pipeline.name,
          activity: result.validation.activityName,
          entity: result.validation.entityName,
          badColumns: badCols,
        });
        pipelinesWithIssues.add(pipeline.name);
      }
    }

    const defaultResult = validatePipelineDefaults(graph, pipeline, schemaPath);
    if (defaultResult) {
      warnings.push(...defaultResult.warnings);
      const badCols = defaultResult.validation.columns
        .filter((c) => c.status === "invalid")
        .map((c) => c.alias);
      if (badCols.length > 0) {
        entries.push({
          pipeline: pipeline.name,
          activity: defaultResult.validation.activityName,
          entity: defaultResult.validation.entityName,
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
