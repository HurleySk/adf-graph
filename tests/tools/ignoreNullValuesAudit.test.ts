import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleIgnoreNullValuesAudit, IgnoreNullValuesAuditResult, IgnoreNullValuesAuditSummaryResult } from "../../src/tools/ignoreNullValuesAudit.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleIgnoreNullValuesAudit", () => {
  it("flags Dataverse Copy activities without ignoreNullValues", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph, "full");

    const flagged = result.flagged.find(
      (e) => e.pipeline === "Copy_To_Dataverse" && e.activity === "Upsert Organizations"
    );
    expect(flagged).toBeDefined();
    expect(flagged!.sinkType).toBe("CommonDataServiceForAppsSink");
    expect(flagged!.writeBehavior).toBe("upsert");
    expect(flagged!.ignoreNullValues).toBe(false);
    expect(flagged!.entity).toBe("alm_organization");
  });

  it("does NOT flag Dataverse Copy activities with ignoreNullValues: true", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph, "full");

    const safe = result.flagged.find(
      (e) => e.pipeline === "Copy_DV_IgnoreNulls" && e.activity === "Safe Upsert Contacts"
    );
    expect(safe).toBeUndefined();
  });

  it("does NOT flag non-Dataverse sinks", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph, "full");

    const sqlSink = result.flagged.find((e) => e.pipeline === "Copy_To_Staging");
    expect(sqlSink).toBeUndefined();
  });

  it("summary counts are correct", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph, "full");

    expect(result.summary.totalCopyActivities).toBeGreaterThanOrEqual(2);
    expect(result.summary.dataverseSinks).toBeGreaterThanOrEqual(2);
    expect(result.summary.flaggedCount).toBe(result.flagged.length);
    expect(result.summary.flaggedCount).toBeLessThan(result.summary.dataverseSinks);
  });

  it("includes alternateKeyName when present", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph, "full");

    const allEntries = result.flagged;
    expect(allEntries.every((e) => "alternateKeyName" in e)).toBe(true);
  });

  it("defaults to summary mode with pipelineBreakdown", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph);
    expect("pipelineBreakdown" in result).toBe(true);
    expect("flagged" in result).toBe(false);
    expect(result.summary.flaggedCount).toBeGreaterThan(0);
  });

  it("summary pipelineBreakdown counts match full flagged count", () => {
    const { graph } = buildGraph(fixtureRoot);
    const full = handleIgnoreNullValuesAudit(graph, "full") as IgnoreNullValuesAuditResult;
    const summary = handleIgnoreNullValuesAudit(graph, "summary") as IgnoreNullValuesAuditSummaryResult;
    const totalFromBreakdown = summary.pipelineBreakdown.reduce((sum, e) => sum + e.flaggedCount, 0);
    expect(totalFromBreakdown).toBe(full.flagged.length);
  });
});
