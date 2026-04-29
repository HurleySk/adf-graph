import { Graph, NodeType } from "../graph/model.js";
import { getActivityMetadata } from "../graph/nodeMetadata.js";
import { parseActivityId } from "../utils/nodeId.js";
import { getWrittenEntity } from "./toolUtils.js";

const DATAVERSE_SINK_TYPES = new Set([
  "CommonDataServiceForAppsSink",
  "DynamicsSink",
  "DynamicsCrmSink",
]);

export interface IgnoreNullValuesEntry {
  pipeline: string;
  activity: string;
  activityId: string;
  entity: string | null;
  sinkType: string;
  writeBehavior: string | null;
  ignoreNullValues: boolean;
  alternateKeyName: string | null;
}

export interface IgnoreNullValuesAuditResult {
  flagged: IgnoreNullValuesEntry[];
  summary: {
    totalCopyActivities: number;
    dataverseSinks: number;
    flaggedCount: number;
  };
  warnings: string[];
}

export interface AuditPipelineBreakdown {
  pipeline: string;
  flaggedCount: number;
  entities: string[];
}

export interface IgnoreNullValuesAuditSummaryResult {
  summary: {
    totalCopyActivities: number;
    dataverseSinks: number;
    flaggedCount: number;
  };
  pipelineBreakdown: AuditPipelineBreakdown[];
  warnings: string[];
}

export function handleIgnoreNullValuesAudit(
  graph: Graph,
  detail: "summary" | "full" = "summary",
): IgnoreNullValuesAuditResult | IgnoreNullValuesAuditSummaryResult {
  const warnings: string[] = [];
  const flagged: IgnoreNullValuesEntry[] = [];
  let totalCopyActivities = 0;
  let dataverseSinks = 0;

  const activities = graph.getNodesByType(NodeType.Activity);

  for (const actNode of activities) {
    const meta = getActivityMetadata(actNode);
    if (meta.activityType !== "Copy") continue;
    totalCopyActivities++;

    if (!meta.sinkType || !DATAVERSE_SINK_TYPES.has(meta.sinkType)) continue;
    dataverseSinks++;

    const isSafe = meta.sinkIgnoreNullValues === true;
    if (isSafe) continue;

    const entity = getWrittenEntity(graph, actNode.id);

    const { pipeline, activity } = parseActivityId(actNode.id);

    flagged.push({
      pipeline,
      activity,
      activityId: actNode.id,
      entity,
      sinkType: meta.sinkType,
      writeBehavior: meta.sinkWriteBehavior ?? null,
      ignoreNullValues: meta.sinkIgnoreNullValues ?? false,
      alternateKeyName: meta.sinkAlternateKeyName ?? null,
    });
  }

  flagged.sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.activity.localeCompare(b.activity));

  if (detail === "summary") {
    const byPipeline = new Map<string, { count: number; entities: Set<string> }>();
    for (const entry of flagged) {
      let bucket = byPipeline.get(entry.pipeline);
      if (!bucket) {
        bucket = { count: 0, entities: new Set() };
        byPipeline.set(entry.pipeline, bucket);
      }
      bucket.count++;
      if (entry.entity) bucket.entities.add(entry.entity);
    }
    const pipelineBreakdown: AuditPipelineBreakdown[] = [...byPipeline.entries()]
      .map(([pipeline, b]) => ({
        pipeline,
        flaggedCount: b.count,
        entities: [...b.entities].sort(),
      }))
      .sort((a, b) => a.pipeline.localeCompare(b.pipeline));

    return {
      summary: { totalCopyActivities, dataverseSinks, flaggedCount: flagged.length },
      pipelineBreakdown,
      warnings,
    };
  }

  return {
    flagged,
    summary: { totalCopyActivities, dataverseSinks, flaggedCount: flagged.length },
    warnings,
  };
}
