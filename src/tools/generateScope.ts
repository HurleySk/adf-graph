import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { lookupPipelineNode } from "./toolUtils.js";
import { findExecutePipelineActivities } from "../graph/traversalUtils.js";
import { parseNodeId } from "../utils/nodeId.js";

export interface PipelineInfo {
  children: string[];
  roots: string[];
}

export interface GenerateScopeOptions {
  roots: string[];
  folder?: string;
}

export interface GenerateScopeResult {
  generatedAt: string;
  roots: string[];
  pipelines: Record<string, PipelineInfo>;
  storedProcedures: string[];
  tables: string[];
  datasets: string[];
  orphans?: {
    folderName: string;
    pipelines: string[];
  };
}

/**
 * Walk orchestrator pipeline trees, collect all reachable artifacts,
 * and optionally detect folder orphans.
 */
export function handleGenerateScope(
  graph: Graph,
  options: GenerateScopeOptions,
): GenerateScopeResult {
  const { roots, folder } = options;

  // pipelines: name → { children, roots }
  const pipelineMap = new Map<string, { children: Set<string>; roots: Set<string> }>();
  const storedProcedures = new Set<string>();
  const tables = new Set<string>();
  const datasets = new Set<string>();

  for (const rootName of roots) {
    const lookup = lookupPipelineNode(graph, rootName);
    if (lookup.error) {
      // Unknown root — skip silently
      continue;
    }

    // BFS downstream, following only Executes edges pipeline→pipeline
    const visited = new Set<string>();
    const queue: string[] = [lookup.id];
    visited.add(lookup.id);

    while (queue.length > 0) {
      const pipelineId = queue.shift()!;
      const pipelineNode = graph.getNode(pipelineId);
      if (!pipelineNode || pipelineNode.type !== NodeType.Pipeline) continue;

      const pipelineName = pipelineNode.name;

      // Ensure this pipeline exists in the map
      if (!pipelineMap.has(pipelineName)) {
        pipelineMap.set(pipelineName, { children: new Set(), roots: new Set() });
      }
      const info = pipelineMap.get(pipelineName)!;
      info.roots.add(rootName);

      // Find ExecutePipeline activities → follow Executes edges to child pipelines
      const execActivities = findExecutePipelineActivities(graph, pipelineId);
      for (const actNode of execActivities) {
        const execEdges = graph.getOutgoing(actNode.id).filter((e) => e.type === EdgeType.Executes);
        for (const edge of execEdges) {
          const childNode = graph.getNode(edge.to);
          if (!childNode || childNode.type !== NodeType.Pipeline) continue;
          info.children.add(childNode.name);

          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push(edge.to);
          }
        }
      }

      // Also follow direct Executes edges from the pipeline node itself
      // (some graphs may have pipeline→pipeline edges directly)
      const directExecEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Executes);
      for (const edge of directExecEdges) {
        const childNode = graph.getNode(edge.to);
        if (!childNode || childNode.type !== NodeType.Pipeline) continue;
        info.children.add(childNode.name);

        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }

      // Collect artifacts from all activities in this pipeline (Contains edges)
      const containsEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Contains);
      for (const ce of containsEdges) {
        const actNode = graph.getNode(ce.to);
        if (!actNode) continue;

        const actOutgoing = graph.getOutgoing(actNode.id);
        for (const edge of actOutgoing) {
          const targetNode = graph.getNode(edge.to);
          if (!targetNode) continue;

          if (edge.type === EdgeType.CallsSp && targetNode.type === NodeType.StoredProcedure) {
            storedProcedures.add(targetNode.name);
          } else if (
            (edge.type === EdgeType.ReadsFrom || edge.type === EdgeType.WritesTo) &&
            targetNode.type === NodeType.Table
          ) {
            tables.add(targetNode.name);
          } else if (edge.type === EdgeType.UsesDataset && targetNode.type === NodeType.Dataset) {
            datasets.add(targetNode.name);
          }
        }
      }
    }
  }

  // Build final pipelines record
  const pipelines: Record<string, PipelineInfo> = {};
  for (const [name, info] of pipelineMap) {
    pipelines[name] = {
      children: Array.from(info.children).sort(),
      roots: Array.from(info.roots).sort(),
    };
  }

  const result: GenerateScopeResult = {
    generatedAt: new Date().toISOString(),
    roots,
    pipelines,
    storedProcedures: Array.from(storedProcedures).sort(),
    tables: Array.from(tables).sort(),
    datasets: Array.from(datasets).sort(),
  };

  // Orphan detection
  if (folder !== undefined) {
    const reachableNames = new Set(Object.keys(pipelines));
    const allPipelineNodes = graph.getNodesByType(NodeType.Pipeline);
    const orphanPipelines: string[] = [];

    for (const node of allPipelineNodes) {
      if (node.metadata.folder === folder && !reachableNames.has(node.name)) {
        orphanPipelines.push(node.name);
      }
    }

    result.orphans = {
      folderName: folder,
      pipelines: orphanPipelines.sort(),
    };
  }

  return result;
}
