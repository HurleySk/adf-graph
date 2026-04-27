import { describe, it, expect } from "vitest";
import { Graph, NodeType, EdgeType } from "../../src/graph/model.js";

describe("Graph", () => {
  it("adds nodes and retrieves by id", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:Load Org", type: NodeType.Pipeline, name: "Load Org", metadata: {} });
    const node = g.getNode("pipeline:Load Org");
    expect(node).toBeDefined();
    expect(node!.name).toBe("Load Org");
  });

  it("returns undefined for missing node", () => {
    const g = new Graph();
    expect(g.getNode("pipeline:missing")).toBeUndefined();
  });

  it("adds edges and retrieves outgoing", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

    const outgoing = g.getOutgoing("pipeline:A");
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].to).toBe("pipeline:B");
  });

  it("adds edges and retrieves incoming (reverse index)", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

    const incoming = g.getIncoming("pipeline:B");
    expect(incoming).toHaveLength(1);
    expect(incoming[0].from).toBe("pipeline:A");
  });

  it("lists nodes by type", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "table:T1", type: NodeType.Table, name: "T1", metadata: {} });

    const pipelines = g.getNodesByType(NodeType.Pipeline);
    expect(pipelines).toHaveLength(2);
  });

  it("counts nodes and edges", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

    const stats = g.stats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.nodesByType[NodeType.Pipeline]).toBe(2);
    expect(stats.edgesByType[EdgeType.Executes]).toBe(1);
  });

  it("traverses downstream (BFS)", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    const downstream = g.traverseDownstream("pipeline:A");
    const ids = downstream.map((r) => r.node.id);
    expect(ids).toContain("pipeline:B");
    expect(ids).toContain("pipeline:C");
    // Path should be edges, not node IDs
    const cResult = downstream.find((r) => r.node.id === "pipeline:C")!;
    expect(cResult.path).toHaveLength(2); // two edges: A→B, B→C
    expect(cResult.path[0].from).toBe("pipeline:A");
    expect(cResult.path[1].to).toBe("pipeline:C");
    expect(cResult.depth).toBe(2);
  });

  it("traverses upstream (BFS)", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    const upstream = g.traverseUpstream("pipeline:C");
    const ids = upstream.map((r) => r.node.id);
    expect(ids).toContain("pipeline:B");
    expect(ids).toContain("pipeline:A");
  });

  it("finds all paths between two nodes", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    const paths = g.findPaths("pipeline:A", "pipeline:C");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(2); // two edges: A→B, B→C
    expect(paths[0][0].from).toBe("pipeline:A");
    expect(paths[0][0].to).toBe("pipeline:B");
    expect(paths[0][1].from).toBe("pipeline:B");
    expect(paths[0][1].to).toBe("pipeline:C");
  });

  it("traverseDownstream respects maxDepth", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    const limited = g.traverseDownstream("pipeline:A", 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].node.id).toBe("pipeline:B");

    const unlimited = g.traverseDownstream("pipeline:A");
    expect(unlimited).toHaveLength(2);
  });

  it("traverseUpstream respects maxDepth", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    const limited = g.traverseUpstream("pipeline:C", 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].node.id).toBe("pipeline:B");
  });

  it("handles cycles without infinite loop", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:A", type: EdgeType.Executes, metadata: {} });

    const downstream = g.traverseDownstream("pipeline:A");
    expect(downstream).toHaveLength(1); // just B, stops at cycle
  });

  it("clones a graph with independent node/edge copies", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: { x: 1 } });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

    const cloned = g.clone();

    expect(cloned.getNode("pipeline:A")).toEqual(g.getNode("pipeline:A"));
    expect(cloned.getNode("pipeline:B")).toEqual(g.getNode("pipeline:B"));
    expect(cloned.getOutgoing("pipeline:A")).toEqual(g.getOutgoing("pipeline:A"));
    expect(cloned.getIncoming("pipeline:B")).toEqual(g.getIncoming("pipeline:B"));
    expect(cloned.stats()).toEqual(g.stats());

    cloned.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    expect(cloned.stats().nodeCount).toBe(3);
    expect(g.stats().nodeCount).toBe(2);
  });

  it("clones an empty graph", () => {
    const g = new Graph();
    const cloned = g.clone();
    expect(cloned.stats().nodeCount).toBe(0);
    expect(cloned.stats().edgeCount).toBe(0);
  });

  it("replaceNode replaces an existing node's data", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: { v: 1 } });
    g.replaceNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A-updated", metadata: { v: 2 } });
    expect(g.getNode("pipeline:A")!.name).toBe("A-updated");
    expect(g.getNode("pipeline:A")!.metadata).toEqual({ v: 2 });
  });

  it("replaceNode adds the node if it didn't exist", () => {
    const g = new Graph();
    g.replaceNode({ id: "pipeline:X", type: NodeType.Pipeline, name: "X", metadata: {} });
    expect(g.getNode("pipeline:X")).toBeDefined();
  });

  it("supports LinkedService and KeyVaultSecret node types", () => {
    const graph = new Graph();
    graph.addNode({ id: "linked_service:ls_sql", type: NodeType.LinkedService, name: "ls_sql", metadata: {} });
    graph.addNode({ id: "key_vault_secret:ALM-SQL-CONN", type: NodeType.KeyVaultSecret, name: "ALM-SQL-CONN", metadata: {} });
    graph.addEdge({ from: "linked_service:ls_sql", to: "key_vault_secret:ALM-SQL-CONN", type: EdgeType.ReferencesSecret, metadata: {} });
    expect(graph.getNode("linked_service:ls_sql")?.type).toBe(NodeType.LinkedService);
    expect(graph.getNode("key_vault_secret:ALM-SQL-CONN")?.type).toBe(NodeType.KeyVaultSecret);
    expect(graph.getOutgoing("linked_service:ls_sql")[0].type).toBe(EdgeType.ReferencesSecret);
  });

  it("removeEdgesForNode removes all outgoing and incoming edges for a node", () => {
    const g = new Graph();
    g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "pipeline:C", to: "pipeline:A", type: EdgeType.DependsOn, metadata: {} });
    g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    g.removeEdgesForNode("pipeline:A");

    expect(g.getOutgoing("pipeline:A")).toHaveLength(0);
    expect(g.getIncoming("pipeline:A")).toHaveLength(0);
    expect(g.getOutgoing("pipeline:B")).toHaveLength(1);
    expect(g.getIncoming("pipeline:C")).toHaveLength(1);
  });
});
