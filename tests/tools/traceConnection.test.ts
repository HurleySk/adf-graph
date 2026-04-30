import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleTraceConnection } from "../../src/tools/traceConnection.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleTraceConnection", () => {
  it("traces Copy activity through dataset to linked service", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Dataverse");
    expect(result.error).toBeUndefined();
    expect(result.chains.length).toBeGreaterThan(0);

    const chain = result.chains.find((c) => c.activityType === "Copy");
    expect(chain).toBeDefined();

    const dsSteps = chain!.steps.filter((s) => s.nodeType === "dataset");
    expect(dsSteps.length).toBeGreaterThan(0);

    const lsSteps = chain!.steps.filter((s) => s.nodeType === "linked_service");
    expect(lsSteps.length).toBeGreaterThan(0);
    const lsNames = lsSteps.map((s) => s.name);
    expect(lsNames).toContain("ls_dataverse_dev");
    expect(lsNames).toContain("ls_sql_staging");
  });

  it("traces Copy_To_Staging through dataset to linked service", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Staging");
    expect(result.error).toBeUndefined();
    expect(result.chains.length).toBeGreaterThan(0);

    const chain = result.chains.find((c) => c.activityType === "Copy");
    expect(chain).toBeDefined();
    const dsStep = chain!.steps.find((s) => s.nodeType === "dataset");
    expect(dsStep).toBeDefined();
  });

  it("filters to a specific activity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Dataverse", "Upsert Organizations");
    expect(result.error).toBeUndefined();
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].activity).toBe("Upsert Organizations");
  });

  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Nonexistent_Pipeline");
    expect(result.error).toBeDefined();
    expect(result.chains).toHaveLength(0);
  });

  it("returns error for unknown activity in valid pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Dataverse", "Nonexistent_Activity");
    expect(result.error).toBeDefined();
    expect(result.chains).toHaveLength(0);
  });

  it("includes linked service connectionProperties metadata", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Dataverse");
    const chain = result.chains.find((c) => c.activityType === "Copy");
    const lsStep = chain?.steps.find((s) => s.nodeType === "linked_service" && s.name === "ls_dataverse_dev");
    expect(lsStep).toBeDefined();
    const cp = lsStep!.metadata.connectionProperties as Record<string, string>;
    expect(cp.serviceUri).toBe("https://almdatadev.crm.dynamics.com");
  });

  it("includes key vault secrets in chain", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Dataverse");
    const chain = result.chains.find((c) => c.activityType === "Copy");
    const secretStep = chain?.steps.find((s) => s.nodeType === "key_vault_secret");
    expect(secretStep).toBeDefined();
    expect(secretStep!.name).toBe("DATAVERSE-SP-SECRET");
  });

  it("traces nested Copy inside Until container", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Pipeline_With_Containers");
    expect(result.error).toBeUndefined();

    const copyBatch = result.chains.find((c) => c.activity === "Batch Upsert Loop/Copy Batch");
    expect(copyBatch).toBeDefined();
    expect(copyBatch!.activityType).toBe("Copy");
    const dsNames = copyBatch!.steps.filter((s) => s.nodeType === "dataset").map((s) => s.name);
    expect(dsNames).toContain("ds_sql_staging");
    expect(dsNames).toContain("ds_dataverse");
  });

  it("traces nested Copy inside IfCondition false branch", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Pipeline_With_Containers");

    const logCopy = result.chains.find((c) => c.activity === "Check Results/Log No Results");
    expect(logCopy).toBeDefined();
    expect(logCopy!.activityType).toBe("Copy");
  });

  it("traces nested Copy inside ForEach container", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Pipeline_With_Containers");

    const regionCopy = result.chains.find((c) => c.activity === "Process Each Region/Copy Region Data");
    expect(regionCopy).toBeDefined();
    expect(regionCopy!.activityType).toBe("Copy");
  });

  it("includes role on dataset and linked service steps", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_To_Dataverse");
    const chain = result.chains.find((c) => c.activityType === "Copy");
    expect(chain).toBeDefined();

    const sourceDs = chain!.steps.find((s) => s.nodeType === "dataset" && s.name === "ds_sql_staging");
    expect(sourceDs?.role).toBe("source");

    const sinkDs = chain!.steps.find((s) => s.nodeType === "dataset" && s.name === "ds_dataverse");
    expect(sinkDs?.role).toBe("sink");

    const sinkLs = chain!.steps.find((s) => s.nodeType === "linked_service" && s.name === "ls_dataverse_dev" && s.role === "sink");
    expect(sinkLs).toBeDefined();
  });

  it("traces cross-org pipeline and shows different URIs for source vs sink", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Copy_Cross_Org");
    expect(result.error).toBeUndefined();
    expect(result.chains.length).toBeGreaterThan(0);

    const chain = result.chains[0];
    const sourceLs = chain.steps.find((s) => s.nodeType === "linked_service" && s.role === "source");
    const sinkLs = chain.steps.find((s) => s.nodeType === "linked_service" && s.role === "sink");
    expect(sourceLs).toBeDefined();
    expect(sinkLs).toBeDefined();
    const srcUri = (sourceLs!.metadata.connectionProperties as Record<string, string>)?.serviceUri;
    const snkUri = (sinkLs!.metadata.connectionProperties as Record<string, string>)?.serviceUri;
    expect(srcUri).toContain("almdatadev");
    expect(snkUri).toContain("datadevqa");
  });

  it("follows ExecutePipeline into child pipelines", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleTraceConnection(graph, "Test_Orchestrator");
    expect(result.error).toBeUndefined();
    expect(result.chains.length).toBeGreaterThan(0);

    const childPipelines = new Set(result.chains.map((c) => c.pipeline));
    expect(childPipelines.has("Copy_To_Staging") || childPipelines.has("Copy_To_Dataverse")).toBe(true);
  });
});
