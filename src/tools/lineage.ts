import { Graph, EdgeType, GraphEdge } from "../graph/model.js";

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
  // Resolve node ID: try dataverse_entity first, then table
  let nodeId = `dataverse_entity:${entity}`;
  if (!graph.getNode(nodeId)) {
    nodeId = `table:${entity}`;
  }

  const node = graph.getNode(nodeId);
  if (!node) {
    return {
      entity,
      attribute,
      direction,
      paths: [],
      columnMappings: [],
      error: `Node for '${entity}' not found as dataverse_entity or table`,
    };
  }

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
          columnMappings.push({
            activityId: spId,
            sourceColumn,
            sinkColumn: targetColumn,
          });
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
