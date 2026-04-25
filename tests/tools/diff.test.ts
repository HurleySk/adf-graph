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
    // Remove pipeline from graphA by using an empty graph
    const { graph: emptyGraph } = buildGraph(join(import.meta.dirname, "../fixtures/overlay-structured"));
    const result = handleDiffPipeline(emptyGraph, graphB, "Copy_To_Dataverse", "envA", "envB");
    expect(result.error).toContain("only exists in envB");
    expect(result.summary.added).toBe(1);
  });

  it("detects modified activities when SQL differs", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    // Mutate an activity in graphB to simulate a different environment
    const actNode = graphB.getNode("activity:Copy_To_Dataverse/Upsert Organizations");
    expect(actNode).toBeDefined();
    actNode!.metadata.sqlQuery = "SELECT * FROM dbo.Org_Staging WHERE env = 'prod'";
    const result = handleDiffPipeline(graphA, graphB, "Copy_To_Dataverse", "envA", "envB");
    expect(result.error).toBeUndefined();
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.activity).toBe("Upsert Organizations");
    expect(modified!.changes).toBeDefined();
    expect(modified!.changes!.some((c) => c.includes("sqlQuery"))).toBe(true);
    expect(result.summary.modified).toBe(1);
  });

  it("detects modified activities when storedProcedureName differs", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:SP_Transform/Run p_Transform_Org");
    expect(actNode).toBeDefined();
    actNode!.metadata.storedProcedureName = "dbo.p_Transform_Org_V2";
    const result = handleDiffPipeline(graphA, graphB, "SP_Transform", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.changes!.some((c) => c.includes("storedProcedureName"))).toBe(true);
  });

  it("detects modified activities when storedProcedureParameters differs", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:SP_Transform/Run p_Transform_Org");
    expect(actNode).toBeDefined();
    actNode!.metadata.storedProcedureParameters = { batch_id: { type: "Int32", value: "999" } };
    const result = handleDiffPipeline(graphA, graphB, "SP_Transform", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.changes!.some((c) => c.includes("storedProcedureParameters"))).toBe(true);
  });

  it("detects modified activities when pipelineParameters differs", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const actNode = graphB.getNode("activity:Test_Orchestrator/Run Copy To Dataverse");
    expect(actNode).toBeDefined();
    actNode!.metadata.pipelineParameters = { dataverse_query: "<fetch><entity name='changed'/></fetch>" };
    const result = handleDiffPipeline(graphA, graphB, "Test_Orchestrator", "envA", "envB");
    const modified = result.activityDiffs.find((d) => d.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.changes!.some((c) => c.includes("pipelineParameters"))).toBe(true);
  });

  it("detects parameter changes between environments", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const result = handleDiffPipeline(graphA, graphB, "Test_Orchestrator", "envA", "envB");
    expect(result.parameterChanges).toBeUndefined();
  });
});
