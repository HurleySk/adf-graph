import { describe, it, expect } from "vitest";
import { parseSqlParameter, isSqlParameter } from "../../src/utils/sqlParameterParser.js";

describe("isSqlParameter", () => {
  it("returns true for source_query and dest_query", () => {
    expect(isSqlParameter("source_query")).toBe(true);
    expect(isSqlParameter("dest_query")).toBe(true);
  });

  it("returns false for other parameter names", () => {
    expect(isSqlParameter("pre_copy_script")).toBe(false);
    expect(isSqlParameter("cdc_current_table")).toBe(false);
    expect(isSqlParameter("stored_procedure")).toBe(false);
    expect(isSqlParameter("dataverse_entity_name")).toBe(false);
  });
});

describe("parseSqlParameter", () => {
  it("extracts columns and tables from a basic SELECT", () => {
    const sql = "SELECT wi.Work_Item_id, wi.Work_Item_Name FROM dbo.Work_Item wi";
    const result = parseSqlParameter("source_query", sql);

    expect(result.parameterName).toBe("source_query");
    expect(result.sql).toBe(sql);
    expect(result.columns).toHaveLength(2);
    expect(result.columns.map((c) => c.effectiveName)).toEqual(["Work_Item_id", "Work_Item_Name"]);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].table).toBe("dbo.Work_Item");
    expect(result.tables[0].depth).toBe(0);
    expect(result.whereClause).toBeNull();
    expect(result.isCdcDependent).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("extracts WHERE clause conditions", () => {
    const sql = "SELECT a.id FROM dbo.Staging a WHERE a.status = 3 AND a.is_active = 1";
    const result = parseSqlParameter("dest_query", sql);

    expect(result.whereClause).not.toBeNull();
    expect(result.whereClause!.conditions).toHaveLength(2);
    expect(result.whereClause!.conditions[0].column).toBe("a.status");
    expect(result.whereClause!.conditions[0].operator).toBe("=");
    expect(result.whereClause!.conditions[0].value).toBe("3");
  });

  it("detects CDC dependency via subquery in WHERE clause", () => {
    const sql =
      "SELECT a.id FROM dbo.Staging a WHERE a.id IN (SELECT id FROM dbo.CDC_Work_Item_Current)";
    const result = parseSqlParameter("dest_query", sql);

    expect(result.isCdcDependent).toBe(true);
    expect(result.cdcDependencyTable).toBe("dbo.CDC_Work_Item_Current");
  });

  it("detects CDC dependency via depth>0 table when subquery extraction misses", () => {
    const sql =
      "SELECT a.id FROM dbo.Staging a WHERE a.id IN (SELECT id FROM dbo.CDC_Orders_Current WHERE active = 1)";
    const result = parseSqlParameter("dest_query", sql);

    expect(result.isCdcDependent).toBe(true);
    expect(result.cdcDependencyTable).toContain("CDC_Orders_Current");
  });

  it("returns isCdcDependent false for non-CDC queries", () => {
    const sql = "SELECT a.id, a.name FROM dbo.Staging a WHERE a.status = 1";
    const result = parseSqlParameter("dest_query", sql);

    expect(result.isCdcDependent).toBe(false);
    expect(result.cdcDependencyTable).toBeUndefined();
  });

  it("handles aliased columns", () => {
    const sql = "SELECT a.Work_Item_id AS pcx_workitemid, a.Name AS pcx_name FROM dbo.Staging a";
    const result = parseSqlParameter("dest_query", sql);

    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].effectiveName).toBe("pcx_workitemid");
    expect(result.columns[0].hasExplicitAlias).toBe(true);
    expect(result.columns[1].effectiveName).toBe("pcx_name");
  });

  it("reports warning for SELECT *", () => {
    const sql = "SELECT * FROM dbo.Staging";
    const result = parseSqlParameter("source_query", sql);

    expect(result.columns).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("SELECT *");
  });
});
