import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDeployReadiness } from "../../src/tools/deployReadiness.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

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

  it("includes keyVaultSecrets category in dependencies", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    expect(result.dependencies).toHaveProperty("keyVaultSecrets");
    expect(Array.isArray(result.dependencies.keyVaultSecrets)).toBe(true);
  });

  it("reports stored procedures in dependencies", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    const sps = result.dependencies.storedProcedures;
    expect(sps.map((d) => d.name)).toContain("dbo.p_Transform_Org");
  });

  it("returns empty linkedServiceIssues when no compare_env provided", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    expect(result.linkedServiceIssues).toEqual([]);
  });

  it("flags linked service config differences against compare environment", () => {
    const fixtureEnv2 = join(import.meta.dirname, "../fixtures-env2");
    const graphA = buildGraph(fixtureRoot).graph;
    const graphB = buildGraph(fixtureEnv2).graph;
    const result = handleDeployReadiness(graphA, "Copy_To_Dataverse", graphB, "prod");
    const uriIssue = result.linkedServiceIssues.find(
      (i) => i.linkedService === "ls_dataverse_dev" && i.field === "serviceUri"
    );
    expect(uriIssue).toBeDefined();
    expect(uriIssue!.currentValue).toBe("https://almdatadev.crm.dynamics.com");
    expect(uriIssue!.compareValue).toBe("https://almdataprod.crm.dynamics.com");
    expect(uriIssue!.compareEnv).toBe("prod");
  });
});

describe("deploy readiness with schema", () => {
  it("includes dataverseSchemaValidation section when schemaPath is provided", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDeployReadiness(graph, "Test_Orchestrator", undefined, undefined, schemaPath);
    expect(result.dataverseSchemaValidation).toBeDefined();
    expect(result.dataverseSchemaValidation!.validated).toBe(true);
  });

  it("reports entity matches for entities in the schema", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDeployReadiness(graph, "Copy_To_Dataverse", undefined, undefined, schemaPath);
    expect(result.dataverseSchemaValidation!.entityMatches).toBeGreaterThanOrEqual(1);
  });

  it("omits dataverseSchemaValidation when no schemaPath", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    expect(result.dataverseSchemaValidation).toBeUndefined();
  });
});
