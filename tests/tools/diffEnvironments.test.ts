import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleDiffEnvironments } from "../../src/tools/diffEnvironments.js";
import { NodeType, EdgeType, Graph } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayRoot = join(import.meta.dirname, "../fixtures/overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleDiffEnvironments", () => {
  it("reports all items unchanged when comparing same environment to itself", () => {
    const mgr = new GraphManager(makeConfig({
      envA: { path: fixtureRoot },
      envB: { path: fixtureRoot },
    }));
    const result = handleDiffEnvironments(mgr, "envA", "envB", "pipelines");
    expect(result.error).toBeUndefined();
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.unchanged).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.status).toBe("unchanged");
    }
  });

  it("reports added pipelines when envB has more pipelines", () => {
    // overlay-structured has OverlayPipeline which is not in the main fixture
    const mgr = new GraphManager(makeConfig({
      envA: { path: overlayRoot },
      envB: { path: fixtureRoot },
    }));
    const result = handleDiffEnvironments(mgr, "envA", "envB", "pipelines");
    expect(result.error).toBeUndefined();
    // envA (overlay) has OverlayPipeline; envB (fixture) has Copy_To_Dataverse, Copy_To_Staging, etc.
    // Items only in envB = added, items only in envA = removed
    expect(result.summary.added).toBeGreaterThan(0);
    const addedItems = result.items.filter((i) => i.status === "added");
    expect(addedItems.length).toBeGreaterThan(0);
  });

  it("reports removed pipelines when envA has pipelines not in envB", () => {
    const mgr = new GraphManager(makeConfig({
      envA: { path: fixtureRoot },
      envB: { path: overlayRoot },
    }));
    const result = handleDiffEnvironments(mgr, "envA", "envB", "pipelines");
    expect(result.error).toBeUndefined();
    // envA (fixture) has many pipelines; envB (overlay) has only OverlayPipeline
    const removedItems = result.items.filter((i) => i.status === "removed");
    expect(removedItems.length).toBeGreaterThan(0);
    expect(result.summary.removed).toBeGreaterThan(0);
  });

  it("detects modified pipelines when activities differ", () => {
    const mgr = new GraphManager(makeConfig({
      envA: { path: fixtureRoot },
      envB: { path: fixtureRoot },
    }));
    // Build both graphs
    const buildB = mgr.ensureGraph("envB");
    // Mutate envB: add an extra activity to a pipeline
    const pipelineNode = buildB.graph.getNodesByType(NodeType.Pipeline)[0];
    const fakeActivity = {
      id: `activity:${pipelineNode.name}/FakeActivity`,
      type: NodeType.Activity,
      name: "FakeActivity",
      metadata: {} as Record<string, unknown>,
    };
    buildB.graph.addNode(fakeActivity);
    buildB.graph.addEdge({
      from: pipelineNode.id,
      to: fakeActivity.id,
      type: EdgeType.Contains,
      metadata: {},
    });

    const result = handleDiffEnvironments(mgr, "envA", "envB", "pipelines");
    expect(result.error).toBeUndefined();
    const modifiedItems = result.items.filter((i) => i.status === "modified");
    expect(modifiedItems.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.modified).toBeGreaterThanOrEqual(1);
    // The modified item should have changes describing the activity difference
    const modItem = modifiedItems.find((i) => i.name === pipelineNode.name);
    expect(modItem).toBeDefined();
    expect(modItem!.changes).toBeDefined();
    expect(modItem!.changes!.some((c) => c.includes("activity"))).toBe(true);
  });

  it("returns error when envA does not exist", () => {
    const mgr = new GraphManager(makeConfig({
      real: { path: fixtureRoot },
    }));
    const result = handleDiffEnvironments(mgr, "nonexistent", "real", "pipelines");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("nonexistent");
    expect(result.items).toHaveLength(0);
  });

  it("returns error when envB does not exist", () => {
    const mgr = new GraphManager(makeConfig({
      real: { path: fixtureRoot },
    }));
    const result = handleDiffEnvironments(mgr, "real", "nonexistent", "pipelines");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("nonexistent");
    expect(result.items).toHaveLength(0);
  });

  it("includes datasets and linked services when scope is 'all'", () => {
    const mgr = new GraphManager(makeConfig({
      envA: { path: fixtureRoot },
      envB: { path: fixtureRoot },
    }));
    const result = handleDiffEnvironments(mgr, "envA", "envB", "all");
    expect(result.error).toBeUndefined();
    expect(result.scope).toBe("all");
    const nodeTypes = new Set(result.items.map((i) => i.nodeType));
    // The fixture has datasets and linked services
    expect(nodeTypes.has(NodeType.Pipeline)).toBe(true);
    expect(nodeTypes.has(NodeType.Dataset)).toBe(true);
    expect(nodeTypes.has(NodeType.LinkedService)).toBe(true);
  });

  it("only includes pipelines when scope is 'pipelines'", () => {
    const mgr = new GraphManager(makeConfig({
      envA: { path: fixtureRoot },
      envB: { path: fixtureRoot },
    }));
    const result = handleDiffEnvironments(mgr, "envA", "envB", "pipelines");
    expect(result.error).toBeUndefined();
    expect(result.scope).toBe("pipelines");
    const nodeTypes = new Set(result.items.map((i) => i.nodeType));
    expect(nodeTypes.size).toBe(1);
    expect(nodeTypes.has(NodeType.Pipeline)).toBe(true);
  });

  it("summary counts match item statuses", () => {
    const mgr = new GraphManager(makeConfig({
      envA: { path: fixtureRoot },
      envB: { path: overlayRoot },
    }));
    const result = handleDiffEnvironments(mgr, "envA", "envB", "all");
    expect(result.error).toBeUndefined();
    const countByStatus = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const item of result.items) {
      countByStatus[item.status]++;
    }
    expect(result.summary).toEqual(countByStatus);
  });
});
