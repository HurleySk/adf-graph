import { Graph, GraphNode, NodeType, EdgeType, GraphEdge } from "../graph/model.js";
import { parseNodeId } from "../utils/nodeId.js";

export type LineageDirection = "upstream" | "downstream";

export interface LineageStep {
  nodeId: string;
  nodeType: string;
  name: string;
  edgeType: string;
}

export interface LineagePath {
  steps: LineageStep[];
}

export interface ColumnMapping {
  activityId: string;
  sourceColumn: string | null;
  sinkColumn: string | null;
  sourceTable?: string;
  targetTable?: string;
  transformExpression?: string;
}

export interface DataLineageResult {
  entity: string;
  attribute?: string;
  direction: LineageDirection;
  paths: LineagePath[];
  columnMappings: ColumnMapping[];
  truncated?: boolean;
  error?: string;
}

/**
 * Convert a GraphEdge[] path into LineageStep[] steps.
 * For upstream traversal, each step shows the `from` end (going back through the graph).
 * For downstream traversal, each step shows the `to` end.
 */
function pathToSteps(graph: Graph, path: GraphEdge[], direction: LineageDirection): LineageStep[] {
  return path.map((edge) => {
    const stepNodeId = direction === "upstream" ? edge.from : edge.to;
    const stepNode = graph.getNode(stepNodeId);
    return {
      nodeId: stepNodeId,
      nodeType: stepNode?.type ?? "unknown",
      name: stepNode?.name ?? stepNodeId,
      edgeType: edge.type,
    };
  });
}

function resolveEntityNode(
  graph: Graph,
  entity: string,
): { nodeId: string; node: GraphNode; error: null } | { nodeId: null; node: null; error: string } {
  if (entity.includes(":")) {
    const { type } = parseNodeId(entity);
    if (type === "table" || type === "dataverse_entity") {
      const directNode = graph.getNode(entity);
      if (directNode) return { nodeId: entity, node: directNode, error: null };
    }
  }

  const dvId = `dataverse_entity:${entity}`;
  const dvNode = graph.getNode(dvId);
  if (dvNode) return { nodeId: dvId, node: dvNode, error: null };

  const tableId = `table:${entity}`;
  const tableNode = graph.getNode(tableId);
  if (tableNode) return { nodeId: tableId, node: tableNode, error: null };

  const lowerEntity = entity.toLowerCase();
  const candidates: GraphNode[] = [];
  for (const n of graph.getNodesByType(NodeType.Table)) {
    if (n.name.toLowerCase() === lowerEntity) candidates.push(n);
  }
  for (const n of graph.getNodesByType(NodeType.DataverseEntity)) {
    if (n.name.toLowerCase() === lowerEntity) candidates.push(n);
  }

  if (candidates.length === 1) return { nodeId: candidates[0].id, node: candidates[0], error: null };
  if (candidates.length > 1) {
    const ids = candidates.map((c) => c.id).join(", ");
    return { nodeId: null, node: null, error: `Ambiguous entity '${entity}' — matches multiple nodes: ${ids}` };
  }

  return { nodeId: null, node: null, error: `Node for '${entity}' not found as dataverse_entity or table` };
}

/**
 * Trace data lineage for a Dataverse entity or table using data-flow semantics:
 *
 * Upstream (what feeds this node):
 *   - Standard graph upstream traversal (follows incoming edges)
 *   - For each activity found, also includes its data sources (reads_from edges)
 *
 * Downstream (what this node feeds into):
 *   - Finds activities that READ this node (incoming reads_from edges to the node)
 *   - Then follows those activities downstream to find sinks (writes_to)
 *   - Also uses standard downstream traversal for nodes with outgoing edges
 */
export function handleDataLineage(
  graph: Graph,
  entity: string,
  attribute?: string,
  direction: LineageDirection = "upstream",
  maxDepth?: number,
): DataLineageResult {
  const resolved = resolveEntityNode(graph, entity);
  if (!resolved.nodeId) {
    return {
      entity,
      attribute,
      direction,
      paths: [],
      columnMappings: [],
      error: resolved.error ?? undefined,
    };
  }

  const nodeId: string = resolved.nodeId;

  const paths: LineagePath[] = [];
  const visitedNodes = new Set<string>();

  if (direction === "upstream") {
    // Standard upstream traversal
    const traversalResults = graph.traverseUpstream(nodeId, maxDepth);

    for (const r of traversalResults) {
      if (visitedNodes.has(r.node.id)) continue;
      visitedNodes.add(r.node.id);

      const steps = pathToSteps(graph, r.path, "upstream");
      // Add the terminal node
      steps.push({
        nodeId: r.node.id,
        nodeType: r.node.type,
        name: r.node.name,
        edgeType: "",
      });

      // For activity nodes: augment with their data sources (reads_from)
      if (r.node.id.startsWith("activity:")) {
        const actOutgoing = graph.getOutgoing(r.node.id);
        for (const edge of actOutgoing) {
          if (edge.type === EdgeType.ReadsFrom) {
            const sourceNode = graph.getNode(edge.to);
            if (!visitedNodes.has(edge.to)) {
              // Emit a separate path for each source
              paths.push({
                steps: [
                  ...steps,
                  {
                    nodeId: edge.to,
                    nodeType: sourceNode?.type ?? "unknown",
                    name: sourceNode?.name ?? edge.to,
                    edgeType: edge.type,
                  },
                ],
              });
            }
          }
        }
      }

      paths.push({ steps });
    }
  } else {
    // Downstream: standard traversal from the node
    const traversalResults = graph.traverseDownstream(nodeId, maxDepth);

    for (const r of traversalResults) {
      if (visitedNodes.has(r.node.id)) continue;
      visitedNodes.add(r.node.id);

      const steps = pathToSteps(graph, r.path, "downstream");
      steps.push({
        nodeId: r.node.id,
        nodeType: r.node.type,
        name: r.node.name,
        edgeType: "",
      });
      paths.push({ steps });
    }

    // Also find activities that read FROM this node (reads_from reverse linkage)
    // These represent downstream data consumers not captured by standard traversal
    const incomingEdges = graph.getIncoming(nodeId);
    for (const edge of incomingEdges) {
      if (edge.type !== EdgeType.ReadsFrom) continue;
      const activityId = edge.from;
      if (visitedNodes.has(activityId)) continue;

      const actNode = graph.getNode(activityId);
      if (!actNode) continue;

      // Add the activity itself
      const actStep: LineageStep = {
        nodeId: activityId,
        nodeType: actNode.type,
        name: actNode.name,
        edgeType: EdgeType.ReadsFrom,
      };

      if (!visitedNodes.has(activityId)) {
        visitedNodes.add(activityId);
        paths.push({ steps: [actStep] });
      }

      // Follow writes_to from this activity to find sinks
      const actOutgoing = graph.getOutgoing(activityId);
      for (const outEdge of actOutgoing) {
        if (outEdge.type !== EdgeType.WritesTo) continue;
        if (visitedNodes.has(outEdge.to)) continue;
        visitedNodes.add(outEdge.to);

        const sinkNode = graph.getNode(outEdge.to);
        paths.push({
          steps: [
            actStep,
            {
              nodeId: outEdge.to,
              nodeType: sinkNode?.type ?? "unknown",
              name: sinkNode?.name ?? outEdge.to,
              edgeType: outEdge.type,
            },
          ],
        });
      }
    }
  }

  // Column-level lineage: scan activity and SP nodes for maps_column edges
  const columnMappings: ColumnMapping[] = [];
  if (attribute !== undefined) {
    // Gather all activities and stored procedures encountered
    const allActivityIds = new Set<string>();
    const allSpIds = new Set<string>();

    // From paths
    for (const p of paths) {
      for (const step of p.steps) {
        if (step.nodeId.startsWith("activity:")) {
          allActivityIds.add(step.nodeId);
        } else if (step.nodeId.startsWith("stored_procedure:")) {
          allSpIds.add(step.nodeId);
        }
      }
    }

    // Also from standard traversal
    const traversalResults = direction === "upstream"
      ? graph.traverseUpstream(nodeId, maxDepth)
      : graph.traverseDownstream(nodeId, maxDepth);
    for (const r of traversalResults) {
      if (r.node.id.startsWith("activity:")) {
        allActivityIds.add(r.node.id);
      } else if (r.node.id.startsWith("stored_procedure:")) {
        allSpIds.add(r.node.id);
      }
    }

    // Check activity nodes for maps_column edges (Copy activity mappings)
    for (const actId of allActivityIds) {
      const outgoing = graph.getOutgoing(actId);
      for (const edge of outgoing) {
        if (edge.type !== EdgeType.MapsColumn) continue;
        const sourceColumn = (edge.metadata.sourceColumn as string | null) ?? null;
        const sinkColumn = (edge.metadata.sinkColumn as string | null) ?? null;
        if (sourceColumn === attribute || sinkColumn === attribute) {
          columnMappings.push({
            activityId: actId,
            sourceColumn,
            sinkColumn,
          });
        }
      }
    }

    // Check SP nodes for maps_column edges (SP transform mappings)
    for (const spId of allSpIds) {
      const outgoing = graph.getOutgoing(spId);
      for (const edge of outgoing) {
        if (edge.type !== EdgeType.MapsColumn) continue;
        const sourceColumn = (edge.metadata.sourceColumn as string | null) ?? null;
        const targetColumn = (edge.metadata.targetColumn as string | null) ?? null;
        if (sourceColumn === attribute || targetColumn === attribute) {
          const mapping: ColumnMapping = {
            activityId: spId,
            sourceColumn,
            sinkColumn: targetColumn,
          };
          if (edge.metadata.sourceTable) mapping.sourceTable = edge.metadata.sourceTable as string;
          if (edge.metadata.targetTable) mapping.targetTable = edge.metadata.targetTable as string;
          if (edge.metadata.transformExpression) mapping.transformExpression = edge.metadata.transformExpression as string;
          columnMappings.push(mapping);
        }
      }
    }
  }

  return {
    entity,
    attribute,
    direction,
    paths,
    columnMappings,
    ...(maxDepth !== undefined ? { truncated: true } : {}),
  };
}
