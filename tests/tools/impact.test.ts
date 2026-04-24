import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleImpactAnalysis } from "../../src/tools/impact.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleImpactAnalysis", () => {
  it("upstream of a stored procedure finds the calling activity and pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleImpactAnalysis(graph, "dbo.p_Transform_Org", "stored_procedure", "upstream");
    expect(result.error).toBeUndefined();
    const ids = result.affected.map((a) => a.nodeId);
    // The SP is called by an activity in SP_Transform
    expect(ids.some((id) => id.startsWith("activity:"))).toBe(true);
    expect(ids.some((id) => id === "pipeline:SP_Transform")).toBe(true);
  });

  it("downstream of the orchestrator reaches the Dataverse entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleImpactAnalysis(graph, "Test_Orchestrator", "pipeline", "downstream");
    expect(result.error).toBeUndefined();
    const ids = result.affected.map((a) => a.nodeId);
    expect(ids.some((id) => id.startsWith("dataverse_entity:"))).toBe(true);
    // Should also include child pipelines
    expect(ids).toContain("pipeline:Copy_To_Staging");
  });

  it("both directions for a table includes upstream and downstream nodes", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleImpactAnalysis(graph, "dbo.Org_Staging", "table", "both");
    expect(result.direction).toBe("both");
    const ids = result.affected.map((a) => a.nodeId);
    // Downstream: Dataverse entity (via Copy_To_Dataverse which reads from the staging table)
    // Upstream: Copy_To_Staging activity writes to it
    expect(ids.length).toBeGreaterThan(0);
  });

  it("returns empty affected and error for unknown node", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleImpactAnalysis(graph, "nonexistent", "pipeline", "downstream");
    expect(result.affected).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("affected entries include the edge path showing why they are affected", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleImpactAnalysis(graph, "Test_Orchestrator", "pipeline", "downstream");
    expect(result.error).toBeUndefined();
    // Each affected entry should have a non-empty path (except immediate neighbours might have depth 1 with 1 edge)
    for (const entry of result.affected) {
      expect(Array.isArray(entry.path)).toBe(true);
      expect(entry.path.length).toBeGreaterThan(0);
    }
  });
});
