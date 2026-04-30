import { describe, it, expect } from "vitest";
import { extractSourceQueryColumns } from "../../src/parsers/sourceQueryParser.js";

describe("extractSourceQueryColumns", () => {
  it("extracts aliased columns (col AS alias)", () => {
    const sql = "SELECT a.Work_Item_id AS Work_Item_id, b.Name AS Staff_Name FROM dbo.T a";
    const result = extractSourceQueryColumns(sql);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].effectiveName).toBe("Work_Item_id");
    expect(result.columns[0].hasExplicitAlias).toBe(true);
    expect(result.columns[1].effectiveName).toBe("Staff_Name");
  });

  it("extracts table.column patterns without AS", () => {
    const sql = `SELECT
      a.Work_Item_fk,
      a.FERC_Staff_fk,
      a.Inactive_Date
    FROM dbo.Work_Item_FERC_Staff a`;
    const result = extractSourceQueryColumns(sql);
    expect(result.columns).toHaveLength(3);
    expect(result.columns[0].effectiveName).toBe("Work_Item_fk");
    expect(result.columns[1].effectiveName).toBe("FERC_Staff_fk");
    expect(result.columns[2].effectiveName).toBe("Inactive_Date");
    expect(result.columns[2].hasExplicitAlias).toBe(false);
  });

  it("extracts bare column names", () => {
    const sql = "SELECT County_cd, County_Name, Active_Date FROM dbo.County";
    const result = extractSourceQueryColumns(sql);
    expect(result.columns.map((c) => c.effectiveName)).toEqual([
      "County_cd", "County_Name", "Active_Date",
    ]);
    expect(result.columns.every((c) => !c.hasExplicitAlias)).toBe(true);
  });

  it("warns on SELECT *", () => {
    const sql = "SELECT * FROM dbo.T";
    const result = extractSourceQueryColumns(sql);
    expect(result.columns).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("*");
  });

  it("handles CASE expressions with aliases", () => {
    const sql = `SELECT
      CASE WHEN a.Status = 1 THEN 'Active' ELSE 'Inactive' END AS StatusLabel,
      a.Name
    FROM dbo.T a`;
    const result = extractSourceQueryColumns(sql);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].effectiveName).toBe("StatusLabel");
    expect(result.columns[0].hasExplicitAlias).toBe(true);
    expect(result.columns[1].effectiveName).toBe("Name");
  });

  it("handles mixed aliased and bare columns", () => {
    const sql = `SELECT
      a.Work_Item_FERC_Staff_id as Work_Item_FERC_Staff_id,
      a.Work_Item_fk,
      a.FERC_Staff_fk,
      b.Work_Item_FERC_Staff_fk,
      a.Inactive_Date
    FROM dbo.Work_Item_FERC_Staff a
    JOIN dbo.Other b ON a.id = b.id`;
    const result = extractSourceQueryColumns(sql);
    expect(result.columns.map((c) => c.effectiveName)).toEqual([
      "Work_Item_FERC_Staff_id",
      "Work_Item_fk",
      "FERC_Staff_fk",
      "Work_Item_FERC_Staff_fk",
      "Inactive_Date",
    ]);
    expect(result.columns[0].hasExplicitAlias).toBe(true);
    expect(result.columns[1].hasExplicitAlias).toBe(false);
  });

  it("handles bracket-quoted aliases", () => {
    const sql = "SELECT a.col AS [My Column] FROM dbo.T a";
    const result = extractSourceQueryColumns(sql);
    expect(result.columns[0].effectiveName).toBe("My Column");
    expect(result.columns[0].hasExplicitAlias).toBe(true);
  });

  it("warns on missing SELECT clause", () => {
    const result = extractSourceQueryColumns("EXEC sp_foo");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("handles function calls with aliases", () => {
    const sql = "SELECT ISNULL(a.Name, '') AS Name, COUNT(*) AS Total FROM dbo.T a";
    const result = extractSourceQueryColumns(sql);
    expect(result.columns[0].effectiveName).toBe("Name");
    expect(result.columns[1].effectiveName).toBe("Total");
  });
});
