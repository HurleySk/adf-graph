import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDataLineage, DataLineageResult, DataLineageSummaryResult } from "../../src/tools/lineage.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleDataLineage", () => {
  it("traces upstream lineage of a Dataverse entity and finds the staging table in the path", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full") as DataLineageResult;
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe("alm_organization");
    expect(result.direction).toBe("upstream");
    const nodeIds = result.paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(nodeIds.some((id) => id.startsWith("table:"))).toBe(true);
  });

  it("traces downstream lineage of a staging table", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "dbo.Org_Staging", undefined, "downstream", undefined, "full") as DataLineageResult;
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe("dbo.Org_Staging");
    expect(result.direction).toBe("downstream");
    const nodeIds = result.paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(nodeIds.some((id) => id.startsWith("dataverse_entity:"))).toBe(true);
  });

  it("returns column-level mappings when attribute is specified", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", "alm_name", "upstream", undefined, "full") as DataLineageResult;
    expect(result.attribute).toBe("alm_name");
    // The fixture has a mapping: org_name → alm_name
    expect(result.columnMappings.length).toBeGreaterThan(0);
    const mapping = result.columnMappings[0];
    expect(mapping.sinkColumn).toBe("alm_name");
    expect(mapping.sourceColumn).toBe("org_name");
  });

  it("limits traversal depth with maxDepth", () => {
    const { graph } = buildGraph(fixtureRoot);
    const full = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full") as DataLineageResult;
    const limited = handleDataLineage(graph, "alm_organization", undefined, "upstream", 1, "full") as DataLineageResult;
    expect(limited.paths.length).toBeLessThanOrEqual(full.paths.length);
    expect(limited.truncated).toBe(true);
    expect(full.truncated).toBeUndefined();
  });

  it("includes SP column mappings with table metadata and transform expression", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "dbo.Org_Staging", "org_type_code", "upstream", undefined, "full") as DataLineageResult;
    const spMappings = result.columnMappings.filter((m) =>
      m.activityId.startsWith("stored_procedure:"),
    );
    expect(spMappings.length).toBeGreaterThan(0);
    const mapping = spMappings.find((m) => m.sourceColumn === "org_type_code");
    expect(mapping).toBeDefined();
    expect(mapping!.sourceTable).toBe("dbo.Org_Staging");
    expect(mapping!.targetTable).toBe("dbo.Org_Staging");
    expect(mapping!.transformExpression).toContain("UPPER");
  });

  it("resolves table node without schema prefix via dbo default", () => {
    const { graph } = buildGraph(fixtureRoot);
    // "Org_Staging" should resolve to "table:dbo.Org_Staging"
    const result = handleDataLineage(graph, "Org_Staging", undefined, "downstream", undefined, "full") as DataLineageResult;
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe("Org_Staging");
    expect(result.paths.length).toBeGreaterThan(0);
  });

  it("resolves table node via case-insensitive scan", () => {
    const { graph } = buildGraph(fixtureRoot);
    // "org_staging" (lowercase) should still match "table:dbo.Org_Staging"
    const result = handleDataLineage(graph, "org_staging", undefined, "downstream", undefined, "full") as DataLineageResult;
    expect(result.error).toBeUndefined();
    expect(result.paths.length).toBeGreaterThan(0);
  });

  it("returns empty paths for an unknown entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "nonexistent_entity", undefined, "upstream", undefined, "full") as DataLineageResult;
    expect(result.paths).toEqual([]);
    expect(result.columnMappings).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("defaults to summary mode with nodesByType", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", undefined, "upstream");
    expect("nodesByType" in result).toBe(true);
    expect("paths" in result).toBe(false);
    expect(result.totalPaths).toBeGreaterThan(0);
  });

  it("summary mode still returns columnMappings when attribute specified", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", "alm_name", "upstream") as DataLineageSummaryResult;
    expect(result.columnMappings.length).toBeGreaterThan(0);
  });

  it("dedup removes duplicate path signatures in full mode", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full") as DataLineageResult;
    expect(result.duplicatesRemoved).toBeGreaterThanOrEqual(0);
    const sigs = result.paths.map((p) => p.steps.map((s) => s.nodeId).join("\u2192"));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("nodeTypes filters steps to only specified types in full mode", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full", ["table"]) as DataLineageResult;
    for (const p of result.paths) {
      for (const s of p.steps) {
        expect(s.nodeType).toBe("table");
      }
    }
  });

  it("nodeTypes filters nodesByType groups in summary mode", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "summary", ["table"]) as DataLineageSummaryResult;
    expect(result.nodesByType.every((g) => g.type === "table")).toBe(true);
  });

  it("limit restricts path count in full mode", () => {
    const { graph } = buildGraph(fixtureRoot);
    const all = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full") as DataLineageResult;
    const limited = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full", undefined, 2) as DataLineageResult;
    expect(limited.paths.length).toBeLessThanOrEqual(2);
    expect(limited.totalPaths).toBe(all.totalPaths);
  });

  it("offset skips paths in full mode", () => {
    const { graph } = buildGraph(fixtureRoot);
    const all = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full") as DataLineageResult;
    if (all.paths.length > 1) {
      const result = handleDataLineage(graph, "alm_organization", undefined, "upstream", undefined, "full", undefined, 2, 1) as DataLineageResult;
      expect(result.paths[0]).toEqual(all.paths[1]);
    }
  });
});

describe("lineage with schema data", () => {
  it("traces downstream from staging table through to dataverse attributes", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDataLineage(graph, "dbo.Org_Staging", undefined, "downstream", undefined, "full") as DataLineageResult;
    const nodeIds = result.paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(nodeIds.some((id) => id.startsWith("dataverse_attribute:"))).toBe(true);
  });

  it("matches attribute parameter against DataverseAttribute nodes", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDataLineage(graph, "alm_organization", "alm_name", "upstream", undefined, "full") as DataLineageResult;
    expect(result.columnMappings.length).toBeGreaterThan(0);
    expect(result.columnMappings.some((m) => m.sinkColumn === "alm_name" && m.sourceColumn === "org_name")).toBe(true);
  });
});
