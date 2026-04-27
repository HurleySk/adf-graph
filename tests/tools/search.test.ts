import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleSearchQueries } from "../../src/tools/search.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleSearchQueries", () => {
  it("finds activities whose SQL contains a table name", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "Org_Staging");
    expect(result.query).toBe("Org_Staging");
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    const pipelines = result.matches.map((m) => m.pipeline);
    expect(pipelines).toContain("Copy_To_Dataverse");
  });

  it("finds across multiple pipelines", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "org_id");
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    const pipelines = result.matches.map((m) => m.pipeline);
    expect(pipelines).toContain("Copy_To_Dataverse");
    expect(pipelines).toContain("Copy_To_Staging");
  });

  it("is case-insensitive", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "org_staging");
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty matches for nonexistent text", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "nonexistent_xyz_table");
    expect(result.matches).toEqual([]);
  });

  it("finds activities by stored procedure name", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "p_Transform_Org");
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    const spMatch = result.matches.find((m) => m.field === "storedProcedureName" && m.pipeline === "SP_Transform");
    expect(spMatch).toBeDefined();
  });

  it("finds activities by stored procedure parameter value", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "full_refresh");
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    const spMatch = result.matches.find((m) => m.field === "storedProcedureParameters");
    expect(spMatch).toBeDefined();
    expect(spMatch!.pipeline).toBe("SP_Transform");
  });

  it("finds ExecutePipeline activities by parameter value (FetchXML)", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "alm_organization");
    const execMatch = result.matches.find((m) => m.field === "pipelineParameters");
    expect(execMatch).toBeDefined();
    expect(execMatch!.pipeline).toBe("Test_Orchestrator");
  });

  it("SP name search is case-insensitive", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "p_transform_org");
    const spMatch = result.matches.find((m) => m.field === "storedProcedureName");
    expect(spMatch).toBeDefined();
  });

  it("includes snippet with the full query text", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleSearchQueries(graph, "SELECT org_id");
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(match.snippet).toContain("SELECT org_id");
      expect(["sqlQuery", "pipelineParameters"]).toContain(match.field);
    }
  });
});
