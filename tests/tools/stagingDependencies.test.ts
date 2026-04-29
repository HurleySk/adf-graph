import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleStagingDependencies } from "../../src/tools/stagingDependencies.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleStagingDependencies", () => {
  it("finds tables with writers and readers", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingDependencies(graph);

    expect(result.tables.length).toBeGreaterThan(0);

    const orgStaging = result.tables.find((t) => t.table.includes("Org_Staging"));
    expect(orgStaging).toBeDefined();
    expect(orgStaging!.writers.length).toBeGreaterThanOrEqual(1);
    expect(orgStaging!.readers.length).toBeGreaterThanOrEqual(1);
  });

  it("detects TRUNCATE TABLE in writing pipeline's activities", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingDependencies(graph);

    const orgStaging = result.tables.find((t) => t.table.includes("Org_Staging"));
    expect(orgStaging).toBeDefined();

    const copyToStagingWriter = orgStaging!.writers.find((w) => w.pipeline === "Copy_To_Staging");
    expect(copyToStagingWriter).toBeDefined();
    expect(copyToStagingWriter!.hasTruncate).toBe(true);
  });

  it("filters by table name", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingDependencies(graph, "Org_Staging");

    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    expect(result.tables.every((t) => t.table.toLowerCase().includes("org_staging"))).toBe(true);
  });

  it("summary counts match data", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingDependencies(graph);

    expect(result.summary.totalTables).toBe(result.tables.length);
    expect(result.summary.sharedTableCount).toBe(result.sharedTables.length);
    expect(result.summary.truncateConflictCount).toBe(
      result.sharedTables.filter((t) => t.hasTruncateConflict).length
    );
  });

  it("tables with no usage are excluded", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingDependencies(graph);

    for (const table of result.tables) {
      expect(table.writers.length + table.readers.length).toBeGreaterThan(0);
    }
  });

  it("isShared is false when only one pipeline writes", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleStagingDependencies(graph);

    const orgStaging = result.tables.find((t) => t.table.includes("Org_Staging"));
    expect(orgStaging).toBeDefined();

    const distinctWritingPipelines = new Set(
      orgStaging!.writers.filter((w) => w.pipeline !== "(stored procedure)").map((w) => w.pipeline)
    );
    if (distinctWritingPipelines.size <= 1) {
      expect(orgStaging!.isShared).toBe(false);
    }
  });
});
