import { readFileSync, existsSync } from "fs";
import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { makeTableId } from "../utils/nodeId.js";
import { asNonDynamic } from "../utils/expressionValue.js";
import { parseTableDdl } from "../parsers/tableDdlParser.js";
import { extractSourceQueryColumns } from "../parsers/sourceQueryParser.js";
import { lookupPipelineNode } from "./toolUtils.js";

export interface StagingColumnMismatch {
  sourceColumn: string;
  nearestStagingColumn?: string;
}

export interface StagingColumnValidation {
  pipeline: string;
  activity: string;
  stagingTable: string;
  hasExplicitMappings: boolean;
  sourceColumns: string[];
  stagingColumns: string[];
  mismatches: StagingColumnMismatch[];
  unmappedStagingColumns: string[];
}

export interface ValidateStagingColumnsResult {
  entries: StagingColumnValidation[];
  summary: {
    activitiesScanned: number;
    activitiesWithMismatches: number;
    totalMismatches: number;
    autoMappingWarnings: number;
  };
  warnings: string[];
}

function findNearestMatch(col: string, candidates: string[]): string | undefined {
  const lower = col.toLowerCase();
  const matches = candidates.filter((c) => c.includes(lower) || lower.includes(c));
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => a.length - b.length);
  return matches[0];
}

function hasExplicitColumnMappings(graph: Graph, activityNode: { id: string; metadata: Record<string, unknown> }): boolean {
  const executedPipeline = activityNode.metadata.executedPipeline as string | undefined;
  if (!executedPipeline) return false;

  // Check if the child pipeline's Copy activities have MapsColumn edges
  const childPipelineId = `pipeline:${executedPipeline}`;
  const childEdges = graph.getOutgoing(childPipelineId);
  for (const edge of childEdges) {
    if (edge.type !== EdgeType.Contains) continue;
    const childNode = graph.getNode(edge.to);
    if (!childNode || childNode.type !== NodeType.Activity) continue;
    if (childNode.metadata.activityType !== "Copy") continue;

    const copyEdges = graph.getOutgoing(childNode.id);
    for (const ce of copyEdges) {
      if (ce.type === EdgeType.MapsColumn) return true;
    }
  }
  return false;
}

export function handleValidateStagingColumns(
  graph: Graph,
  pipeline?: string,
): ValidateStagingColumnsResult {
  const entries: StagingColumnValidation[] = [];
  const warnings: string[] = [];
  let autoMappingWarnings = 0;

  const activityNodes: Array<{ node: ReturnType<Graph["getNode"]>; pipelineName: string }> = [];

  if (pipeline) {
    const lookup = lookupPipelineNode(graph, pipeline);
    if (lookup.error) {
      return {
        entries,
        summary: { activitiesScanned: 0, activitiesWithMismatches: 0, totalMismatches: 0, autoMappingWarnings: 0 },
        warnings: [lookup.error],
      };
    }
    const contained = graph.getOutgoing(lookup.id);
    for (const edge of contained) {
      if (edge.type !== EdgeType.Contains) continue;
      const node = graph.getNode(edge.to);
      if (node && node.type === NodeType.Activity) {
        activityNodes.push({ node, pipelineName: pipeline });
      }
    }
  } else {
    const pipelines = graph.getNodesByType(NodeType.Pipeline);
    for (const pl of pipelines) {
      const contained = graph.getOutgoing(pl.id);
      for (const edge of contained) {
        if (edge.type !== EdgeType.Contains) continue;
        const node = graph.getNode(edge.to);
        if (node && node.type === NodeType.Activity) {
          activityNodes.push({ node, pipelineName: pl.name });
        }
      }
    }
  }

  for (const { node: actNode, pipelineName } of activityNodes) {
    if (!actNode) continue;
    const params = actNode.metadata.pipelineParameters as Record<string, unknown> | undefined;
    if (!params) continue;

    const sourceQuery = asNonDynamic(params.source_query);
    if (!sourceQuery) continue;

    const destObjName = asNonDynamic(params.dest_object_name);
    if (!destObjName) continue;

    const destSchema = asNonDynamic(params.dest_schema_name) ?? "dbo";

    const tableId = makeTableId(destSchema, destObjName);
    const tableNode = graph.getNode(tableId);
    if (!tableNode) {
      warnings.push(`Table node not found: ${destSchema}.${destObjName} (activity '${actNode.name}' in pipeline '${pipelineName}')`);
      continue;
    }

    const filePath = tableNode.metadata.filePath as string | undefined;
    if (!filePath || !existsSync(filePath)) {
      warnings.push(`DDL file not found for ${destSchema}.${destObjName}: ${filePath ?? "no path"}`);
      continue;
    }

    let ddlContent: string;
    try {
      ddlContent = readFileSync(filePath, "utf-8");
    } catch (err) {
      warnings.push(`Failed to read DDL for ${destObjName}: ${String(err)}`);
      continue;
    }

    const ddlResult = parseTableDdl(ddlContent);
    warnings.push(...ddlResult.warnings);
    if (ddlResult.columns.length === 0) continue;

    const sourceResult = extractSourceQueryColumns(sourceQuery);
    warnings.push(...sourceResult.warnings);
    if (sourceResult.columns.length === 0) continue;

    const stagingColSet = new Set(ddlResult.columns);
    const sourceColNames = sourceResult.columns.map((c) => c.effectiveName);
    const sourceColLowerSet = new Set(sourceColNames.map((n) => n.toLowerCase()));

    const hasMapping = hasExplicitColumnMappings(graph, actNode);
    if (!hasMapping) autoMappingWarnings++;

    const mismatches: StagingColumnMismatch[] = [];
    for (const srcCol of sourceColNames) {
      if (!stagingColSet.has(srcCol.toLowerCase())) {
        mismatches.push({
          sourceColumn: srcCol,
          nearestStagingColumn: findNearestMatch(srcCol, ddlResult.columns),
        });
      }
    }

    const unmappedStagingColumns = ddlResult.columns.filter((c) => !sourceColLowerSet.has(c));

    entries.push({
      pipeline: pipelineName,
      activity: actNode.name,
      stagingTable: `${destSchema}.${destObjName}`,
      hasExplicitMappings: hasMapping,
      sourceColumns: sourceColNames,
      stagingColumns: ddlResult.columns,
      mismatches,
      unmappedStagingColumns,
    });
  }

  const activitiesWithMismatches = entries.filter((e) => e.mismatches.length > 0).length;
  const totalMismatches = entries.reduce((sum, e) => sum + e.mismatches.length, 0);

  return {
    entries,
    summary: {
      activitiesScanned: entries.length,
      activitiesWithMismatches,
      totalMismatches,
      autoMappingWarnings,
    },
    warnings,
  };
}
