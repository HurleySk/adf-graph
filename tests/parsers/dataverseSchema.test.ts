import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { NodeType, EdgeType } from "../../src/graph/model.js";
import {
  parseSchemaIndex,
  loadEntityDetail,
  clearEntityDetailCache,
} from "../../src/parsers/dataverseSchema.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/dataverse-schema");
const schemaPath = join(fixtureDir, "test-env");

describe("parseSchemaIndex", () => {
  it("creates entity nodes from index entries that have files in the env directory", () => {
    const result = parseSchemaIndex(schemaPath);
    const entityIds = result.nodes
      .filter((n) => n.type === NodeType.DataverseEntity)
      .map((n) => n.id);
    expect(entityIds).toContain("dataverse_entity:alm_organization");
    expect(entityIds).toContain("dataverse_entity:businessunit");
    expect(entityIds).toHaveLength(2);
  });

  it("skips entities without per-entity files in the env directory", () => {
    const result = parseSchemaIndex(schemaPath);
    const entityIds = result.nodes
      .filter((n) => n.type === NodeType.DataverseEntity)
      .map((n) => n.id);
    expect(entityIds).not.toContain("dataverse_entity:alm_notinenv");
  });

  it("creates attribute nodes for each attribute in an entity", () => {
    const result = parseSchemaIndex(schemaPath);
    const attrNodes = result.nodes.filter((n) => n.type === NodeType.DataverseAttribute);
    // alm_organization has 5 attributes, businessunit has 3
    expect(attrNodes.length).toBe(8);
    expect(attrNodes.map((n) => n.id)).toContain(
      "dataverse_attribute:alm_organization.alm_name"
    );
    expect(attrNodes.map((n) => n.id)).toContain(
      "dataverse_attribute:businessunit.name"
    );
  });

  it("creates HasAttribute edges from entity to each attribute", () => {
    const result = parseSchemaIndex(schemaPath);
    const hasAttrEdges = result.edges.filter((e) => e.type === EdgeType.HasAttribute);
    expect(hasAttrEdges.length).toBe(8);
    const orgToName = hasAttrEdges.find(
      (e) =>
        e.from === "dataverse_entity:alm_organization" &&
        e.to === "dataverse_attribute:alm_organization.alm_name"
    );
    expect(orgToName).toBeDefined();
  });

  it("populates entity node metadata from index", () => {
    const result = parseSchemaIndex(schemaPath);
    const orgNode = result.nodes.find(
      (n) => n.id === "dataverse_entity:alm_organization"
    );
    expect(orgNode).toBeDefined();
    expect(orgNode!.metadata.displayName).toBe("Organization");
    expect(orgNode!.metadata.entitySetName).toBe("alm_organizations");
    expect(orgNode!.metadata.primaryId).toBe("alm_organizationid");
    expect(orgNode!.metadata.primaryName).toBe("alm_name");
    expect(orgNode!.metadata.attributeCount).toBe(5);
    expect(orgNode!.metadata.schemaFile).toBe("alm_organization.json");
  });

  it("populates attribute node metadata with entityLogicalName", () => {
    const result = parseSchemaIndex(schemaPath);
    const attrNode = result.nodes.find(
      (n) => n.id === "dataverse_attribute:alm_organization.alm_name"
    );
    expect(attrNode).toBeDefined();
    expect(attrNode!.metadata.entityLogicalName).toBe("alm_organization");
  });

  it("reports entityCount in result", () => {
    const result = parseSchemaIndex(schemaPath);
    expect(result.entityCount).toBe(2);
  });

  it("returns a warning when _index.json is not found", () => {
    const result = parseSchemaIndex("/nonexistent/path/test-env");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/_index\.json/);
  });
});

describe("loadEntityDetail", () => {
  beforeEach(() => {
    clearEntityDetailCache();
  });

  it("loads attribute details from per-entity file", () => {
    const detail = loadEntityDetail(schemaPath, "alm_organization.json");
    expect(detail).not.toBeNull();
    expect(detail!.logicalName).toBe("alm_organization");
    const alm_name = detail!.attributes.find(
      (a) => a.logicalName === "alm_name"
    );
    expect(alm_name).toBeDefined();
    expect(alm_name!.attributeType).toBe("String");
    expect(alm_name!.requiredLevel).toBe("Required");
    expect(alm_name!.isValidForCreate).toBe(true);
    expect(alm_name!.isValidForUpdate).toBe(true);
    expect(alm_name!.isCustomAttribute).toBe(true);
    expect(alm_name!.displayName).toBe("Name");
  });

  it("identifies read-only attributes (createdon: create=false, update=false)", () => {
    const detail = loadEntityDetail(schemaPath, "alm_organization.json");
    expect(detail).not.toBeNull();
    const createdon = detail!.attributes.find(
      (a) => a.logicalName === "createdon"
    );
    expect(createdon).toBeDefined();
    expect(createdon!.isValidForCreate).toBe(false);
    expect(createdon!.isValidForUpdate).toBe(false);
  });

  it("returns null for nonexistent file", () => {
    const detail = loadEntityDetail(schemaPath, "does_not_exist.json");
    expect(detail).toBeNull();
  });

  it("caches results across repeated calls", () => {
    const first = loadEntityDetail(schemaPath, "alm_organization.json");
    const second = loadEntityDetail(schemaPath, "alm_organization.json");
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
