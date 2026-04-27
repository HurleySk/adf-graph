import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePipelineFile, extractTablesFromSql } from "../../src/parsers/pipeline.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/pipeline");

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

  it("stores sqlReaderQuery in activity node metadata", () => {
    const result = parsePipelineFile(loadFixture("copy-to-dataverse.json"));
    const activity = result.nodes.find((n) => n.id === "activity:Copy_To_Dataverse/Upsert Organizations");
    expect(activity).toBeDefined();
    expect(activity!.metadata.sqlQuery).toBeDefined();
    expect(activity!.metadata.sqlQuery).toContain("SELECT org_id");
    expect(activity!.metadata.sqlQuery).toContain("dbo.Org_Staging");
  });

  it("stores storedProcedureName in activity metadata (sp-transform)", () => {
    const result = parsePipelineFile(loadFixture("sp-transform.json"));
    const activity = result.nodes.find((n) => n.id === "activity:SP_Transform/Run p_Transform_Org");
    expect(activity).toBeDefined();
    expect(activity!.metadata.storedProcedureName).toBe("dbo.p_Transform_Org");
  });

  it("stores storedProcedureParameters in activity metadata (sp-transform)", () => {
    const result = parsePipelineFile(loadFixture("sp-transform.json"));
    const activity = result.nodes.find((n) => n.id === "activity:SP_Transform/Run p_Transform_Org");
    expect(activity).toBeDefined();
    const params = activity!.metadata.storedProcedureParameters as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params).toHaveProperty("batch_id");
    expect(params).toHaveProperty("run_mode");
  });

  it("stores pipelineParameters in activity metadata (orchestrator ExecutePipeline)", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const activity = result.nodes.find((n) => n.id === "activity:Test_Orchestrator/Run Copy To Dataverse");
    expect(activity).toBeDefined();
    const params = activity!.metadata.pipelineParameters as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params).toHaveProperty("dataverse_query");
    expect(params.dataverse_query).toContain("<fetch>");
  });

  it("omits pipelineParameters when none specified (orchestrator ExecutePipeline)", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const activity = result.nodes.find((n) => n.id === "activity:Test_Orchestrator/Run Copy To Staging");
    expect(activity).toBeDefined();
    expect(activity!.metadata.pipelineParameters).toBeUndefined();
  });

  it("extracts table from output dataset params (copy-to-staging writes table:dbo.Org_Staging)", () => {
    const result = parsePipelineFile(loadFixture("copy-to-staging.json"));
    const writesTo = result.edges.filter(
      (e) => e.type === "writes_to" && e.to.startsWith("table:")
    );
    expect(writesTo.map((e) => e.to)).toContain("table:dbo.Org_Staging");
  });

  it("extracts parameter definitions with type and defaultValue", () => {
    const result = parsePipelineFile(loadFixture("orchestrator.json"));
    const pipeline = result.nodes.find((n) => n.id === "pipeline:Test_Orchestrator");
    expect(pipeline).toBeDefined();
    const params = pipeline!.metadata.parameters as Array<{ name: string; type: string; defaultValue: unknown }>;
    expect(params).toBeInstanceOf(Array);
    const rootbu = params.find((p) => p.name === "rootbusinessunit");
    expect(rootbu).toBeDefined();
    expect(rootbu!.type).toBe("String");
    expect(rootbu!.defaultValue).toBe("");
    const uri = params.find((p) => p.name === "dataverse_service_uri");
    expect(uri).toBeDefined();
    expect(uri!.defaultValue).toBe("https://org.crm.dynamics.com");
  });

  it("extracts inner activities from Until containers with nested IDs", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const innerCopy = result.nodes.find(
      (n) => n.id === "activity:Pipeline_With_Containers/Batch Upsert Loop/Copy Batch",
    );
    expect(innerCopy).toBeDefined();
    expect(innerCopy!.metadata.activityType).toBe("Copy");
    expect(innerCopy!.metadata.sqlQuery).toContain("dbo.Org_Staging");
  });

  it("creates Contains edges from container to inner activities", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const containerContains = result.edges.filter(
      (e) =>
        e.type === "contains" &&
        e.from === "activity:Pipeline_With_Containers/Batch Upsert Loop",
    );
    expect(containerContains.length).toBe(2);
    expect(containerContains.map((e) => e.to)).toContain(
      "activity:Pipeline_With_Containers/Batch Upsert Loop/Copy Batch",
    );
    expect(containerContains.map((e) => e.to)).toContain(
      "activity:Pipeline_With_Containers/Batch Upsert Loop/Increment Offset",
    );
  });

  it("extracts inner activities from IfCondition true and false branches", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const trueBranch = result.nodes.find(
      (n) => n.id === "activity:Pipeline_With_Containers/Check Results/Run Transform SP",
    );
    const falseBranch = result.nodes.find(
      (n) => n.id === "activity:Pipeline_With_Containers/Check Results/Log No Results",
    );
    expect(trueBranch).toBeDefined();
    expect(trueBranch!.metadata.activityType).toBe("SqlServerStoredProcedure");
    expect(falseBranch).toBeDefined();
    expect(falseBranch!.metadata.activityType).toBe("Copy");
  });

  it("extracts inner activities from ForEach containers", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const innerCopy = result.nodes.find(
      (n) => n.id === "activity:Pipeline_With_Containers/Process Each Region/Copy Region Data",
    );
    expect(innerCopy).toBeDefined();
    expect(innerCopy!.metadata.sqlQuery).toContain("dbo.RegionData");
  });

  it("resolves DependsOn within container scope", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const depEdges = result.edges.filter(
      (e) =>
        e.type === "depends_on" &&
        e.from === "activity:Pipeline_With_Containers/Batch Upsert Loop/Increment Offset",
    );
    expect(depEdges).toHaveLength(1);
    expect(depEdges[0].to).toBe(
      "activity:Pipeline_With_Containers/Batch Upsert Loop/Copy Batch",
    );
  });

  it("extracts dataset edges from inner Copy activities", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const innerCopyId = "activity:Pipeline_With_Containers/Batch Upsert Loop/Copy Batch";
    const datasetEdges = result.edges.filter(
      (e) => e.type === "uses_dataset" && e.from === innerCopyId,
    );
    expect(datasetEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts SP call edges from inner SP activities", () => {
    const result = parsePipelineFile(loadFixture("container-activities.json"));
    const innerSpId = "activity:Pipeline_With_Containers/Check Results/Run Transform SP";
    const spEdges = result.edges.filter(
      (e) => e.type === "calls_sp" && e.from === innerSpId,
    );
    expect(spEdges).toHaveLength(1);
    expect(spEdges[0].to).toBe("stored_procedure:dbo.p_Transform_Org");
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
