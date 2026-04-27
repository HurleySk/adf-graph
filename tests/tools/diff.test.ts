import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDiffPipeline } from "../../src/tools/diff.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleDiffPipeline", () => {
  it("reports all activities unchanged when comparing identical graphs", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const result = handleDiffPipeline(graphA, graphB, "Copy_To_Dataverse", "envA", "envB");
    expect(result.error).toBeUndefined();
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.unchanged).toBe(1);
    expect(result.activityDiffs[0].status).toBe("unchanged");
  });

  it("reports error when pipeline missing from both environments", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const result = handleDiffPipeline(graphA, graphB, "NonExistent", "envA", "envB");
    expect(result.error).toContain("not found in either environment");
  });

  it("reports all activities added when pipeline only in envB", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const { graph: emptyGraph } = buildGraph(join(import.meta.dirname, "../fixtures/overlay-structured"));
    const result = handleDiffPipeline(emptyGraph, graphB, "Copy_To_Dataverse", "envA", "envB");
    expect(result.error).toContain("only exists in envB");
    expect(result.summary.added).toBe(1);
  });

  it("returns structured FieldChange with lineDiff for SQL changes", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:Copy_To_Dataverse/Upsert Organizations");
    expect(actNode).toBeDefined();
    actNode!.metadata.sqlQuery = "SELECT org_id, org_name\nFROM dbo.Org_Staging\nWHERE env = 'prod'";
    const result = handleDiffPipeline(graphA, graphB, "Copy_To_Dataverse", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.details).toBeDefined();
    const sqlChange = modified!.details!.find((d) => d.field === "sqlQuery");
    expect(sqlChange).toBeDefined();
    expect(sqlChange!.before).toBeDefined();
    expect(sqlChange!.after).toContain("org_name");
    expect(sqlChange!.lineDiff).toBeDefined();
    expect(sqlChange!.lineDiff!.some((l) => l.startsWith("+"))).toBe(true);
  });

  it("detects storedProcedureName change with before/after", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:SP_Transform/Run p_Transform_Org");
    expect(actNode).toBeDefined();
    actNode!.metadata.storedProcedureName = "dbo.p_Transform_Org_V2";
    const result = handleDiffPipeline(graphA, graphB, "SP_Transform", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    const spChange = modified!.details!.find((d) => d.field === "storedProcedureName");
    expect(spChange).toBeDefined();
    expect(spChange!.before).toBe("dbo.p_Transform_Org");
    expect(spChange!.after).toBe("dbo.p_Transform_Org_V2");
  });

  it("detects storedProcedureParameters change", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:SP_Transform/Run p_Transform_Org");
    expect(actNode).toBeDefined();
    actNode!.metadata.storedProcedureParameters = { batch_id: { type: "Int32", value: "999" } };
    const result = handleDiffPipeline(graphA, graphB, "SP_Transform", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.details!.find((d) => d.field === "storedProcedureParameters")).toBeDefined();
  });

  it("detects pipelineParameters change", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:Test_Orchestrator/Run Copy To Dataverse");
    expect(actNode).toBeDefined();
    actNode!.metadata.pipelineParameters = { dataverse_query: "<fetch><entity name='changed'/></fetch>" };
    const result = handleDiffPipeline(graphA, graphB, "Test_Orchestrator", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.details!.find((d) => d.field === "pipelineParameters")).toBeDefined();
  });

  it("detects parameter definition changes between environments", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const pNode = graphB.getNode("pipeline:Test_Orchestrator");
    expect(pNode).toBeDefined();
    pNode!.metadata.parameters = [
      { name: "rootbusinessunit", type: "String", defaultValue: "changed" },
      { name: "dataverse_service_uri", type: "String", defaultValue: "https://org.crm.dynamics.com" },
      { name: "new_param", type: "Int", defaultValue: 0 },
    ];
    const result = handleDiffPipeline(graphA, graphB, "Test_Orchestrator", "envA", "envB");
    expect(result.parameterChanges).toBeDefined();
    expect(result.parameterChanges!.added).toContain("new_param");
    expect(result.parameterChanges!.modified.find((m) => m.name === "rootbusinessunit")).toBeDefined();
  });
});
