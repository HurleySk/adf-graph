import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleIgnoreNullValuesAudit } from "../../src/tools/ignoreNullValuesAudit.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleIgnoreNullValuesAudit", () => {
  it("flags Dataverse Copy activities without ignoreNullValues", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph);

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
    const result = handleIgnoreNullValuesAudit(graph);

    const safe = result.flagged.find(
      (e) => e.pipeline === "Copy_DV_IgnoreNulls" && e.activity === "Safe Upsert Contacts"
    );
    expect(safe).toBeUndefined();
  });

  it("does NOT flag non-Dataverse sinks", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph);

    const sqlSink = result.flagged.find((e) => e.pipeline === "Copy_To_Staging");
    expect(sqlSink).toBeUndefined();
  });

  it("summary counts are correct", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph);

    expect(result.summary.totalCopyActivities).toBeGreaterThanOrEqual(2);
    expect(result.summary.dataverseSinks).toBeGreaterThanOrEqual(2);
    expect(result.summary.flaggedCount).toBe(result.flagged.length);
    expect(result.summary.flaggedCount).toBeLessThan(result.summary.dataverseSinks);
  });

  it("includes alternateKeyName when present", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleIgnoreNullValuesAudit(graph);

    const allEntries = result.flagged;
    expect(allEntries.every((e) => "alternateKeyName" in e)).toBe(true);
  });
});
