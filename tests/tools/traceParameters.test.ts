import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleTraceParameters } from "../../src/tools/traceParameters.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleTraceParameters", () => {
  it("traces parameters defined on the root pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceParameters(graph, "Test_Orchestrator");
    expect(result.parameterFlows.length).toBeGreaterThanOrEqual(2);
    const rootbuFlow = result.parameterFlows.find(
      (f) => f.definedIn === "Test_Orchestrator" && f.parameter === "rootbusinessunit"
    );
    expect(rootbuFlow).toBeDefined();
    expect(rootbuFlow!.type).toBe("String");
    expect(rootbuFlow!.defaultValue).toBe("");
  });

  it("reports dead-end parameters with empty defaults and no supplier", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceParameters(graph, "Test_Orchestrator");
    const deadEnd = result.deadEnds.find((d) => d.parameter === "rootbusinessunit");
    expect(deadEnd).toBeDefined();
    expect(deadEnd!.reason).toBe("empty_default_no_supplier");
  });

  it("does not flag parameters with non-empty defaults as dead-ends", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceParameters(graph, "Test_Orchestrator");
    const uriDeadEnd = result.deadEnds.find((d) => d.parameter === "dataverse_service_uri");
    expect(uriDeadEnd).toBeUndefined();
  });

  it("records suppliers for parameters passed via ExecutePipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceParameters(graph, "Test_Orchestrator");
    // Copy_To_Dataverse receives dataverse_query from the orchestrator
    const flow = result.parameterFlows.find(
      (f) => f.definedIn === "Copy_To_Dataverse" && f.parameter === "dataverse_query"
    );
    expect(flow).toBeDefined();
    expect(flow!.suppliers.length).toBeGreaterThanOrEqual(1);
    expect(flow!.suppliers[0].fromPipeline).toBe("Test_Orchestrator");
  });

  it("returns error when pipeline not found", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceParameters(graph, "NonExistent");
    expect(result.error).toContain("not found");
  });

  it("returns empty flows for pipeline with no parameters", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceParameters(graph, "Copy_To_Staging");
    expect(result.parameterFlows).toHaveLength(0);
    expect(result.deadEnds).toHaveLength(0);
  });
});
