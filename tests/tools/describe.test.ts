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
    // All 3 column mappings returned (not just the first)
    expect(upsert!.columnMappings).toBeDefined();
    expect(upsert!.columnMappings!.length).toBe(3);
    const sinkCols = upsert!.columnMappings!.map((m) => m.sinkColumn);
    expect(sinkCols).toContain("alm_orgid");
    expect(sinkCols).toContain("alm_name");
    expect(sinkCols).toContain("alm_orgtypecode");
    // Has sinks (dataverse entity)
    expect(upsert!.sinks).toBeDefined();
    expect(upsert!.sinks!.some((s) => s.includes("alm_organization"))).toBe(true);
  });

  it("full depth: exposes sqlQuery on Copy activities", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Copy_To_Dataverse", "full");
    const upsert = result.activities!.find((a) => a.name === "Upsert Organizations");
    expect(upsert).toBeDefined();
    expect(upsert!.sqlQuery).toBeDefined();
    expect(upsert!.sqlQuery).toContain("SELECT org_id");
    expect(upsert!.sqlQuery).toContain("dbo.Org_Staging");
  });

  it("full depth: exposes storedProcedureName on SP activities", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "SP_Transform", "full");
    expect(result.activities).toBeDefined();
    const sp = result.activities!.find((a) => a.name === "Run p_Transform_Org");
    expect(sp).toBeDefined();
    expect(sp!.storedProcedureName).toBe("dbo.p_Transform_Org");
  });

  it("full depth: exposes storedProcedureParameters on SP activities", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "SP_Transform", "full");
    const sp = result.activities!.find((a) => a.name === "Run p_Transform_Org");
    expect(sp).toBeDefined();
    expect(sp!.storedProcedureParameters).toBeDefined();
    expect(sp!.storedProcedureParameters).toHaveProperty("batch_id");
    expect(sp!.storedProcedureParameters).toHaveProperty("run_mode");
  });

  it("full depth: exposes pipelineParameters on ExecutePipeline activities", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Test_Orchestrator", "full");
    const runCopy = result.activities!.find((a) => a.name === "Run Copy To Dataverse");
    expect(runCopy).toBeDefined();
    expect(runCopy!.pipelineParameters).toBeDefined();
    expect(runCopy!.pipelineParameters!.dataverse_query).toContain("<fetch>");
  });

  it("full depth: shows inner activities from Until containers with parentActivity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Pipeline_With_Containers", "full");
    expect(result.activities).toBeDefined();
    const innerCopy = result.activities!.find((a) => a.name === "Copy Batch");
    expect(innerCopy).toBeDefined();
    expect(innerCopy!.parentActivity).toBe("Batch Upsert Loop");
    expect(innerCopy!.sqlQuery).toContain("dbo.Org_Staging");
    expect(innerCopy!.columnMappings).toBeDefined();
    expect(innerCopy!.columnMappings!.length).toBe(2);
  });

  it("full depth: shows inner activities from IfCondition branches", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Pipeline_With_Containers", "full");
    const sp = result.activities!.find((a) => a.name === "Run Transform SP");
    expect(sp).toBeDefined();
    expect(sp!.parentActivity).toBe("Check Results");
    expect(sp!.storedProcedureName).toBe("dbo.p_Transform_Org");

    const falseCopy = result.activities!.find((a) => a.name === "Log No Results");
    expect(falseCopy).toBeDefined();
    expect(falseCopy!.parentActivity).toBe("Check Results");
  });

  it("full depth: shows inner activities from ForEach containers", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Pipeline_With_Containers", "full");
    const regionCopy = result.activities!.find((a) => a.name === "Copy Region Data");
    expect(regionCopy).toBeDefined();
    expect(regionCopy!.parentActivity).toBe("Process Each Region");
    expect(regionCopy!.sqlQuery).toContain("dbo.RegionData");
  });

  it("activity filter: returns only the named activity with full detail", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Copy_To_Dataverse", "summary", "Upsert Organizations");
    expect(result.activities).toBeDefined();
    expect(result.activities).toHaveLength(1);
    expect(result.activities![0].name).toBe("Upsert Organizations");
    expect(result.activities![0].sources).toBeDefined();
    expect(result.activities![0].columnMappings).toBeDefined();
  });

  it("activity filter: returns inner activity by name", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Pipeline_With_Containers", "summary", "Copy Batch");
    expect(result.activities).toBeDefined();
    expect(result.activities).toHaveLength(1);
    expect(result.activities![0].name).toBe("Copy Batch");
    expect(result.activities![0].parentActivity).toBe("Batch Upsert Loop");
    expect(result.activities![0].sqlQuery).toContain("dbo.Org_Staging");
  });

  it("activity filter: returns error for unknown activity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Copy_To_Dataverse", "summary", "NonExistentActivity");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("NonExistentActivity");
  });

  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "NonExistentPipeline", "summary");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("NonExistentPipeline");
  });

  it("full depth: includes sourceConnections and sinkConnections with linked service info", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Copy_To_Dataverse", "full");
    const upsert = result.activities!.find((a) => a.name === "Upsert Organizations");
    expect(upsert).toBeDefined();

    expect(upsert!.sinkConnections).toBeDefined();
    expect(upsert!.sinkConnections!.length).toBeGreaterThanOrEqual(1);
    const sinkConn = upsert!.sinkConnections![0];
    expect(sinkConn.linkedServiceName).toBe("ls_dataverse_dev");
    expect(sinkConn.connectionProperties.serviceUri).toBe("https://almdatadev.crm.dynamics.com");
  });

  it("full depth: correctly separates input datasets as sources and output datasets as sinks", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDescribePipeline(graph, "Copy_Cross_Org", "full");
    const copy = result.activities!.find((a) => a.name === "Copy Between Orgs");
    expect(copy).toBeDefined();

    expect(copy!.sources).toBeDefined();
    expect(copy!.sources!.some((s) => s.includes("ds_dataverse"))).toBe(true);

    expect(copy!.sinks).toBeDefined();
    expect(copy!.sinks!.some((s) => s.includes("ds_dataverse_alt"))).toBe(true);
  });
});
