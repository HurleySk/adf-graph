import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleEnhancedSearch } from "../../src/tools/enhancedSearch.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleEnhancedSearch", () => {
  it("basic text search returns matches by node name", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "Copy");
    expect(result.query).toBe("Copy");
    expect(result.totalHits).toBeGreaterThan(0);
    // Should find pipelines and/or activities with "Copy" in the name
    const names = result.hits.map((h) => h.name);
    expect(names.some((n) => n.toLowerCase().includes("copy"))).toBe(true);
  });

  it("activity type filter narrows results to matching type", () => {
    const { graph } = buildGraph(fixtureRoot);
    // Search broadly but filter to Copy activities only
    const result = handleEnhancedSearch(graph, "org", {
      activityType: "Copy",
    });
    expect(result.filters).toBeDefined();
    expect(result.filters!.activityType).toBe("Copy");
    for (const hit of result.hits) {
      expect(hit.activityType!.toLowerCase()).toBe("copy");
    }
  });

  it("pipeline filter limits results to one pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "org", {
      pipeline: "Copy_To_Dataverse",
    });
    expect(result.filters).toBeDefined();
    expect(result.filters!.pipeline).toBe("Copy_To_Dataverse");
    for (const hit of result.hits) {
      expect(hit.pipeline).toBe("Copy_To_Dataverse");
    }
    expect(result.totalHits).toBeGreaterThan(0);
  });

  it("summary mode omits snippet, full mode includes snippet", () => {
    const { graph } = buildGraph(fixtureRoot);

    const summary = handleEnhancedSearch(graph, "Org_Staging", { detail: "summary" });
    expect(summary.totalHits).toBeGreaterThan(0);
    for (const hit of summary.hits) {
      expect(hit.snippet).toBeUndefined();
    }

    const full = handleEnhancedSearch(graph, "Org_Staging", { detail: "full" });
    expect(full.totalHits).toBeGreaterThan(0);
    const hitsWithSnippet = full.hits.filter((h) => h.snippet !== undefined);
    expect(hitsWithSnippet.length).toBeGreaterThan(0);
  });

  it("non-existent query returns empty hits", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "zzz_nonexistent_pattern_xyz");
    expect(result.totalHits).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it("nodeType filter restricts to that type", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "Copy", {
      nodeType: "pipeline",
    });
    for (const hit of result.hits) {
      expect(hit.nodeType).toBe("pipeline");
    }
  });

  it("targetEntity filter finds activities writing to an entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "Upsert", {
      targetEntity: "alm_organization",
    });
    expect(result.totalHits).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.targets).toBeDefined();
      expect(hit.targets!.some((t) => t.toLowerCase().includes("alm_organization"))).toBe(true);
    }
  });

  it("is case-insensitive for text search", () => {
    const { graph } = buildGraph(fixtureRoot);
    const upper = handleEnhancedSearch(graph, "UPSERT ORGANIZATIONS");
    const lower = handleEnhancedSearch(graph, "upsert organizations");
    expect(upper.totalHits).toBe(lower.totalHits);
    expect(upper.totalHits).toBeGreaterThan(0);
  });

  it("searches activity metadata fields (SQL queries)", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "SELECT org_id", {
      nodeType: "activity",
    });
    expect(result.totalHits).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(["sqlQuery", "pipelineParameters"]).toContain(hit.field);
    }
  });

  it("filters record is omitted when no filters are set", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "Copy");
    expect(result.filters).toBeUndefined();
  });

  it("includes pipeline and activityType for activity hits", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEnhancedSearch(graph, "Upsert Organizations", {
      nodeType: "activity",
    });
    expect(result.totalHits).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.pipeline).toBeDefined();
      expect(hit.activityType).toBeDefined();
    }
  });
});

describe("search with schema data", () => {
  it("finds DataverseEntity nodes by name", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_organization", {});
    expect(result.hits.some((h) => h.nodeType === "dataverse_entity")).toBe(true);
  });

  it("finds DataverseEntity nodes by displayName metadata", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "Organization", {});
    expect(result.hits.some((h) => h.nodeType === "dataverse_entity" && h.name === "alm_organization")).toBe(true);
  });

  it("finds DataverseAttribute nodes by name", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_orgcode", {});
    expect(result.hits.some((h) => h.nodeType === "dataverse_attribute")).toBe(true);
  });

  it("filters by nodeType dataverse_entity", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_", { nodeType: "dataverse_entity" });
    expect(result.hits.every((h) => h.nodeType === "dataverse_entity")).toBe(true);
  });

  it("filters by nodeType dataverse_attribute", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_", { nodeType: "dataverse_attribute" });
    expect(result.hits.every((h) => h.nodeType === "dataverse_attribute")).toBe(true);
  });
});
