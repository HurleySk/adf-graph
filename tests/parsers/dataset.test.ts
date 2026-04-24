import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDatasetFile } from "../../src/parsers/dataset.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/dataset");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf-8"));
}

describe("parseDatasetFile", () => {
  it("extracts dataset node from SQL table dataset (name, datasetType metadata)", () => {
    const result = parseDatasetFile(loadFixture("ds-sql-table.json"));
    const node = result.nodes.find((n) => n.id === "dataset:ds_sql_staging");
    expect(node).toBeDefined();
    expect(node!.name).toBe("ds_sql_staging");
    expect(node!.metadata.datasetType).toBe("AzureSqlTable");
  });

  it("extracts linked service edge from SQL table dataset", () => {
    const result = parseDatasetFile(loadFixture("ds-sql-table.json"));
    const lsEdge = result.edges.find((e) => e.type === "uses_linked_service");
    expect(lsEdge).toBeDefined();
    expect(lsEdge!.from).toBe("dataset:ds_sql_staging");
    expect(lsEdge!.to).toBe("linked_service:ls_sql_staging");
  });

  it("extracts dataset node from Dataverse dataset", () => {
    const result = parseDatasetFile(loadFixture("ds-dataverse.json"));
    const node = result.nodes.find((n) => n.id === "dataset:ds_dataverse");
    expect(node).toBeDefined();
    expect(node!.metadata.datasetType).toBe("CommonDataServiceForAppsEntity");
  });

  it("captures parameter definitions in metadata", () => {
    const result = parseDatasetFile(loadFixture("ds-sql-table.json"));
    const node = result.nodes.find((n) => n.id === "dataset:ds_sql_staging");
    expect(node).toBeDefined();
    const params = node!.metadata.parameters as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(Object.keys(params)).toContain("schema_name");
    expect(Object.keys(params)).toContain("table_name");
  });
});
