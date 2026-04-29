import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDescribeEntity } from "../../src/tools/describeEntity.js";
import { clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleDescribeEntity", () => {
  beforeEach(() => { clearEntityDetailCache(); });

  it("returns entity metadata at summary depth", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "summary", schemaPath);
    expect(result.entity).toBe("alm_organization");
    expect(result.displayName).toBe("Organization");
    expect(result.entitySetName).toBe("alm_organizations");
    expect(result.primaryId).toBe("alm_organizationid");
    expect(result.primaryName).toBe("alm_name");
    expect(result.attributeCount).toBe(5);
  });

  it("lists attribute names at summary depth", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "summary", schemaPath);
    expect(result.attributes.some((a) => a.name === "alm_name")).toBe(true);
    expect(result.attributes.some((a) => a.name === "alm_orgcode")).toBe(true);
    expect(result.attributes[0].type).toBeUndefined();
  });

  it("includes attribute type details at full depth", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "full", schemaPath);
    const nameAttr = result.attributes.find((a) => a.name === "alm_name");
    expect(nameAttr).toBeDefined();
    expect(nameAttr!.type).toBe("String");
    expect(nameAttr!.requiredLevel).toBe("Required");
    expect(nameAttr!.isValidForCreate).toBe(true);
  });

  it("lists consumer activities", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "summary", schemaPath);
    expect(result.consumers.length).toBeGreaterThan(0);
    // copy-to-dataverse.json has a Copy activity "Upsert Organizations" that writes to alm_organization
    const writer = result.consumers.find(
      (c) => c.direction === "writes" && c.activityId.includes("Copy_To_Dataverse"),
    );
    expect(writer).toBeDefined();
    expect(writer!.activityName).toBe("Upsert Organizations");
  });

  it("returns error for unknown entity", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "nonexistent_entity", "summary", schemaPath);
    expect(result.error).toBeDefined();
  });
});
