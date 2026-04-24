import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleFindPaths } from "../../src/tools/paths.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleFindPaths", () => {
  it("finds a path from the orchestrator pipeline to the Dataverse entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindPaths(graph, "Test_Orchestrator", "alm_organization", "pipeline", "dataverse_entity");
    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.from).toBe("Test_Orchestrator");
    expect(result.to).toBe("alm_organization");
  });

  it("finds a path from a child pipeline to the Dataverse entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindPaths(graph, "Copy_To_Dataverse", "alm_organization", "pipeline", "dataverse_entity");
    expect(result.paths.length).toBeGreaterThan(0);
    const firstPath = result.paths[0];
    expect(firstPath.edges.length).toBeGreaterThan(0);
  });

  it("returns empty paths for disconnected nodes", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindPaths(graph, "nonexistent_node", "alm_organization", "pipeline", "dataverse_entity");
    expect(result.paths).toEqual([]);
  });

  it("includes from, to, and edgeType on each edge in the path", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindPaths(graph, "Test_Orchestrator", "alm_organization", "pipeline", "dataverse_entity");
    expect(result.paths.length).toBeGreaterThan(0);
    for (const path of result.paths) {
      for (const edge of path.edges) {
        expect(edge).toHaveProperty("from");
        expect(edge).toHaveProperty("to");
        expect(edge).toHaveProperty("edgeType");
      }
    }
  });
});
