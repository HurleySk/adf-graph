import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleValidateStagingColumns } from "../../src/tools/validateStagingColumns.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleValidateStagingColumns", () => {
  it("detects source_query columns not in staging DDL", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    const mismatchEntry = result.entries.find((e) => e.activity === "Load With Mismatch");
    expect(mismatchEntry).toBeDefined();
    expect(mismatchEntry!.mismatches.length).toBeGreaterThan(0);

    const inactiveDate = mismatchEntry!.mismatches.find((m) => m.sourceColumn === "Inactive_Date");
    expect(inactiveDate).toBeDefined();
    expect(inactiveDate!.nearestStagingColumn).toBe("work_item_inactive_date");
  });

  it("passes when all source columns match staging DDL", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    const matchEntry = result.entries.find((e) => e.activity === "Load With Match");
    expect(matchEntry).toBeDefined();
    expect(matchEntry!.mismatches).toEqual([]);
  });

  it("comparison is case-insensitive", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    const matchEntry = result.entries.find((e) => e.activity === "Load With Match");
    expect(matchEntry).toBeDefined();
    expect(matchEntry!.mismatches).toEqual([]);
    expect(matchEntry!.sourceColumns).toContain("Work_Item_Inactive_Date");
  });

  it("skips dynamic source_query expressions", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    const dynamicEntry = result.entries.find((e) => e.activity === "Load Dynamic Skip");
    expect(dynamicEntry).toBeUndefined();
  });

  it("handles Expression-wrapped parameter values", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    const exprEntry = result.entries.find((e) => e.activity === "Load Expression Wrapped");
    expect(exprEntry).toBeDefined();
    expect(exprEntry!.mismatches.length).toBeGreaterThan(0);
    const badCol = exprEntry!.mismatches.find((m) => m.sourceColumn === "Bad_Column");
    expect(badCol).toBeDefined();
  });

  it("reports unmapped staging columns", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    const mismatchEntry = result.entries.find((e) => e.activity === "Load With Mismatch");
    expect(mismatchEntry).toBeDefined();
    expect(mismatchEntry!.unmappedStagingColumns.length).toBeGreaterThan(0);
  });

  it("scans all pipelines when no pipeline specified", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph);

    expect(result.summary.activitiesScanned).toBeGreaterThanOrEqual(1);
  });

  it("produces correct summary counts", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "Source_Query_Staging_Test");

    expect(result.summary.activitiesScanned).toBe(result.entries.length);
    expect(result.summary.totalMismatches).toBe(
      result.entries.reduce((sum, e) => sum + e.mismatches.length, 0),
    );
    expect(result.summary.activitiesWithMismatches).toBe(
      result.entries.filter((e) => e.mismatches.length > 0).length,
    );
  });

  it("returns error for nonexistent pipeline", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleValidateStagingColumns(graph, "NonExistent_Pipeline");

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.entries).toEqual([]);
  });
});
