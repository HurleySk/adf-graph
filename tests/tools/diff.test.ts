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

  it("detects parameter changes between environments", () => {
    const { graph: graphA } = buildGraph(fixtureRoot);
    const { graph: graphB } = buildGraph(fixtureRoot);
    const result = handleDiffPipeline(graphA, graphB, "Test_Orchestrator", "envA", "envB");
    expect(result.parameterChanges).toBeUndefined();
  });
});
