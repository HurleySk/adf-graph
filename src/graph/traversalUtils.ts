import { Graph, GraphNode, NodeType, EdgeType } from "./model.js";
import { getActivityMetadata } from "./nodeMetadata.js";

export interface ContainedActivity {
  /** The activity node. */
  node: GraphNode;
  /** The container activity holding it, or undefined for top-level activities. */
  parent?: GraphNode;
  /** 0 for top-level activities, 1 for activities inside one container, etc. */
  depth: number;
}

/**
 * Depth-first, pre-order walk of the Contains tree rooted at `rootId`.
 *
 * ADF container activities (Until, ForEach, Switch, IfCondition) nest their
 * children under typeProperties rather than the pipeline's top-level
 * `activities` array. The graph models that nesting with Contains edges from
 * the container activity node, so anything reading only the pipeline node's
 * direct Contains edges silently misses every nested activity -- including the
 * Copy activities inside the batched Dataverse upsert pattern.
 *
 * Both container activities and their children are returned, at arbitrary
 * nesting depth. Cycles are guarded against.
 */
export function collectContainedActivities(graph: Graph, rootId: string): ContainedActivity[] {
  const collected: ContainedActivity[] = [];
  const visited = new Set<string>([rootId]);

  function walk(parentId: string, parent: GraphNode | undefined, depth: number): void {
    for (const edge of graph.getOutgoing(parentId)) {
      if (edge.type !== EdgeType.Contains) continue;
      if (visited.has(edge.to)) continue;
      const node = graph.getNode(edge.to);
      if (!node || node.type !== NodeType.Activity) continue;
      visited.add(edge.to);
      collected.push({ node, parent, depth });
      walk(node.id, node, depth + 1);
    }
  }

  walk(rootId, undefined, 0);
  return collected;
}

/**
 * All activity nodes belonging to a pipeline, including activities nested
 * inside container activities at any depth.
 */
export function collectPipelineActivities(graph: Graph, pipelineId: string): GraphNode[] {
  return collectContainedActivities(graph, pipelineId).map((a) => a.node);
}

/**
 * Find all ExecutePipeline activity nodes contained by the given pipeline,
 * including those nested inside container activities.
 */
export function findExecutePipelineActivities(graph: Graph, pipelineId: string): GraphNode[] {
  return collectPipelineActivities(graph, pipelineId).filter(
    (n) => getActivityMetadata(n).activityType === "ExecutePipeline",
  );
}
