import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleExport } from "../../src/tools/export.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleExport", () => {
  it("returns all nodes and edges from the graph", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");
    const stats = graph.stats();

    expect(result.environment).toBe("test-env");
    expect(result.exportedAt).toBeDefined();
    expect(result.stats.nodeCount).toBe(stats.nodeCount);
    expect(result.stats.edgeCount).toBe(stats.edgeCount);
    expect(result.nodes).toHaveLength(stats.nodeCount);
    expect(result.edges).toHaveLength(stats.edgeCount);
  });

  it("includes node id, type, name, and metadata", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");
    const node = result.nodes[0];

    expect(node).toHaveProperty("id");
    expect(node).toHaveProperty("type");
    expect(node).toHaveProperty("name");
    expect(node).toHaveProperty("metadata");
  });

  it("includes edge from, to, type, and metadata", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");
    const edge = result.edges[0];

    expect(edge).toHaveProperty("from");
    expect(edge).toHaveProperty("to");
    expect(edge).toHaveProperty("type");
    expect(edge).toHaveProperty("metadata");
  });

  it("includes stats grouped by type", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");

    expect(result.stats.nodesByType).toBeDefined();
    expect(result.stats.edgesByType).toBeDefined();
  });
});
