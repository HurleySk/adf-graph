import { describe, it, expect } from "vitest";
import { extractAllTablesFromSql, extractTablesFromSql } from "../../src/parsers/parseResult.js";

const tables = (sql: string) => extractAllTablesFromSql(sql).map((r) => r.table);

describe("extractAllTablesFromSql", () => {
  it("drops a CTE name but keeps the table it reads", () => {
    const sql = `WITH ranked AS (SELECT a.Id, ROW_NUMBER() OVER (PARTITION BY a.Id ORDER BY a.Dt) rn FROM dbo.Thing a)
                 SELECT r.Id FROM ranked r WHERE r.rn = 1`;
    expect(tables(sql)).toEqual(["dbo.Thing"]);
  });

  it("drops every CTE in a chain", () => {
    const sql = `WITH src AS (SELECT Id FROM dbo.A), c AS (SELECT src.Id FROM src JOIN dbo.B b ON b.Id = src.Id)
                 SELECT * FROM c`;
    expect(tables(sql).sort()).toEqual(["dbo.A", "dbo.B"]);
  });

  it("ignores FROM and JOIN inside comments", () => {
    const sql = `SELECT a.Id FROM dbo.A a --Add join for Work_Set later
                 /* JOIN dbo.Old o ON o.Id = a.Id */`;
    expect(tables(sql)).toEqual(["dbo.A"]);
  });

  it("ignores FROM inside string literals", () => {
    expect(tables(`SELECT 'copied from legacy' AS note, a.Id FROM dbo.A a`)).toEqual(["dbo.A"]);
  });

  it("keeps a schema-qualified table whose name matches a CTE", () => {
    expect(tables(`WITH Thing AS (SELECT Id FROM dbo.Thing) SELECT Id FROM Thing`)).toEqual(["dbo.Thing"]);
  });

  it("extractTablesFromSql still returns top-level tables only", () => {
    expect(extractTablesFromSql("SELECT a.Id FROM dbo.A a WHERE a.Id IN (SELECT Id FROM dbo.B)")).toEqual(["dbo.A"]);
  });
});
