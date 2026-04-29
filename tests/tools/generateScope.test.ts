import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleGenerateScope } from "../../src/tools/generateScope.js";
import { NodeType, EdgeType } from "../../src/graph/model.js";
import { makeNodeId } from "../../src/utils/nodeId.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleGenerateScope", () => {
  it("returns all pipelines reachable from a single root", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleGenerateScope(graph, { roots: ["Test_Orchestrator"] });

    expect(result.roots).toEqual(["Test_Orchestrator"]);
    expect(Object.keys(result.pipelines)).toContain("Test_Orchestrator");
    expect(Object.keys(result.pipelines)).toContain("Copy_To_Staging");
    expect(Object.keys(result.pipelines)).toContain("SP_Transform");
    expect(Object.keys(result.pipelines)).toContain("Copy_To_Dataverse");
  });

  it("collects stored procedures from reachable pipelines", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleGenerateScope(graph, { roots: ["Test_Orchestrator"] });

    // SP_Transform calls p_Transform_Org
    expect(result.storedProcedures.length).toBeGreaterThan(0);
    expect(result.storedProcedures.some((sp) => sp.includes("p_Transform_Org"))).toBe(true);
  });

  it("collects datasets from reachable pipelines", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleGenerateScope(graph, { roots: ["Test_Orchestrator"] });

    // Copy_To_Staging uses ds_sql_staging and ds_sql_source
    expect(result.datasets.length).toBeGreaterThan(0);
    expect(result.datasets.some((ds) => ds.includes("ds_sql_staging"))).toBe(true);
  });

  it("detects orphan pipelines in a folder", () => {
    const { graph } = buildGraph(fixtureRoot);

    // Add an orphan pipeline with folder metadata
    const orphanId = makeNodeId(NodeType.Pipeline, "Orphan_Pipeline");
    graph.addNode({
      id: orphanId,
      type: NodeType.Pipeline,
      name: "Orphan_Pipeline",
      metadata: { folder: "TestFolder" },
    });

    // Also add a reachable pipeline in the same folder
    const reachableInFolderId = makeNodeId(NodeType.Pipeline, "Reachable_In_Folder");
    graph.addNode({
      id: reachableInFolderId,
      type: NodeType.Pipeline,
      name: "Reachable_In_Folder",
      metadata: { folder: "TestFolder" },
    });
    // Connect Reachable_In_Folder as a child of Test_Orchestrator
    graph.addEdge({
      from: makeNodeId(NodeType.Pipeline, "Test_Orchestrator"),
      to: reachableInFolderId,
      type: EdgeType.Executes,
      metadata: {},
    });

    const result = handleGenerateScope(graph, {
      roots: ["Test_Orchestrator"],
      folder: "TestFolder",
    });

    expect(result.orphans).toBeDefined();
    expect(result.orphans!.folderName).toBe("TestFolder");
    expect(result.orphans!.pipelines).toContain("Orphan_Pipeline");
    expect(result.orphans!.pipelines).not.toContain("Reachable_In_Folder");
  });

  it("does NOT flag reachable pipelines as orphans", () => {
    const { graph } = buildGraph(fixtureRoot);

    // Put Test_Orchestrator itself in the folder
    const orchId = makeNodeId(NodeType.Pipeline, "Test_Orchestrator");
    const orchNode = graph.getNode(orchId)!;
    graph.replaceNode({ ...orchNode, metadata: { ...orchNode.metadata, folder: "W3" } });

    // Put Copy_To_Staging in the folder too
    const stagingId = makeNodeId(NodeType.Pipeline, "Copy_To_Staging");
    const stagingNode = graph.getNode(stagingId)!;
    graph.replaceNode({ ...stagingNode, metadata: { ...stagingNode.metadata, folder: "W3" } });

    const result = handleGenerateScope(graph, {
      roots: ["Test_Orchestrator"],
      folder: "W3",
    });

    expect(result.orphans).toBeDefined();
    // Test_Orchestrator and Copy_To_Staging are both reachable — neither is an orphan
    expect(result.orphans!.pipelines).not.toContain("Test_Orchestrator");
    expect(result.orphans!.pipelines).not.toContain("Copy_To_Staging");
  });

  it("tracks which roots each pipeline belongs to", () => {
    const { graph } = buildGraph(fixtureRoot);

    // Add a second root that also executes Copy_To_Staging
    const secondRootId = makeNodeId(NodeType.Pipeline, "Second_Root");
    graph.addNode({
      id: secondRootId,
      type: NodeType.Pipeline,
      name: "Second_Root",
      metadata: {},
    });
    graph.addEdge({
      from: secondRootId,
      to: makeNodeId(NodeType.Pipeline, "Copy_To_Staging"),
      type: EdgeType.Executes,
      metadata: {},
    });

    const result = handleGenerateScope(graph, {
      roots: ["Test_Orchestrator", "Second_Root"],
    });

    // Copy_To_Staging should list both roots
    const stagingInfo = result.pipelines["Copy_To_Staging"];
    expect(stagingInfo).toBeDefined();
    expect(stagingInfo.roots).toContain("Test_Orchestrator");
    expect(stagingInfo.roots).toContain("Second_Root");

    // SP_Transform is only reachable from Test_Orchestrator
    const spInfo = result.pipelines["SP_Transform"];
    expect(spInfo).toBeDefined();
    expect(spInfo.roots).toContain("Test_Orchestrator");
    expect(spInfo.roots).not.toContain("Second_Root");
  });

  it("returns empty scope for unknown root", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleGenerateScope(graph, { roots: ["NonExistent_Root"] });

    expect(Object.keys(result.pipelines)).toHaveLength(0);
    expect(result.storedProcedures).toHaveLength(0);
    expect(result.datasets).toHaveLength(0);
    expect(result.tables).toHaveLength(0);
  });

  it("includes a generatedAt timestamp", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleGenerateScope(graph, { roots: ["Test_Orchestrator"] });
    expect(result.generatedAt).toBeDefined();
    expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
  });

  it("omits orphans field when no folder is specified", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleGenerateScope(graph, { roots: ["Test_Orchestrator"] });
    expect(result.orphans).toBeUndefined();
  });
});
