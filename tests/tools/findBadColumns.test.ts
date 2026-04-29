import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleFindBadColumns } from "../../src/tools/findBadColumns.js";
import { clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleFindBadColumns", () => {
  beforeEach(() => { clearEntityDetailCache(); });

  it("finds bad columns across all pipelines", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleFindBadColumns(graph, schemaPath);

    expect(result.entries.length).toBeGreaterThanOrEqual(1);

    const destQueryEntry = result.entries.find(
      (e) => e.pipeline === "Dest_Query_Test" && e.activity === "Load Organizations"
    );
    expect(destQueryEntry).toBeDefined();
    expect(destQueryEntry!.badColumns).toContain("nonexistent_attr");
    expect(destQueryEntry!.entity).toBe("alm_organization");
  });

  it("finds bad columns in Expression-wrapped dest_query", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleFindBadColumns(graph, schemaPath);

    const exprEntry = result.entries.find(
      (e) => e.pipeline === "Dest_Query_Test" && e.activity === "Load Expression Wrapped"
    );
    expect(exprEntry).toBeDefined();
    expect(exprEntry!.badColumns).toContain("nonexistent_attr");
  });

  it("finds bad columns in pipeline-level parameter defaults", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleFindBadColumns(graph, schemaPath);

    const defaultEntry = result.entries.find(
      (e) => e.pipeline === "Dest_Query_Defaults_Test" && e.activity.includes("parameter default")
    );
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry!.badColumns).toContain("nonexistent_attr");
  });

  it("does not flag system attributes as bad", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleFindBadColumns(graph, schemaPath);

    for (const entry of result.entries) {
      expect(entry.badColumns).not.toContain("statecode");
      expect(entry.badColumns).not.toContain("statuscode");
    }
  });

  it("skips pipelines without dest_query activities", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleFindBadColumns(graph, schemaPath);

    const stagingPipeline = result.entries.find((e) => e.pipeline === "Copy_To_Staging");
    expect(stagingPipeline).toBeUndefined();
  });

  it("produces correct summary", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleFindBadColumns(graph, schemaPath);

    expect(result.summary.pipelinesScanned).toBeGreaterThanOrEqual(1);
    expect(result.summary.pipelinesWithIssues).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalBadColumns).toBe(
      result.entries.reduce((sum, e) => sum + e.badColumns.length, 0)
    );
  });
});
