import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleValidateStatuscode } from "../../src/tools/validateStatuscode.js";
import { clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleValidateStatuscode", () => {
  beforeEach(() => { clearEntityDetailCache(); });

  it("finds CASE WHEN statuscode values and validates against OptionSet", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidateStatuscode(graph, "Dest_Query_Test", schemaPath);

    expect(result.error).toBeUndefined();
    expect(result.validations.length).toBeGreaterThanOrEqual(1);

    const statusValidation = result.validations.find(
      (v) => v.activityName === "Load Orgs With Status" && v.alias === "statuscode"
    );
    expect(statusValidation).toBeDefined();
    expect(statusValidation!.optionSetAvailable).toBe(true);
    expect(statusValidation!.mappedValues).toContain(1);
    expect(statusValidation!.mappedValues).toContain(999);
    expect(statusValidation!.mappedValues).toContain(2);
    expect(statusValidation!.invalidValues).toContain(999);
    expect(statusValidation!.invalidValues).not.toContain(1);
    expect(statusValidation!.invalidValues).not.toContain(2);
  });

  it("reports valid OptionSet values with labels", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidateStatuscode(graph, "Dest_Query_Test", schemaPath);

    const statusValidation = result.validations.find(
      (v) => v.alias === "statuscode"
    );
    expect(statusValidation).toBeDefined();
    expect(statusValidation!.validValues).toContainEqual({ value: 1, label: "Active" });
    expect(statusValidation!.validValues).toContainEqual({ value: 2, label: "Inactive" });
  });

  it("returns correct summary counts", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidateStatuscode(graph, "Dest_Query_Test", schemaPath);

    expect(result.summary.activitiesWithIssues).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalInvalidValues).toBeGreaterThanOrEqual(1);
  });

  it("returns error for unknown pipeline", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidateStatuscode(graph, "NonExistent", schemaPath);
    expect(result.error).toBeDefined();
    expect(result.validations).toHaveLength(0);
  });

  it("skips non-CASE statuscode aliases", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleValidateStatuscode(graph, "Dest_Query_Test", schemaPath);

    // The "Load Organizations" activity has statecode but it's not a CASE expression
    const loadOrgsStatecode = result.validations.find(
      (v) => v.activityName === "Load Organizations" && v.alias === "statecode"
    );
    expect(loadOrgsStatecode).toBeUndefined();
  });
});
