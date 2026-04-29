import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { findExecutePipelineActivities } from "../../src/graph/traversalUtils.js";
import { makeNodeId } from "../../src/utils/nodeId.js";
import { NodeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("findExecutePipelineActivities", () => {
  it("returns ExecutePipeline activity nodes for an orchestrator pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Test_Orchestrator");
    const activities = findExecutePipelineActivities(graph, pipelineId);
    expect(activities.length).toBe(4);
    const names = activities.map((a) => a.name);
    expect(names).toContain("Run Copy To Staging");
    expect(names).toContain("Run CDC OnPrem");
    expect(names).toContain("Run SP Transform");
    expect(names).toContain("Run Copy To Dataverse");
  });

  it("returns empty array for a pipeline with no ExecutePipeline activities", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Copy_To_Staging");
    const activities = findExecutePipelineActivities(graph, pipelineId);
    expect(activities).toHaveLength(0);
  });

  it("returns empty array for a non-existent pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "NonExistent");
    const activities = findExecutePipelineActivities(graph, pipelineId);
    expect(activities).toHaveLength(0);
  });
});
