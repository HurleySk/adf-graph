import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDescribePipeline } from "../../src/tools/describe.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleDescribePipeline", () => {
  it("summary depth: shows child pipelines and root orchestrator", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Test_Orchestrator", "summary");
    expect(result.error).toBeUndefined();
    expect(result.summary.name).toBe("Test_Orchestrator");
    expect(result.summary.childPipelines).toContain("Copy_To_Staging");
    expect(result.summary.childPipelines).toContain("SP_Transform");
    expect(result.summary.childPipelines).toContain("Copy_To_Dataverse");
    // Orchestrator has no incoming executes, so it is its own root
    expect(result.summary.rootOrchestrators).toContain("Test_Orchestrator");
  });

  it("activities depth: includes activity DAG with types and dependsOn", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Test_Orchestrator", "activities");
    expect(result.activities).toBeDefined();
    expect(result.activities!.length).toBeGreaterThan(0);
    const runSP = result.activities!.find((a) => a.name === "Run SP Transform");
    expect(runSP).toBeDefined();
    expect(runSP!.activityType).toBe("ExecutePipeline");
    // Run SP Transform depends on Run Copy To Staging
    expect(runSP!.dependsOn).toContain("Run Copy To Staging");
  });

  it("full depth: adds sources, sinks, and column mappings per activity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Copy_To_Dataverse", "full");
    expect(result.activities).toBeDefined();
    const upsert = result.activities!.find((a) => a.name === "Upsert Organizations");
    expect(upsert).toBeDefined();
    // Has column mappings (org_id → alm_orgid, etc.)
    expect(upsert!.columnMappings).toBeDefined();
    expect(upsert!.columnMappings!.length).toBeGreaterThan(0);
    const firstMap = upsert!.columnMappings![0];
    expect(firstMap.sourceColumn).toBeDefined();
    expect(firstMap.sinkColumn).toBeDefined();
    // Has sinks (dataverse entity)
    expect(upsert!.sinks).toBeDefined();
    expect(upsert!.sinks!.some((s) => s.includes("alm_organization"))).toBe(true);
  });

  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "NonExistentPipeline", "summary");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("NonExistentPipeline");
  });
});
