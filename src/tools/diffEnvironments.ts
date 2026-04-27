import { GraphManager } from "../graph/manager.js";
import { Graph } from "../graph/model.js";
import { NodeType, EdgeType } from "../graph/model.js";

export interface ItemDiffSummary {
  name: string;
  nodeType: string;
  status: "added" | "removed" | "modified" | "unchanged";
  changes?: string[];
}

export interface EnvironmentDiffResult {
  envA: string;
  envB: string;
  scope: string;
  summary: { added: number; removed: number; modified: number; unchanged: number };
  items: ItemDiffSummary[];
  error?: string;
}

function compareNodesByType(
  graphA: Graph,
  graphB: Graph,
  nodeType: NodeType,
): ItemDiffSummary[] {
  const nodesA = graphA.getNodesByType(nodeType);
  const nodesB = graphB.getNodesByType(nodeType);

  const mapA = new Map(nodesA.map((n) => [n.name, n]));
  const mapB = new Map(nodesB.map((n) => [n.name, n]));

  const items: ItemDiffSummary[] = [];

  // Items only in A → removed
  for (const [name] of mapA) {
    if (!mapB.has(name)) {
      items.push({ name, nodeType, status: "removed" });
    }
  }

  // Items only in B → added
  for (const [name] of mapB) {
    if (!mapA.has(name)) {
      items.push({ name, nodeType, status: "added" });
    }
  }

  // Shared items → compare
  for (const [name, nodeA] of mapA) {
    const nodeB = mapB.get(name);
    if (!nodeB) continue;

    if (nodeType === NodeType.Pipeline) {
      const diff = comparePipeline(graphA, graphB, nodeA.id, nodeB.id);
      items.push({
        name,
        nodeType,
        status: diff.length > 0 ? "modified" : "unchanged",
        ...(diff.length > 0 ? { changes: diff } : {}),
      });
    } else if (nodeType === NodeType.Dataset) {
      const diff = compareDataset(graphA, graphB, nodeA.id, nodeB.id);
      items.push({
        name,
        nodeType,
        status: diff.length > 0 ? "modified" : "unchanged",
        ...(diff.length > 0 ? { changes: diff } : {}),
      });
    } else if (nodeType === NodeType.LinkedService) {
      const diff = compareLinkedService(nodeA.metadata, nodeB.metadata);
      items.push({
        name,
        nodeType,
        status: diff.length > 0 ? "modified" : "unchanged",
        ...(diff.length > 0 ? { changes: diff } : {}),
      });
    }
  }

  return items;
}

function comparePipeline(
  graphA: Graph,
  graphB: Graph,
  idA: string,
  idB: string,
): string[] {
  const changes: string[] = [];

  const activitiesA = graphA
    .getOutgoing(idA)
    .filter((e) => e.type === EdgeType.Contains);
  const activitiesB = graphB
    .getOutgoing(idB)
    .filter((e) => e.type === EdgeType.Contains);

  const actNamesA = new Set(activitiesA.map((e) => graphA.getNode(e.to)?.name).filter(Boolean));
  const actNamesB = new Set(activitiesB.map((e) => graphB.getNode(e.to)?.name).filter(Boolean));

  if (activitiesA.length !== activitiesB.length) {
    changes.push(`activity count: ${activitiesA.length} → ${activitiesB.length}`);
  }

  const addedActs = [...actNamesB].filter((n) => !actNamesA.has(n));
  const removedActs = [...actNamesA].filter((n) => !actNamesB.has(n));

  if (addedActs.length > 0) {
    changes.push(`activities added: ${addedActs.join(", ")}`);
  }
  if (removedActs.length > 0) {
    changes.push(`activities removed: ${removedActs.join(", ")}`);
  }

  return changes;
}

function compareDataset(
  graphA: Graph,
  graphB: Graph,
  idA: string,
  idB: string,
): string[] {
  const changes: string[] = [];

  const nodeA = graphA.getNode(idA);
  const nodeB = graphB.getNode(idB);
  if (!nodeA || !nodeB) return changes;

  const lsEdgesA = graphA.getOutgoing(idA).filter((e) => e.type === EdgeType.UsesLinkedService);
  const lsEdgesB = graphB.getOutgoing(idB).filter((e) => e.type === EdgeType.UsesLinkedService);
  const lsNamesA = lsEdgesA.map((e) => graphA.getNode(e.to)?.name).filter(Boolean).sort();
  const lsNamesB = lsEdgesB.map((e) => graphB.getNode(e.to)?.name).filter(Boolean).sort();

  if (JSON.stringify(lsNamesA) !== JSON.stringify(lsNamesB)) {
    changes.push(`linked service changed`);
  }

  if (JSON.stringify(nodeA.metadata) !== JSON.stringify(nodeB.metadata)) {
    changes.push("metadata differs");
  }

  return changes;
}

function compareLinkedService(
  metaA: Record<string, unknown>,
  metaB: Record<string, unknown>,
): string[] {
  const changes: string[] = [];

  if (JSON.stringify(metaA) !== JSON.stringify(metaB)) {
    changes.push("configuration differs");
  }

  return changes;
}

export function handleDiffEnvironments(
  manager: GraphManager,
  envA: string,
  envB: string,
  scope: string,
): EnvironmentDiffResult {
  let graphA: Graph;
  let graphB: Graph;

  try {
    graphA = manager.ensureGraph(envA).graph;
  } catch (err) {
    return {
      envA,
      envB,
      scope,
      summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      items: [],
      error: `Failed to load environment '${envA}': ${String(err)}`,
    };
  }

  try {
    graphB = manager.ensureGraph(envB).graph;
  } catch (err) {
    return {
      envA,
      envB,
      scope,
      summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      items: [],
      error: `Failed to load environment '${envB}': ${String(err)}`,
    };
  }

  const nodeTypes: NodeType[] = [NodeType.Pipeline];
  if (scope === "all") {
    nodeTypes.push(NodeType.Dataset, NodeType.LinkedService);
  }

  const allItems: ItemDiffSummary[] = [];
  for (const nt of nodeTypes) {
    allItems.push(...compareNodesByType(graphA, graphB, nt));
  }

  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const item of allItems) {
    summary[item.status]++;
  }

  return { envA, envB, scope, summary, items: allItems };
}
