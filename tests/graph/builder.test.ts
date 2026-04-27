import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { NodeType, EdgeType } from "../../src/graph/model.js";

// The fixture root has: pipeline/, dataset/, SQL DB/test-project/dbo/...
const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("buildGraph", () => {
  it("builds a graph from the fixture directory", () => {
    const { graph } = buildGraph(fixtureRoot);
    const stats = graph.stats();
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.edgeCount).toBeGreaterThan(0);
  });

  it("discovers all 4 pipelines", () => {
    const { graph } = buildGraph(fixtureRoot);
    const pipelines = graph.getNodesByType(NodeType.Pipeline);
    // 4 fixture pipelines: Test_Orchestrator, Copy_To_Staging, SP_Transform, Copy_To_Dataverse
    expect(pipelines.length).toBeGreaterThanOrEqual(4);
  });

  it("creates 3 ExecutePipeline (executes) edges from the orchestrator", () => {
    const { graph } = buildGraph(fixtureRoot);
    const orchestratorId = "pipeline:Test_Orchestrator";
    const outgoing = graph.getOutgoing(orchestratorId);
    const executes = outgoing.filter((e) => e.type === EdgeType.Executes);
    expect(executes).toHaveLength(3);
    const targets = executes.map((e) => e.to);
    expect(targets).toContain("pipeline:Copy_To_Staging");
    expect(targets).toContain("pipeline:SP_Transform");
    expect(targets).toContain("pipeline:Copy_To_Dataverse");
  });

  it("discovers 2 datasets from fixture files (plus possible stubs)", () => {
    const { graph } = buildGraph(fixtureRoot);
    const datasets = graph.getNodesByType(NodeType.Dataset);
    // At least 2 from the fixture JSON files; stubs from pipeline references may add more
    expect(datasets.length).toBeGreaterThanOrEqual(2);
    const ids = datasets.map((d) => d.id);
    expect(ids).toContain("dataset:ds_sql_staging");
    expect(ids).toContain("dataset:ds_dataverse");
    // The two fixture-parsed datasets should not be stubs
    const staging = graph.getNode("dataset:ds_sql_staging");
    const dataverse = graph.getNode("dataset:ds_dataverse");
    expect(staging?.metadata.stub).toBeFalsy();
    expect(dataverse?.metadata.stub).toBeFalsy();
  });

  it("discovers SQL objects (at least 1 SP and 1 table)", () => {
    const { graph } = buildGraph(fixtureRoot);
    const sps = graph.getNodesByType(NodeType.StoredProcedure);
    const tables = graph.getNodesByType(NodeType.Table);
    expect(sps.length).toBeGreaterThanOrEqual(1);
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(sps.some((n) => n.id === "stored_procedure:dbo.p_Transform_Org")).toBe(true);
    expect(tables.some((n) => n.id === "table:dbo.Org_Staging")).toBe(true);
  });

  it("can traverse from orchestrator downstream to dataverse entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const downstream = graph.traverseDownstream("pipeline:Test_Orchestrator");
    const ids = downstream.map((r) => r.node.id);
    expect(ids.some((id) => id.startsWith("dataverse_entity:"))).toBe(true);
  });

  it("returns a warnings array (may be empty for clean fixtures)", () => {
    const { warnings } = buildGraph(fixtureRoot);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("creates LinkedService nodes from linkedService/ directory", () => {
    const { graph } = buildGraph(fixtureRoot);
    const lsNodes = graph.getNodesByType(NodeType.LinkedService);
    expect(lsNodes.length).toBeGreaterThanOrEqual(2);
    const names = lsNodes.map((n) => n.name);
    expect(names).toContain("ls_azure_sql");
    expect(names).toContain("ls_key_vault");
  });

  it("creates KeyVaultSecret nodes from linked service key vault references", () => {
    const { graph } = buildGraph(fixtureRoot);
    const secrets = graph.getNodesByType(NodeType.KeyVaultSecret);
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    expect(secrets.map((n) => n.name)).toContain("ALM-ONPREM-SQL-CONNECTION-PROD");
  });

  it("creates ReferencesSecret edges from LS to KV secrets", () => {
    const { graph } = buildGraph(fixtureRoot);
    const edges = graph.getOutgoing("linked_service:ls_azure_sql");
    const secretEdge = edges.find((e) => e.type === EdgeType.ReferencesSecret);
    expect(secretEdge).toBeDefined();
    expect(secretEdge!.to).toBe("key_vault_secret:ALM-ONPREM-SQL-CONNECTION-PROD");
  });

  it("does not create stub nodes for linked_service: and key_vault_secret: prefixes", () => {
    const { graph } = buildGraph(fixtureRoot);
    const lsNode = graph.getNode("linked_service:ls_azure_sql");
    expect(lsNode).toBeDefined();
    expect(lsNode!.metadata.stub).toBeUndefined();
    const secretNode = graph.getNode("key_vault_secret:ALM-ONPREM-SQL-CONNECTION-PROD");
    expect(secretNode).toBeDefined();
    expect(secretNode!.metadata.stub).toBeUndefined();
  });
});
