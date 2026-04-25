export enum NodeType {
  Pipeline = "pipeline",
  Activity = "activity",
  Dataset = "dataset",
  StoredProcedure = "stored_procedure",
  Table = "table",
  DataverseEntity = "dataverse_entity",
}

export enum EdgeType {
  Executes = "executes",
  Contains = "contains",
  DependsOn = "depends_on",
  ReadsFrom = "reads_from",
  WritesTo = "writes_to",
  CallsSp = "calls_sp",
  UsesDataset = "uses_dataset",
  UsesLinkedService = "uses_linked_service",
  MapsColumn = "maps_column",
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
  path: GraphEdge[];
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
    const queue: Array<{ id: string; path: GraphEdge[]; depth: number }> = [
      { id: startId, path: [], depth: 0 },
    ];

    while (queue.length > 0) {
      const { id, path, depth } = queue.shift()!;
      const edges =
        direction === "downstream"
          ? this.getOutgoing(id)
          : this.getIncoming(id);

      for (const edge of edges) {
        const nextId = direction === "downstream" ? edge.to : edge.from;
        if (visited.has(nextId)) continue;
        visited.add(nextId);

        const nextPath = [...path, edge];
        const node = this.nodes.get(nextId);
        if (node) {
          results.push({ node, path: nextPath, depth: depth + 1 });
        }
        queue.push({ id: nextId, path: nextPath, depth: depth + 1 });
      }
    }

    return results;
  }

  findPaths(fromId: string, toId: string, maxDepth = 20): GraphEdge[][] {
    const results: GraphEdge[][] = [];
    const dfs = (current: string, path: GraphEdge[], visited: Set<string>) => {
      if (current === toId && path.length > 0) {
        results.push([...path]);
        return;
      }
      if (path.length >= maxDepth) return;
      for (const edge of this.getOutgoing(current)) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        path.push(edge);
        dfs(edge.to, path, visited);
        path.pop();
        visited.delete(edge.to);
      }
    };
    const visited = new Set<string>([fromId]);
    dfs(fromId, [], visited);
    return results;
  }

  clone(): Graph {
    const copy = new Graph();
    for (const node of this.nodes.values()) {
      copy.addNode({ ...node, metadata: { ...node.metadata } });
    }
    for (const edges of this.outgoing.values()) {
      for (const edge of edges) {
        copy.addEdge({ ...edge, metadata: { ...edge.metadata } });
      }
    }
    return copy;
  }

  replaceNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) {
      this.outgoing.set(node.id, []);
    }
    if (!this.incoming.has(node.id)) {
      this.incoming.set(node.id, []);
    }
  }

  removeEdgesForNode(id: string): void {
    const outgoing = this.outgoing.get(id) ?? [];
    for (const edge of outgoing) {
      const targetIncoming = this.incoming.get(edge.to);
      if (targetIncoming) {
        const filtered = targetIncoming.filter((e) => e.from !== id);
        this.incoming.set(edge.to, filtered);
      }
    }
    this.outgoing.set(id, []);

    const incoming = this.incoming.get(id) ?? [];
    for (const edge of incoming) {
      const sourceOutgoing = this.outgoing.get(edge.from);
      if (sourceOutgoing) {
        const filtered = sourceOutgoing.filter((e) => e.to !== id);
        this.outgoing.set(edge.from, filtered);
      }
    }
    this.incoming.set(id, []);
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
