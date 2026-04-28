import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleValidate, ValidationIssue } from "../../src/tools/validate.js";
import { Graph, NodeType, EdgeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleValidate", () => {
  it("finds broken_dataset_reference errors for stub datasets", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "all");
    const brokenDatasets = result.issues.filter(
      (i) => i.category === "broken_dataset_reference",
    );
    expect(brokenDatasets.length).toBeGreaterThan(0);
    expect(brokenDatasets[0].severity).toBe("error");
    expect(brokenDatasets.some((i) => i.relatedNodeId === "dataset:ds_sql_source")).toBe(true);
  });

  it("finds broken_linked_service_reference errors for stub linked services", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "all");
    const brokenLs = result.issues.filter(
      (i) => i.category === "broken_linked_service_reference",
    );
    expect(brokenLs.length).toBeGreaterThanOrEqual(1);
    expect(brokenLs.every((i) => i.severity === "error")).toBe(true);
    const relatedIds = brokenLs.map((i) => i.relatedNodeId);
    expect(relatedIds).toContain("linked_service:ls_sql_staging");
  });

  it("finds broken_table_reference errors for stub tables", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "all");
    const brokenTables = result.issues.filter(
      (i) => i.category === "broken_table_reference",
    );
    expect(brokenTables.length).toBeGreaterThan(0);
    expect(brokenTables.some((i) => i.relatedNodeId === "table:dbo.LegacyOrg")).toBe(true);
  });

  it("finds empty_param_default warnings for pipelines with empty defaults", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "all");
    const emptyDefaults = result.issues.filter(
      (i) => i.category === "empty_param_default",
    );
    expect(emptyDefaults.length).toBeGreaterThanOrEqual(2);
    expect(emptyDefaults.every((i) => i.severity === "warning")).toBe(true);
    const messages = emptyDefaults.map((i) => i.message);
    expect(messages.some((m) => m.includes("rootbusinessunit"))).toBe(true);
    expect(messages.some((m) => m.includes("dataverse_query"))).toBe(true);
  });

  it("finds missing_linked_service warnings for datasets without linked service edges", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "all");
    const missingLs = result.issues.filter(
      (i) => i.category === "missing_linked_service",
    );
    // ds_sql_source is a stub dataset with no uses_linked_service edge
    expect(missingLs.length).toBeGreaterThanOrEqual(1);
    expect(missingLs.some((i) => i.nodeId === "dataset:ds_sql_source")).toBe(true);
  });

  it("severity filter 'error' excludes warnings", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "error");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.severity === "error")).toBe(true);
    expect(result.issueCount.warnings).toBe(0);
    expect(result.issueCount.errors).toBe(result.issues.length);
  });

  it("severity filter 'warning' excludes errors", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "warning");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
    expect(result.issueCount.errors).toBe(0);
    expect(result.issueCount.warnings).toBe(result.issues.length);
  });

  it("severity 'all' returns both errors and warnings", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "test", "all");
    const hasErrors = result.issues.some((i) => i.severity === "error");
    const hasWarnings = result.issues.some((i) => i.severity === "warning");
    expect(hasErrors).toBe(true);
    expect(hasWarnings).toBe(true);
    expect(result.issueCount.errors + result.issueCount.warnings).toBe(result.issues.length);
  });

  it("returns the environment name in the result", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidate(graph, "my-env", "all");
    expect(result.environment).toBe("my-env");
  });

  it("detects orphan_node for non-stub nodes with no edges", () => {
    // Build a minimal graph with an orphan
    const graph = new Graph();
    graph.addNode({
      id: "pipeline:Orphan",
      type: NodeType.Pipeline,
      name: "Orphan",
      metadata: { parameters: [] },
    });
    const result = handleValidate(graph, "test", "all");
    const orphans = result.issues.filter((i) => i.category === "orphan_node");
    expect(orphans.length).toBe(1);
    expect(orphans[0].nodeId).toBe("pipeline:Orphan");
    expect(orphans[0].severity).toBe("warning");
  });

  it("skips stub nodes for orphan_node check", () => {
    const graph = new Graph();
    graph.addNode({
      id: "dataset:StubDs",
      type: NodeType.Dataset,
      name: "StubDs",
      metadata: { stub: true },
    });
    const result = handleValidate(graph, "test", "all");
    const orphans = result.issues.filter((i) => i.category === "orphan_node");
    expect(orphans).toEqual([]);
  });

  it("detects missing_child_pipeline for executes edges to stub pipelines", () => {
    const graph = new Graph();
    graph.addNode({
      id: "pipeline:Parent",
      type: NodeType.Pipeline,
      name: "Parent",
      metadata: { parameters: [] },
    });
    graph.addNode({
      id: "pipeline:Child",
      type: NodeType.Pipeline,
      name: "Child",
      metadata: { stub: true },
    });
    graph.addEdge({
      from: "pipeline:Parent",
      to: "pipeline:Child",
      type: EdgeType.Executes,
      metadata: {},
    });
    const result = handleValidate(graph, "test", "error");
    const missing = result.issues.filter((i) => i.category === "missing_child_pipeline");
    expect(missing.length).toBe(1);
    expect(missing[0].relatedNodeId).toBe("pipeline:Child");
  });

  it("detects broken_sp_reference for calls_sp edges to stub SPs", () => {
    const graph = new Graph();
    graph.addNode({
      id: "activity:Pipe/Act",
      type: NodeType.Activity,
      name: "Pipe/Act",
      metadata: {},
    });
    graph.addNode({
      id: "stored_procedure:dbo.MyProc",
      type: NodeType.StoredProcedure,
      name: "dbo.MyProc",
      metadata: { stub: true },
    });
    graph.addEdge({
      from: "activity:Pipe/Act",
      to: "stored_procedure:dbo.MyProc",
      type: EdgeType.CallsSp,
      metadata: {},
    });
    const result = handleValidate(graph, "test", "error");
    const broken = result.issues.filter((i) => i.category === "broken_sp_reference");
    expect(broken.length).toBe(1);
    expect(broken[0].relatedNodeId).toBe("stored_procedure:dbo.MyProc");
  });
});
