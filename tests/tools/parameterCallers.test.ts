import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleParameterCallers } from "../../src/tools/parameterCallers.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleParameterCallers", () => {
  it("finds callers for a pipeline with parameters", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Copy_To_Dataverse");

    expect(result.error).toBeUndefined();
    expect(result.parameters.length).toBeGreaterThanOrEqual(1);
    expect(result.totalCallers).toBeGreaterThanOrEqual(1);
  });

  it("shows supplied values from callers", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Copy_To_Dataverse");

    const dataverseQuery = result.parameters.find((p) => p.parameter === "dataverse_query");
    expect(dataverseQuery).toBeDefined();
    expect(dataverseQuery!.callers.length).toBeGreaterThanOrEqual(1);

    const orchestratorCaller = dataverseQuery!.callers.find(
      (c) => c.callerPipeline === "Test_Orchestrator"
    );
    expect(orchestratorCaller).toBeDefined();
    expect(orchestratorCaller!.suppliedValue).toBeDefined();
  });

  it("detects expression values", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Copy_To_Dataverse");

    for (const param of result.parameters) {
      for (const caller of param.callers) {
        if (typeof caller.suppliedValue === "string" && caller.suppliedValue.startsWith("@")) {
          expect(caller.isExpression).toBe(true);
        }
      }
    }
  });

  it("flags dead-end parameters", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Copy_To_Dataverse");

    const dataverseQuery = result.parameters.find((p) => p.parameter === "dataverse_query");
    expect(dataverseQuery).toBeDefined();
    if (dataverseQuery!.defaultValue === "" && dataverseQuery!.callers.every((c) => c.isExpression)) {
      expect(dataverseQuery!.hasDeadEnd).toBe(true);
    }
  });

  it("returns empty parameters for pipeline with none", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Copy_To_Staging");

    expect(result.error).toBeUndefined();
    expect(result.parameters).toEqual([]);
  });

  it("filters by parameter name", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Copy_To_Dataverse", "dataverse_query");

    expect(result.parameters.length).toBeLessThanOrEqual(1);
    if (result.parameters.length > 0) {
      expect(result.parameters[0].parameter).toBe("dataverse_query");
    }
  });

  it("returns error for nonexistent pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "nonexistent_pipeline");

    expect(result.error).toBeDefined();
    expect(result.parameters).toEqual([]);
  });

  it("returns zero callers for root orchestrators", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleParameterCallers(graph, "Test_Orchestrator");

    expect(result.totalCallers).toBe(0);
  });
});
