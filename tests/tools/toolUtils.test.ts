import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { lookupPipelineNode } from "../../src/tools/toolUtils.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("lookupPipelineNode", () => {
  it("returns node and id for an existing pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = lookupPipelineNode(graph, "Test_Orchestrator");
    expect(result.error).toBeUndefined();
    expect(result.node).toBeDefined();
    expect(result.node!.name).toBe("Test_Orchestrator");
    expect(result.id).toBe("pipeline:Test_Orchestrator");
  });

  it("returns error for a non-existent pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = lookupPipelineNode(graph, "NonExistent");
    expect(result.error).toContain("not found");
    expect(result.node).toBeUndefined();
    expect(result.id).toBe("pipeline:NonExistent");
  });

  it("returns correct id format for pipeline with spaces", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = lookupPipelineNode(graph, "My Pipeline");
    expect(result.id).toBe("pipeline:My Pipeline");
    expect(result.error).toBeDefined();
  });
});
