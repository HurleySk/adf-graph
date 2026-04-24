export enum NodeType {
  Pipeline = "Pipeline",
  Activity = "Activity",
  Dataset = "Dataset",
  StoredProcedure = "StoredProcedure",
  Table = "Table",
  DataverseEntity = "DataverseEntity",
}

export enum EdgeType {
  Executes = "Executes",
  Contains = "Contains",
  DependsOn = "DependsOn",
  ReadsFrom = "ReadsFrom",
  WritesTo = "WritesTo",
  CallsSp = "CallsSp",
  UsesDataset = "UsesDataset",
  UsesLinkedService = "UsesLinkedService",
  MapsColumn = "MapsColumn",
}

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  metadata: Record<string, unknown>;
}

export interface TraversalResult {
  node: GraphNode;
  path: string[];
  depth: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Partial<Record<NodeType, number>>;
  edgesByType: Partial<Record<EdgeType, number>>;
}

export class Graph {
  private nodes: Map<string, GraphNode> = new Map();
  private outgoing: Map<string, GraphEdge[]> = new Map();
  private incoming: Map<string, GraphEdge[]> = new Map();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) {
      this.outgoing.set(node.id, []);
    }
    if (!this.incoming.has(node.id)) {
      this.incoming.set(node.id, []);
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  addEdge(edge: GraphEdge): void {
    // Ensure adjacency lists exist even for nodes not yet explicitly added
    if (!this.outgoing.has(edge.from)) {
      this.outgoing.set(edge.from, []);
    }
    if (!this.incoming.has(edge.to)) {
      this.incoming.set(edge.to, []);
    }
    this.outgoing.get(edge.from)!.push(edge);
    this.incoming.get(edge.to)!.push(edge);
  }

  getOutgoing(id: string): GraphEdge[] {
    return this.outgoing.get(id) ?? [];
  }

  getIncoming(id: string): GraphEdge[] {
    return this.incoming.get(id) ?? [];
  }

  getNodesByType(type: NodeType): GraphNode[] {
    const result: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.type === type) {
        result.push(node);
      }
    }
    return result;
  }

  stats(): GraphStats {
    const nodesByType: Partial<Record<NodeType, number>> = {};
    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    }

    const edgesByType: Partial<Record<EdgeType, number>> = {};
    let edgeCount = 0;
    for (const edges of this.outgoing.values()) {
      for (const edge of edges) {
        edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
        edgeCount++;
      }
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount,
      nodesByType,
      edgesByType,
    };
  }

  traverseDownstream(startId: string): TraversalResult[] {
    return this.bfs(startId, "downstream");
  }

  traverseUpstream(startId: string): TraversalResult[] {
    return this.bfs(startId, "upstream");
  }

  private bfs(startId: string, direction: "downstream" | "upstream"): TraversalResult[] {
    const results: TraversalResult[] = [];
    const visited = new Set<string>([startId]);
    // Queue holds [currentId, pathSoFar]
    const queue: [string, string[]][] = [[startId, [startId]]];

    while (queue.length > 0) {
      const [currentId, path] = queue.shift()!;
      const edges =
        direction === "downstream"
          ? this.getOutgoing(currentId)
          : this.getIncoming(currentId);

      for (const edge of edges) {
        const neighborId = direction === "downstream" ? edge.to : edge.from;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;

        const newPath = [...path, neighborId];
        results.push({ node: neighborNode, path: newPath, depth: newPath.length - 1 });
        queue.push([neighborId, newPath]);
      }
    }

    return results;
  }

  findPaths(fromId: string, toId: string, maxDepth: number = 20): string[][] {
    const results: string[][] = [];
    const stack: [string, string[]][] = [[fromId, [fromId]]];

    while (stack.length > 0) {
      const [currentId, path] = stack.pop()!;

      if (currentId === toId) {
        results.push(path);
        continue;
      }

      if (path.length - 1 >= maxDepth) continue;

      for (const edge of this.getOutgoing(currentId)) {
        const nextId = edge.to;
        // Avoid revisiting nodes already in the current path (cycle guard)
        if (path.includes(nextId)) continue;
        stack.push([nextId, [...path, nextId]]);
      }
    }

    return results;
  }

  getAllReferencedIds(): Set<string> {
    const ids = new Set<string>();
    for (const edges of this.outgoing.values()) {
      for (const edge of edges) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
  }
}
