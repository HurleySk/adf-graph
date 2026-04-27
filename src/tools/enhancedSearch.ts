import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityType, getActivityMetadata } from "../graph/nodeMetadata.js";
import { parseActivityId, parseNodeId } from "../utils/nodeId.js";

export interface SearchHit {
  nodeId: string;
  nodeType: string;
  name: string;
  pipeline?: string;
  activityType?: string;
  field?: string;
  snippet?: string;
  targets?: string[];
}

export interface EnhancedSearchResult {
  query: string;
  filters?: Record<string, string>;
  totalHits: number;
  hits: SearchHit[];
}

export interface EnhancedSearchOptions {
  activityType?: string;
  nodeType?: string;
  targetEntity?: string;
  pipeline?: string;
  detail?: "summary" | "full";
}

/**
 * Collect the names of entities/tables an activity reads from, writes to, or calls
 * by inspecting its outgoing edges.
 */
function getActivityTargets(graph: Graph, nodeId: string): string[] {
  const targets: string[] = [];
  for (const edge of graph.getOutgoing(nodeId)) {
    if (
      edge.type === EdgeType.ReadsFrom ||
      edge.type === EdgeType.WritesTo ||
      edge.type === EdgeType.CallsSp
    ) {
      const { name } = parseNodeId(edge.to);
      targets.push(name);
    }
  }
  return targets;
}

/**
 * Search activity metadata fields for a text pattern.
 * Returns the first matching field name and the matching text, or undefined.
 */
function searchActivityMetadata(
  graph: Graph,
  nodeId: string,
  lowerQuery: string,
): { field: string; text: string } | undefined {
  const node = graph.getNode(nodeId);
  if (!node) return undefined;

  const meta = getActivityMetadata(node);

  for (const field of ["sqlQuery", "fetchXmlQuery", "storedProcedureName"] as const) {
    const value = meta[field];
    if (typeof value === "string" && value.toLowerCase().includes(lowerQuery)) {
      return { field, text: value };
    }
  }

  for (const field of ["storedProcedureParameters", "pipelineParameters"] as const) {
    const obj = meta[field];
    if (obj && typeof obj === "object") {
      const text = JSON.stringify(obj);
      if (text.toLowerCase().includes(lowerQuery)) {
        return { field, text };
      }
    }
  }

  return undefined;
}

export function handleEnhancedSearch(
  graph: Graph,
  query: string,
  options: EnhancedSearchOptions = {},
): EnhancedSearchResult {
  const { activityType, nodeType, targetEntity, pipeline: pipelineFilter, detail = "summary" } = options;
  const lowerQuery = query.toLowerCase();
  const hits: SearchHit[] = [];

  // Build active filters record for the response
  const filters: Record<string, string> = {};
  if (activityType) filters.activityType = activityType;
  if (nodeType) filters.nodeType = nodeType;
  if (targetEntity) filters.targetEntity = targetEntity;
  if (pipelineFilter) filters.pipeline = pipelineFilter;

  // Determine candidate nodes
  const candidates = nodeType
    ? graph.getNodesByType(nodeType as NodeType)
    : graph.allNodes();

  for (const node of candidates) {
    const isActivity = node.type === NodeType.Activity;

    // --- Activity-specific filters ---
    if (activityType) {
      if (!isActivity) continue;
      if (getActivityType(node).toLowerCase() !== activityType.toLowerCase()) continue;
    }

    if (pipelineFilter) {
      if (!isActivity) continue;
      const { pipeline } = parseActivityId(node.id);
      if (pipeline.toLowerCase() !== pipelineFilter.toLowerCase()) continue;
    }

    if (targetEntity) {
      if (!isActivity) continue;
      const targets = getActivityTargets(graph, node.id);
      const lowerTarget = targetEntity.toLowerCase();
      if (!targets.some((t) => t.toLowerCase().includes(lowerTarget))) continue;
    }

    // --- Text search ---
    let matchedField: string | undefined;
    let matchedText: string | undefined;

    // Search node name
    if (node.name.toLowerCase().includes(lowerQuery)) {
      matchedField = "name";
      matchedText = node.name;
    }

    // For activities, also search metadata fields
    if (!matchedField && isActivity) {
      const metaMatch = searchActivityMetadata(graph, node.id, lowerQuery);
      if (metaMatch) {
        matchedField = metaMatch.field;
        matchedText = metaMatch.text;
      }
    }

    if (!matchedField) continue;

    // --- Build hit ---
    const hit: SearchHit = {
      nodeId: node.id,
      nodeType: node.type,
      name: node.name,
    };

    if (isActivity) {
      const { pipeline } = parseActivityId(node.id);
      hit.pipeline = pipeline;
      hit.activityType = getActivityType(node);
      hit.targets = getActivityTargets(graph, node.id);
    }

    hit.field = matchedField;

    if (detail === "full" && matchedText) {
      hit.snippet = matchedText;
    }

    hits.push(hit);
  }

  const result: EnhancedSearchResult = {
    query,
    totalHits: hits.length,
    hits,
  };

  if (Object.keys(filters).length > 0) {
    result.filters = filters;
  }

  return result;
}
