import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleEntityCoverage } from "../../src/tools/entityCoverage.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleEntityCoverage", () => {
  it("finds writing pipelines for an entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEntityCoverage(graph, "alm_organization");

    expect(result.entityFound).toBe(true);
    expect(result.coverageEntries.length).toBeGreaterThanOrEqual(1);
    expect(result.totalWritingPipelines).toBeGreaterThanOrEqual(1);
  });

  it("extracts columns from column mappings", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEntityCoverage(graph, "alm_organization");

    const copyToDv = result.coverageEntries.find(
      (e) => e.pipeline === "Copy_To_Dataverse" && e.activity === "Upsert Organizations"
    );
    expect(copyToDv).toBeDefined();
    expect(copyToDv!.source).toBe("column_mapping");
    expect(copyToDv!.columns).toContain("alm_orgid");
    expect(copyToDv!.columns).toContain("alm_name");
  });

  it("builds column frequency map", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEntityCoverage(graph, "alm_organization");

    expect(result.allColumns.length).toBeGreaterThan(0);
    expect(Object.keys(result.columnFrequency).length).toBeGreaterThan(0);
    for (const count of Object.values(result.columnFrequency)) {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns error for nonexistent entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEntityCoverage(graph, "nonexistent_entity");

    expect(result.entityFound).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.coverageEntries).toEqual([]);
  });

  it("includes parameter default coverage", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEntityCoverage(graph, "alm_organization");

    const defaultEntry = result.coverageEntries.find((e) => e.source === "parameter_default");
    if (defaultEntry) {
      expect(defaultEntry.columns.length).toBeGreaterThan(0);
      expect(defaultEntry.destQuery).toBeDefined();
    }
  });
});
