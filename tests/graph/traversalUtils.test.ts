import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import {
  findExecutePipelineActivities,
  collectPipelineActivities,
  collectContainedActivities,
} from "../../src/graph/traversalUtils.js";
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

  it("finds ExecutePipeline activities nested inside a Switch container", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Nested_Dataverse_Copy");
    const names = findExecutePipelineActivities(graph, pipelineId).map((a) => a.name);
    expect(names).toContain("Load Fallback Orgs");
  });
});

describe("collectPipelineActivities", () => {
  it("returns activities nested inside Until, IfCondition and ForEach containers", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Pipeline_With_Containers");
    const names = collectPipelineActivities(graph, pipelineId).map((a) => a.name);

    // containers themselves
    expect(names).toContain("Batch Upsert Loop");
    expect(names).toContain("Check Results");
    expect(names).toContain("Process Each Region");
    // Until children
    expect(names).toContain("Copy Batch");
    expect(names).toContain("Increment Offset");
    // IfCondition children (both branches)
    expect(names).toContain("Run Transform SP");
    expect(names).toContain("Log No Results");
    // ForEach children
    expect(names).toContain("Copy Region Data");
  });

  it("recurses through Switch cases and defaultActivities at arbitrary depth", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Nested_Dataverse_Copy");
    const names = collectPipelineActivities(graph, pipelineId).map((a) => a.name);

    expect(names).toContain("Route By Region");
    // cases[0] -> ForEach -> Until -> Copy (three levels below the Switch)
    expect(names).toContain("For Each East Batch");
    expect(names).toContain("Batch Upsert Orgs");
    expect(names).toContain("Upsert Org Batch");
    expect(names).toContain("Advance Offset");
    // cases[1]
    expect(names).toContain("Truncate West Staging");
    // defaultActivities
    expect(names).toContain("Load Fallback Orgs");
  });

  it("returns an empty array for a pipeline with no activities at all", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "NonExistent");
    expect(collectPipelineActivities(graph, pipelineId)).toHaveLength(0);
  });
});

describe("collectContainedActivities", () => {
  it("reports the containing activity and nesting depth", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Nested_Dataverse_Copy");
    const contained = collectContainedActivities(graph, pipelineId);

    const routeBy = contained.find((c) => c.node.name === "Route By Region");
    expect(routeBy?.parent).toBeUndefined();
    expect(routeBy?.depth).toBe(0);

    const forEach = contained.find((c) => c.node.name === "For Each East Batch");
    expect(forEach?.parent?.name).toBe("Route By Region");
    expect(forEach?.depth).toBe(1);

    const copy = contained.find((c) => c.node.name === "Upsert Org Batch");
    expect(copy?.parent?.name).toBe("Batch Upsert Orgs");
    expect(copy?.depth).toBe(3);
  });

  it("visits each activity exactly once", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelineId = makeNodeId(NodeType.Pipeline, "Nested_Dataverse_Copy");
    const ids = collectContainedActivities(graph, pipelineId).map((c) => c.node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
