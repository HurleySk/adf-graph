import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { resolveChildParameters } from "../../src/utils/parameterResolver.js";
import { NodeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("resolveChildParameters", () => {
  it("resolves caller-supplied values over child defaults", () => {
    const { graph } = buildGraph(fixtureRoot);
    // DeltaLoad_Orchestrator -> "Load Work Items" calls CDC_OnPrem_Template
    const actNode = graph.getNode("activity:DeltaLoad_Orchestrator/Load Work Items");
    expect(actNode).toBeDefined();

    const result = resolveChildParameters(graph, actNode!);
    expect(result).not.toBeNull();
    expect(result!.childPipeline).toBe("CDC_OnPrem_Template");
    expect(result!.callerActivity).toBe("Load Work Items");

    const sourceObj = result!.resolvedParameters.find((p) => p.name === "source_object_name");
    expect(sourceObj).toBeDefined();
    expect(sourceObj!.resolvedValue).toBe("Work_Item");
    expect(sourceObj!.source).toBe("caller");
  });

  it("falls back to child defaults when caller doesn't supply value", () => {
    const { graph } = buildGraph(fixtureRoot);
    const actNode = graph.getNode("activity:DeltaLoad_Orchestrator/Load Work Sets");
    expect(actNode).toBeDefined();

    const result = resolveChildParameters(graph, actNode!);
    expect(result).not.toBeNull();

    // CDC_OnPrem_Template has pre_copy_script with default ""
    // Load Work Sets doesn't supply it
    const preCopy = result!.resolvedParameters.find((p) => p.name === "pre_copy_script");
    expect(preCopy).toBeDefined();
    expect(preCopy!.source).toBe("default");
    expect(preCopy!.resolvedValue).toBe("");
  });

  it("marks expression values as isExpression", () => {
    const { graph } = buildGraph(fixtureRoot);
    // Test_Orchestrator -> "Run CDC OnPrem" has expression-typed source_query
    const actNode = graph.getNode("activity:Test_Orchestrator/Run CDC OnPrem");
    expect(actNode).toBeDefined();

    const result = resolveChildParameters(graph, actNode!);
    expect(result).not.toBeNull();

    // source_object_name has type: "Expression" wrapper
    const sourceObj = result!.resolvedParameters.find((p) => p.name === "source_object_name");
    expect(sourceObj).toBeDefined();
    // The value is a non-@ expression string, so it resolves to the concrete value
    expect(sourceObj!.resolvedValue).toBe("Work_Set_State");
  });

  it("detects CDC pattern from resolved values", () => {
    const { graph } = buildGraph(fixtureRoot);
    const actNode = graph.getNode("activity:DeltaLoad_Orchestrator/Load Work Items");
    expect(actNode).toBeDefined();

    const result = resolveChildParameters(graph, actNode!);
    expect(result).not.toBeNull();
    expect(result!.cdcInfo).not.toBeNull();
    expect(result!.cdcInfo!.isCdc).toBe(true);
    expect(result!.cdcInfo!.cdcCurrentTable).toBe("CDC_Work_Item_Current");
  });

  it("returns null for non-ExecutePipeline activity", () => {
    const { graph } = buildGraph(fixtureRoot);
    // Find a non-ExecutePipeline activity
    const nodes = graph.getNodesByType(NodeType.Activity);
    const copyNode = nodes.find((n) => n.metadata.activityType === "Copy");
    expect(copyNode).toBeDefined();

    const result = resolveChildParameters(graph, copyNode!);
    expect(result).toBeNull();
  });

  it("returns null CDC info for non-CDC calls", () => {
    const { graph } = buildGraph(fixtureRoot);
    // Test_Orchestrator -> "Run Copy To Staging" calls Copy_To_Staging (not CDC)
    const actNode = graph.getNode("activity:Test_Orchestrator/Run Copy To Staging");
    expect(actNode).toBeDefined();

    const result = resolveChildParameters(graph, actNode!);
    expect(result).not.toBeNull();
    expect(result!.cdcInfo).toBeNull();
  });
});
