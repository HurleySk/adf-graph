import { describe, it, expect } from "vitest";
import { Graph, NodeType, EdgeType } from "../../src/graph/model.js";

describe("Graph model", () => {
  it("adds and retrieves nodes by id", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "MyPipeline", metadata: {} });
    const node = g.getNode("p1");
    expect(node).toBeDefined();
    expect(node!.name).toBe("MyPipeline");
    expect(node!.type).toBe(NodeType.Pipeline);
  });

  it("returns undefined for missing node", () => {
    const g = new Graph();
    expect(g.getNode("nonexistent")).toBeUndefined();
  });

  it("adds edges and retrieves outgoing edges", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "P1", metadata: {} });
    g.addNode({ id: "a1", type: NodeType.Activity, name: "A1", metadata: {} });
    g.addEdge({ from: "p1", to: "a1", type: EdgeType.Contains, metadata: {} });

    const outgoing = g.getOutgoing("p1");
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].to).toBe("a1");
    expect(outgoing[0].type).toBe(EdgeType.Contains);
  });

  it("adds edges and retrieves incoming edges (reverse index)", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "P1", metadata: {} });
    g.addNode({ id: "a1", type: NodeType.Activity, name: "A1", metadata: {} });
    g.addEdge({ from: "p1", to: "a1", type: EdgeType.Contains, metadata: {} });

    const incoming = g.getIncoming("a1");
    expect(incoming).toHaveLength(1);
    expect(incoming[0].from).toBe("p1");
  });

  it("lists nodes by type", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "P1", metadata: {} });
    g.addNode({ id: "p2", type: NodeType.Pipeline, name: "P2", metadata: {} });
    g.addNode({ id: "a1", type: NodeType.Activity, name: "A1", metadata: {} });

    const pipelines = g.getNodesByType(NodeType.Pipeline);
    expect(pipelines).toHaveLength(2);
    expect(pipelines.map((n) => n.id)).toContain("p1");
    expect(pipelines.map((n) => n.id)).toContain("p2");

    const activities = g.getNodesByType(NodeType.Activity);
    expect(activities).toHaveLength(1);
  });

  it("counts nodes and edges via stats()", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "P1", metadata: {} });
    g.addNode({ id: "a1", type: NodeType.Activity, name: "A1", metadata: {} });
    g.addEdge({ from: "p1", to: "a1", type: EdgeType.Contains, metadata: {} });

    const stats = g.stats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.nodesByType[NodeType.Pipeline]).toBe(1);
    expect(stats.nodesByType[NodeType.Activity]).toBe(1);
    expect(stats.edgesByType[EdgeType.Contains]).toBe(1);
  });

  it("traverses downstream with BFS", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "P1", metadata: {} });
    g.addNode({ id: "p2", type: NodeType.Pipeline, name: "P2", metadata: {} });
    g.addNode({ id: "p3", type: NodeType.Pipeline, name: "P3", metadata: {} });
    g.addEdge({ from: "p1", to: "p2", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "p2", to: "p3", type: EdgeType.Executes, metadata: {} });

    const results = g.traverseDownstream("p1");
    const ids = results.map((r) => r.node.id);
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
    // p2 should come before p3 (BFS order)
    expect(ids.indexOf("p2")).toBeLessThan(ids.indexOf("p3"));
  });

  it("traverses upstream with BFS", () => {
    const g = new Graph();
    g.addNode({ id: "p1", type: NodeType.Pipeline, name: "P1", metadata: {} });
    g.addNode({ id: "p2", type: NodeType.Pipeline, name: "P2", metadata: {} });
    g.addNode({ id: "p3", type: NodeType.Pipeline, name: "P3", metadata: {} });
    g.addEdge({ from: "p1", to: "p2", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "p2", to: "p3", type: EdgeType.Executes, metadata: {} });

    const results = g.traverseUpstream("p3");
    const ids = results.map((r) => r.node.id);
    expect(ids).toContain("p2");
    expect(ids).toContain("p1");
    expect(ids.indexOf("p2")).toBeLessThan(ids.indexOf("p1"));
  });

  it("finds all paths between two nodes", () => {
    const g = new Graph();
    g.addNode({ id: "a", type: NodeType.Pipeline, name: "A", metadata: {} });
    g.addNode({ id: "b", type: NodeType.Pipeline, name: "B", metadata: {} });
    g.addNode({ id: "c", type: NodeType.Pipeline, name: "C", metadata: {} });
    g.addNode({ id: "d", type: NodeType.Pipeline, name: "D", metadata: {} });
    // Two paths: a→b→d and a→c→d
    g.addEdge({ from: "a", to: "b", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "a", to: "c", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "b", to: "d", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "c", to: "d", type: EdgeType.Executes, metadata: {} });

    const paths = g.findPaths("a", "d");
    expect(paths).toHaveLength(2);
    // Each path starts with "a" and ends with "d"
    for (const path of paths) {
      expect(path[0]).toBe("a");
      expect(path[path.length - 1]).toBe("d");
    }
  });

  it("handles cycles without infinite loop", () => {
    const g = new Graph();
    g.addNode({ id: "x", type: NodeType.Pipeline, name: "X", metadata: {} });
    g.addNode({ id: "y", type: NodeType.Pipeline, name: "Y", metadata: {} });
    g.addEdge({ from: "x", to: "y", type: EdgeType.Executes, metadata: {} });
    g.addEdge({ from: "y", to: "x", type: EdgeType.Executes, metadata: {} });

    // Should not hang or throw
    expect(() => g.traverseDownstream("x")).not.toThrow();
    expect(() => g.traverseUpstream("x")).not.toThrow();
    expect(() => g.findPaths("x", "y")).not.toThrow();

    const downstream = g.traverseDownstream("x");
    const ids = downstream.map((r) => r.node.id);
    expect(ids).toContain("y");
    // x should not appear in its own downstream (cycle handled)
    expect(ids).not.toContain("x");
  });
});
