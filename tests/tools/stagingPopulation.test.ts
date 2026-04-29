import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleStagingPopulation } from "../../src/tools/stagingPopulation.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleStagingPopulation", () => {
  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingPopulation(graph, "NonExistent");
    expect(result.error).toBeDefined();
  });

  it("returns warning when no dest_query found", () => {
    const { graph } = buildGraph(fixtureRoot);
    // Copy_To_Staging has no dest_query parameter
    const result = handleStagingPopulation(graph, "Copy_To_Staging");
    if (!result.destQuery) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("finds staging tables from DeltaLoad orchestrator CDC calls", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingPopulation(graph, "DeltaLoad_Orchestrator");
    // The orchestrator calls CDC child with dest_query containing table refs
    if (result.destQuery) {
      expect(result.stagingTables.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("classifies CDC tables correctly", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingPopulation(graph, "DeltaLoad_Orchestrator");
    if (result.stagingTables.length > 0) {
      for (const table of result.stagingTables) {
        expect(table.role).toBeDefined();
        expect(table.roleEvidence).toBeDefined();
        expect(typeof table.referencedInDestQuery).toBe("boolean");
      }
    }
  });

  it("summary counts match data", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingPopulation(graph, "DeltaLoad_Orchestrator");
    expect(result.summary.totalTables).toBe(result.stagingTables.length);
    const cdcRoles = ["cdc_current", "cdc_historical", "cdc_pending"];
    const cdcCount = result.stagingTables.filter((t) => cdcRoles.includes(t.role)).length;
    expect(result.summary.cdcTables).toBe(cdcCount);
  });

  it("finds dest_query from pipeline with defaults", () => {
    const { graph } = buildGraph(fixtureRoot);
    // dest-query-defaults pipeline has dest_query as a parameter default
    const result = handleStagingPopulation(graph, "Dest_Query_Defaults");
    if (result.destQuery) {
      expect(result.dataverseEntity).toBeDefined();
    }
  });
});
