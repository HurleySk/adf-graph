import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata } from "../graph/nodeMetadata.js";
import { parseActivityId } from "../utils/nodeId.js";
import { makeNodeId } from "../utils/nodeId.js";
import { asString } from "../utils/expressionValue.js";
import { extractDestQueryAliases } from "../parsers/destQueryParser.js";
import { resolveDestQueryDefaults } from "./toolUtils.js";

export interface PipelineCoverageEntry {
  pipeline: string;
  activity: string;
  activityId: string;
  source: "dest_query" | "column_mapping" | "parameter_default";
  columns: string[];
  destQuery?: string;
}

export interface EntityCoverageResult {
  entity: string;
  entityFound: boolean;
  totalWritingPipelines: number;
  coverageEntries: PipelineCoverageEntry[];
  allColumns: string[];
  columnFrequency: Record<string, number>;
  warnings: string[];
  error?: string;
}

export interface EntityCoverageSummaryResult {
  entity: string;
  entityFound: boolean;
  totalWritingPipelines: number;
  allColumns: string[];
  columnFrequency: Record<string, number>;
  warnings: string[];
  error?: string;
}

export function handleEntityCoverage(
  graph: Graph,
  entity: string,
  detail: "summary" | "full" = "summary",
): EntityCoverageResult | EntityCoverageSummaryResult {
  const entityNodeId = makeNodeId(NodeType.DataverseEntity, entity);
  const entityNode = graph.getNode(entityNodeId);

  if (!entityNode) {
    if (detail === "summary") {
      return {
        entity,
        entityFound: false,
        totalWritingPipelines: 0,
        allColumns: [],
        columnFrequency: {},
        warnings: [],
        error: `Entity '${entity}' not found in graph`,
      };
    }
    return {
      entity,
      entityFound: false,
      totalWritingPipelines: 0,
      coverageEntries: [],
      allColumns: [],
      columnFrequency: {},
      warnings: [],
      error: `Entity '${entity}' not found in graph`,
    };
  }

  const warnings: string[] = [];
  const entries: PipelineCoverageEntry[] = [];
  const seenActivities = new Set<string>();

  const incoming = graph.getIncoming(entityNodeId);
  for (const edge of incoming) {
    if (edge.type !== EdgeType.WritesTo) continue;

    const fromNode = graph.getNode(edge.from);
    if (!fromNode || fromNode.type !== NodeType.Activity) continue;

    if (seenActivities.has(fromNode.id)) continue;
    seenActivities.add(fromNode.id);

    const { pipeline, activity } = parseActivityId(fromNode.id);
    const meta = getActivityMetadata(fromNode);

    const params = meta.pipelineParameters as Record<string, unknown> | undefined;
    const destQuery = params ? asString(params.dest_query) : undefined;

    if (destQuery && !destQuery.startsWith("@")) {
      const parseResult = extractDestQueryAliases(destQuery);
      warnings.push(...parseResult.warnings);
      const columns = parseResult.aliases.map((a) => a.alias);
      entries.push({
        pipeline,
        activity,
        activityId: fromNode.id,
        source: "dest_query",
        columns,
        destQuery,
      });
    } else {
      const mapEdges = graph.getOutgoing(fromNode.id).filter((e) => e.type === EdgeType.MapsColumn);
      if (mapEdges.length > 0) {
        const columns = mapEdges
          .map((e) => e.metadata.sinkColumn as string | undefined)
          .filter((c): c is string => !!c);
        entries.push({
          pipeline,
          activity,
          activityId: fromNode.id,
          source: "column_mapping",
          columns,
        });
      }
    }
  }

  const allActivities = graph.getNodesByType(NodeType.Activity);
  for (const actNode of allActivities) {
    if (seenActivities.has(actNode.id)) continue;
    const meta = getActivityMetadata(actNode);
    if (meta.activityType !== "ExecutePipeline") continue;

    const params = meta.pipelineParameters as Record<string, unknown> | undefined;
    if (!params) continue;

    const entityParam = asString(params.dataverse_entity_name);
    if (!entityParam || entityParam.startsWith("@") || entityParam !== entity) continue;

    const destQuery = asString(params.dest_query);
    if (!destQuery || destQuery.startsWith("@")) continue;

    seenActivities.add(actNode.id);
    const { pipeline, activity } = parseActivityId(actNode.id);
    const parseResult = extractDestQueryAliases(destQuery);
    warnings.push(...parseResult.warnings);
    entries.push({
      pipeline,
      activity,
      activityId: actNode.id,
      source: "dest_query",
      columns: parseResult.aliases.map((a) => a.alias),
      destQuery,
    });
  }

  const pipelines = graph.getNodesByType(NodeType.Pipeline);
  for (const pipelineNode of pipelines) {
    const defaults = resolveDestQueryDefaults(pipelineNode);
    if (!defaults || defaults.entityName !== entity) continue;
    if (seenActivities.has(defaults.pipelineId)) continue;

    const parseResult = extractDestQueryAliases(defaults.destQuery);
    warnings.push(...parseResult.warnings);
    entries.push({
      pipeline: defaults.pipelineName,
      activity: `${defaults.pipelineName} (parameter default)`,
      activityId: defaults.pipelineId,
      source: "parameter_default",
      columns: parseResult.aliases.map((a) => a.alias),
      destQuery: defaults.destQuery,
    });
  }

  entries.sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.activity.localeCompare(b.activity));

  const columnFrequency: Record<string, number> = {};
  for (const entry of entries) {
    for (const col of entry.columns) {
      const key = col.toLowerCase();
      columnFrequency[key] = (columnFrequency[key] ?? 0) + 1;
    }
  }

  const allColumns = Object.keys(columnFrequency).sort();
  const writingPipelines = new Set(entries.map((e) => e.pipeline));

  if (detail === "summary") {
    return {
      entity,
      entityFound: true,
      totalWritingPipelines: writingPipelines.size,
      allColumns,
      columnFrequency,
      warnings,
    };
  }

  return {
    entity,
    entityFound: true,
    totalWritingPipelines: writingPipelines.size,
    coverageEntries: entries,
    allColumns,
    columnFrequency,
    warnings,
  };
}
