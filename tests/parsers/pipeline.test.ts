import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePipelineFile, extractTablesFromSql } from "../../src/parsers/pipeline.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/pipelines");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf-8"));
}

describe("parsePipelineFile", () => {
  it("extracts pipeline node with correct id", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const pipeline = result.nodes.find((n) => n.id === "pipeline:Test_Orchestrator");
    expect(pipeline).toBeDefined();
    expect(pipeline!.name).toBe("Test_Orchestrator");
  });

  it("extracts activity nodes (3 from orchestrator)", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const activities = result.nodes.filter((n) => n.type === "activity");
    expect(activities).toHaveLength(3);
    expect(activities.map((a) => a.id)).toContain(
      "activity:Test_Orchestrator/Run Copy To Staging"
    );
  });

  it("extracts ExecutePipeline edges (3 from orchestrator)", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const executes = result.edges.filter((e) => e.type === "executes");
    expect(executes).toHaveLength(3);
    expect(executes.map((e) => e.to)).toContain("pipeline:Copy_To_Staging");
    expect(executes.map((e) => e.to)).toContain("pipeline:SP_Transform");
    expect(executes.map((e) => e.to)).toContain("pipeline:Copy_To_Dataverse");
  });

  it("extracts dependsOn edges (2 from orchestrator)", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const dependsOn = result.edges.filter((e) => e.type === "depends_on");
    expect(dependsOn).toHaveLength(2);
  });

  it("extracts dataset references from Copy (2+ from copy-to-staging)", () => {
    const result = parsePipelineFile(loadFixture("copy-to-staging.json"));
    const datasetEdges = result.edges.filter((e) => e.type === "uses_dataset");
    expect(datasetEdges.length).toBeGreaterThanOrEqual(2);
    const targets = datasetEdges.map((e) => e.to);
    expect(targets).toContain("dataset:ds_sql_source");
    expect(targets).toContain("dataset:ds_sql_staging");
  });

  it("extracts SP call edges (1 from sp-transform)", () => {
    const result = parsePipelineFile(loadFixture("sp-transform.json"));
    const spEdges = result.edges.filter((e) => e.type === "calls_sp");
    expect(spEdges).toHaveLength(1);
    expect(spEdges[0].to).toBe("stored_procedure:dbo.p_Transform_Org");
  });

  it("extracts DV entity from output params (copy-to-dataverse)", () => {
    const result = parsePipelineFile(loadFixture("copy-to-dataverse.json"));
    const writesTo = result.edges.filter(
      (e) => e.type === "writes_to" && e.to.startsWith("dataverse_entity:")
    );
    expect(writesTo).toHaveLength(1);
    expect(writesTo[0].to).toBe("dataverse_entity:alm_organization");
  });

  it("extracts table from embedded SQL (copy-to-dataverse reads table:dbo.Org_Staging)", () => {
    const result = parsePipelineFile(loadFixture("copy-to-dataverse.json"));
    const readsFrom = result.edges.filter(
      (e) => e.type === "reads_from" && e.to.startsWith("table:")
    );
    expect(readsFrom.map((e) => e.to)).toContain("table:dbo.Org_Staging");
  });

  it("extracts table from output dataset params (copy-to-staging writes table:dbo.Org_Staging)", () => {
    const result = parsePipelineFile(loadFixture("copy-to-staging.json"));
    const writesTo = result.edges.filter(
      (e) => e.type === "writes_to" && e.to.startsWith("table:")
    );
    expect(writesTo.map((e) => e.to)).toContain("table:dbo.Org_Staging");
  });
});

describe("extractTablesFromSql", () => {
  it("extracts tables from FROM and JOIN clauses", () => {
    const sql = "SELECT * FROM [dbo].[Org_Staging] JOIN [dbo].[LegacyOrg] ON 1=1";
    const tables = extractTablesFromSql(sql);
    expect(tables).toContain("dbo.Org_Staging");
    expect(tables).toContain("dbo.LegacyOrg");
  });
});
