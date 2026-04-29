import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleValidatePipeline } from "../../src/tools/validatePipeline.js";
import { clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleValidatePipeline", () => {
  beforeEach(() => { clearEntityDetailCache(); });

  it("validates dest_query columns against entity schema", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Test", schemaPath);

    expect(result.error).toBeUndefined();
    expect(result.activities.length).toBeGreaterThanOrEqual(1);

    const loadOrgs = result.activities.find((a) => a.activityName === "Load Organizations");
    expect(loadOrgs).toBeDefined();
    expect(loadOrgs!.entityName).toBe("alm_organization");
    expect(loadOrgs!.entityFound).toBe(true);

    const alm_orgid = loadOrgs!.columns.find((c) => c.alias === "alm_orgid");
    expect(alm_orgid).toBeDefined();
    expect(alm_orgid!.status).toBe("invalid");

    const alm_name = loadOrgs!.columns.find((c) => c.alias === "alm_name");
    expect(alm_name).toBeDefined();
    expect(alm_name!.status).toBe("valid");

    const nonexistent = loadOrgs!.columns.find((c) => c.alias === "nonexistent_attr");
    expect(nonexistent).toBeDefined();
    expect(nonexistent!.status).toBe("invalid");
  });

  it("marks system attributes as system", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Test", schemaPath);

    const loadOrgs = result.activities.find((a) => a.activityName === "Load Organizations");
    expect(loadOrgs).toBeDefined();

    const statecode = loadOrgs!.columns.find((c) => c.alias === "statecode");
    expect(statecode).toBeDefined();
    expect(statecode!.status).toBe("system");
  });

  it("skips activities without dest_query", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Test", schemaPath);

    const noDestQuery = result.activities.find((a) => a.activityName === "No Dest Query Activity");
    expect(noDestQuery).toBeUndefined();
  });

  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "NonExistentPipeline", schemaPath);
    expect(result.error).toBeDefined();
    expect(result.activities).toHaveLength(0);
  });

  it("validates Expression-wrapped dest_query", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Test", schemaPath);

    const exprWrapped = result.activities.find((a) => a.activityName === "Load Expression Wrapped");
    expect(exprWrapped).toBeDefined();
    expect(exprWrapped!.entityName).toBe("alm_organization");
    expect(exprWrapped!.entityFound).toBe(true);

    const alm_name = exprWrapped!.columns.find((c) => c.alias === "alm_name");
    expect(alm_name).toBeDefined();
    expect(alm_name!.status).toBe("valid");

    const nonexistent = exprWrapped!.columns.find((c) => c.alias === "nonexistent_attr");
    expect(nonexistent).toBeDefined();
    expect(nonexistent!.status).toBe("invalid");
  });

  it("validates Expression-wrapped dataverse_entity_name", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Test", schemaPath);

    const exprStatus = result.activities.find((a) => a.activityName === "Load Expression Wrapped Status");
    expect(exprStatus).toBeDefined();
    expect(exprStatus!.entityName).toBe("alm_organization");
  });

  it("validates pipeline-level dest_query parameter defaults", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Defaults_Test", schemaPath);

    expect(result.error).toBeUndefined();

    const defaultActivity = result.activities.find(
      (a) => a.activityName === "Dest_Query_Defaults_Test (parameter default)"
    );
    expect(defaultActivity).toBeDefined();
    expect(defaultActivity!.entityName).toBe("alm_organization");
    expect(defaultActivity!.entityFound).toBe(true);

    const alm_name = defaultActivity!.columns.find((c) => c.alias === "alm_name");
    expect(alm_name).toBeDefined();
    expect(alm_name!.status).toBe("valid");

    const nonexistent = defaultActivity!.columns.find((c) => c.alias === "nonexistent_attr");
    expect(nonexistent).toBeDefined();
    expect(nonexistent!.status).toBe("invalid");
  });

  it("produces correct summary counts", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidatePipeline(graph, "Dest_Query_Test", schemaPath);

    expect(result.summary.totalActivities).toBeGreaterThanOrEqual(2);
    expect(result.summary.invalidColumns).toBeGreaterThanOrEqual(1);
    expect(result.summary.systemColumns).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalColumns).toBe(
      result.summary.validColumns + result.summary.invalidColumns + result.summary.systemColumns
    );
  });
});
