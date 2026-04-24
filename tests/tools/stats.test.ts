import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleStats } from "../../src/tools/stats.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleStats", () => {
  it("returns node and edge counts from the graph", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStats(graph, null, false, []);
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.edgeCount).toBeGreaterThan(0);
    expect(result.nodesByType).toBeDefined();
    expect(result.edgesByType).toBeDefined();
  });

  it("includes staleness info (lastBuild and isStale)", () => {
    const { graph } = buildGraph(fixtureRoot);
    const now = new Date();
    const result = handleStats(graph, now, true, []);
    expect(result.lastBuild).toBe(now.toISOString());
    expect(result.isStale).toBe(true);

    const result2 = handleStats(graph, null, false, []);
    expect(result2.lastBuild).toBeNull();
    expect(result2.isStale).toBe(false);
  });

  it("includes build warnings in the result", () => {
    const { graph } = buildGraph(fixtureRoot);
    const warnings = ["Warning: something was odd", "Another warning"];
    const result = handleStats(graph, null, false, warnings);
    expect(result.warnings).toEqual(warnings);
  });
});
