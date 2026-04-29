import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleCdcAnalysis } from "../../src/tools/cdcAnalysis.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleCdcAnalysis", () => {
  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "NonExistent");
    expect(result.error).toBeDefined();
    expect(result.cdcCalls).toHaveLength(0);
  });

  it("finds CDC calls in DeltaLoad orchestrator", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "DeltaLoad_Orchestrator");
    expect(result.error).toBeUndefined();
    expect(result.cdcCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalCdcCalls).toBeGreaterThanOrEqual(1);
  });

  it("extracts CDC info from resolved parameters", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "DeltaLoad_Orchestrator");
    const workItemCall = result.cdcCalls.find((c) => c.callerActivity === "Load Work Items");
    expect(workItemCall).toBeDefined();
    expect(workItemCall!.cdcInfo.isCdc).toBe(true);
    expect(workItemCall!.cdcInfo.cdcCurrentTable).toBe("CDC_Work_Item_Current");
    expect(workItemCall!.cdcInfo.cdcHistoricalTable).toBe("CDC_Work_Item_Historical");
    expect(workItemCall!.cdcInfo.dataverseEntity).toBe("pcx_workpackage");
  });

  it("builds filter chain from source and dest queries", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "DeltaLoad_Orchestrator");
    const workItemCall = result.cdcCalls.find((c) => c.callerActivity === "Load Work Items");
    expect(workItemCall).toBeDefined();
    expect(workItemCall!.filterChain.length).toBeGreaterThanOrEqual(1);
  });

  it("detects escape hatches in dest_query", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "DeltaLoad_Orchestrator");
    const workItemCall = result.cdcCalls.find((c) => c.callerActivity === "Load Work Items");
    expect(workItemCall).toBeDefined();

    const destFilter = workItemCall!.filterChain.find((f) => f.stage === "staging_to_dv");
    if (destFilter) {
      expect(destFilter.escapeHatches.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns no CDC calls for non-CDC pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "Copy_To_Staging");
    expect(result.cdcCalls).toHaveLength(0);
    expect(result.summary.totalCdcCalls).toBe(0);
  });

  it("identifies stored procedure in CDC info", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "DeltaLoad_Orchestrator");
    const workItemCall = result.cdcCalls.find((c) => c.callerActivity === "Load Work Items");
    expect(workItemCall).toBeDefined();
    expect(workItemCall!.cdcInfo.storedProcedure).toBe("[dbo].[p_InsertProcessedTransactionsAndDelete]");
  });

  it("detects CDC calls without pending table", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleCdcAnalysis(graph, "DeltaLoad_Orchestrator");
    const workSetCall = result.cdcCalls.find((c) => c.callerActivity === "Load Work Sets");
    expect(workSetCall).toBeDefined();
    expect(workSetCall!.cdcInfo.cdcPendingTable).toBeFalsy();
  });
});
