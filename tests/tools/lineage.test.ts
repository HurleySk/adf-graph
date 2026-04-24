import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDataLineage } from "../../src/tools/lineage.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleDataLineage", () => {
  it("traces upstream lineage of a Dataverse entity and finds the staging table in the path", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", undefined, "upstream");
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe("alm_organization");
    expect(result.direction).toBe("upstream");
    const nodeIds = result.paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(nodeIds.some((id) => id.startsWith("table:"))).toBe(true);
  });

  it("traces downstream lineage of a staging table", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "dbo.Org_Staging", undefined, "downstream");
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe("dbo.Org_Staging");
    expect(result.direction).toBe("downstream");
    const nodeIds = result.paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(nodeIds.some((id) => id.startsWith("dataverse_entity:"))).toBe(true);
  });

  it("returns column-level mappings when attribute is specified", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", "alm_name", "upstream");
    expect(result.attribute).toBe("alm_name");
    // The fixture has a mapping: org_name → alm_name
    expect(result.columnMappings.length).toBeGreaterThan(0);
    const mapping = result.columnMappings[0];
    expect(mapping.sinkColumn).toBe("alm_name");
    expect(mapping.sourceColumn).toBe("org_name");
  });

  it("returns empty paths for an unknown entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "nonexistent_entity", undefined, "upstream");
    expect(result.paths).toEqual([]);
    expect(result.columnMappings).toEqual([]);
    expect(result.error).toBeDefined();
  });
});
