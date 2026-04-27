import { Graph, GraphNode, NodeType } from "../graph/model.js";
import { makeNodeId } from "../utils/nodeId.js";

export interface PipelineLookupSuccess {
  node: GraphNode;
  id: string;
  error: undefined;
}

export interface PipelineLookupFailure {
  node: undefined;
  id: string;
  error: string;
}

export type PipelineLookupResult = PipelineLookupSuccess | PipelineLookupFailure;

/**
 * Look up a pipeline node by name.  Returns the node and its ID on success,
 * or an error message when the pipeline is not found.
 */
export function lookupPipelineNode(graph: Graph, pipeline: string): PipelineLookupResult {
  const id = makeNodeId(NodeType.Pipeline, pipeline);
  const node = graph.getNode(id);
  if (!node) {
    return { node: undefined, id, error: `Pipeline '${pipeline}' not found` };
  }
  return { node, id, error: undefined };
}
