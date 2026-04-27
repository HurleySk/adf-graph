import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleFindOrchestrators } from "../../src/tools/findOrchestrators.js";
import { NodeType, EdgeType } from "../../src/graph/model.js";
import { makeNodeId } from "../../src/utils/nodeId.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleFindOrchestrators", () => {
  it("returns error when pipeline not found", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindOrchestrators(graph, "NonExistent");
    expect(result.error).toContain("not found");
    expect(result.isRoot).toBe(false);
    expect(result.ancestors).toEqual([]);
  });

  it("returns isRoot true for a root orchestrator pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindOrchestrators(graph, "Test_Orchestrator");
    expect(result.isRoot).toBe(true);
    expect(result.ancestors).toEqual([
      { root: "Test_Orchestrator", chain: ["Test_Orchestrator"], depth: 0 },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("returns the correct root orchestrator for a child pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindOrchestrators(graph, "Copy_To_Staging");
    expect(result.isRoot).toBe(false);
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0]).toEqual({
      root: "Test_Orchestrator",
      chain: ["Test_Orchestrator", "Copy_To_Staging"],
      depth: 1,
    });
    expect(result.error).toBeUndefined();
  });

  it("returns ancestry for all child pipelines executed by the orchestrator", () => {
    const { graph } = buildGraph(fixtureRoot);

    const staging = handleFindOrchestrators(graph, "Copy_To_Staging");
    expect(staging.ancestors[0].root).toBe("Test_Orchestrator");
    expect(staging.ancestors[0].depth).toBe(1);

    const transform = handleFindOrchestrators(graph, "SP_Transform");
    expect(transform.ancestors[0].root).toBe("Test_Orchestrator");
    expect(transform.ancestors[0].depth).toBe(1);

    const dataverse = handleFindOrchestrators(graph, "Copy_To_Dataverse");
    expect(dataverse.ancestors[0].root).toBe("Test_Orchestrator");
    expect(dataverse.ancestors[0].depth).toBe(1);
  });

  it("reports pipeline name in result", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindOrchestrators(graph, "Copy_To_Staging");
    expect(result.pipeline).toBe("Copy_To_Staging");
  });

  it("handles multi-level ancestry chains", () => {
    const { graph } = buildGraph(fixtureRoot);

    // Add a grandparent pipeline that executes Test_Orchestrator
    const grandparentId = makeNodeId(NodeType.Pipeline, "Grand_Orchestrator");
    graph.addNode({
      id: grandparentId,
      type: NodeType.Pipeline,
      name: "Grand_Orchestrator",
      metadata: {},
    });
    graph.addEdge({
      from: grandparentId,
      to: makeNodeId(NodeType.Pipeline, "Test_Orchestrator"),
      type: EdgeType.Executes,
      metadata: {},
    });

    const result = handleFindOrchestrators(graph, "Copy_To_Staging");
    expect(result.isRoot).toBe(false);
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0]).toEqual({
      root: "Grand_Orchestrator",
      chain: ["Grand_Orchestrator", "Test_Orchestrator", "Copy_To_Staging"],
      depth: 2,
    });
  });

  it("handles multiple roots (diamond ancestry)", () => {
    const { graph } = buildGraph(fixtureRoot);

    // Add a second orchestrator that also executes Copy_To_Staging
    const secondOrchId = makeNodeId(NodeType.Pipeline, "Second_Orchestrator");
    graph.addNode({
      id: secondOrchId,
      type: NodeType.Pipeline,
      name: "Second_Orchestrator",
      metadata: {},
    });
    graph.addEdge({
      from: secondOrchId,
      to: makeNodeId(NodeType.Pipeline, "Copy_To_Staging"),
      type: EdgeType.Executes,
      metadata: {},
    });

    const result = handleFindOrchestrators(graph, "Copy_To_Staging");
    expect(result.isRoot).toBe(false);
    expect(result.ancestors).toHaveLength(2);

    const roots = result.ancestors.map((a) => a.root).sort();
    expect(roots).toEqual(["Second_Orchestrator", "Test_Orchestrator"]);
  });
});
