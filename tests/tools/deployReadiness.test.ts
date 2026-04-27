import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDeployReadiness } from "../../src/tools/deployReadiness.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleDeployReadiness", () => {
  it("returns error when pipeline not found", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "NonExistent");
    expect(result.error).toContain("not found");
    expect(result.ready).toBe(false);
  });

  it("reports child pipelines in dependencies", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const pipelineDeps = result.dependencies.pipelines;
    expect(pipelineDeps.map((d) => d.name)).toContain("Copy_To_Staging");
    expect(pipelineDeps.map((d) => d.name)).toContain("SP_Transform");
    expect(pipelineDeps.map((d) => d.name)).toContain("Copy_To_Dataverse");
  });

  it("reports datasets in dependencies", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const datasets = result.dependencies.datasets;
    expect(datasets.map((d) => d.name)).toContain("ds_sql_source");
  });

  it("reports linked services in dependencies", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const linkedServices = result.dependencies.linkedServices;
    expect(linkedServices.length).toBeGreaterThanOrEqual(1);
  });

  it("reports parameter issues for empty defaults with no supplier", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const emptyDefault = result.parameterIssues.find(
      (i) => i.parameter === "rootbusinessunit" && i.issue === "empty_default"
    );
    expect(emptyDefault).toBeDefined();
  });

  it("does not flag parameters with non-empty defaults", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const uriIssue = result.parameterIssues.find(
      (i) => i.parameter === "dataverse_service_uri"
    );
    expect(uriIssue).toBeUndefined();
  });

  it("reports stored procedures in dependencies", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const sps = result.dependencies.storedProcedures;
    expect(sps.map((d) => d.name)).toContain("dbo.p_Transform_Org");
  });
});
