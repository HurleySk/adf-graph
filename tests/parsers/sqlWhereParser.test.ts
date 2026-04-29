import { describe, it, expect } from "vitest";
import { extractWhereClause } from "../../src/parsers/sqlWhereParser.js";

describe("extractWhereClause", () => {
  it("returns null for SQL without WHERE", () => {
    const result = extractWhereClause("SELECT * FROM dbo.Work_Item");
    expect(result).toBeNull();
  });

  it("extracts simple equality condition", () => {
    const result = extractWhereClause("SELECT * FROM dbo.Work_Item WHERE status = 3");
    expect(result).not.toBeNull();
    expect(result!.raw).toBe("status = 3");
    expect(result!.conditions).toHaveLength(1);
    expect(result!.conditions[0].column).toBe("status");
    expect(result!.conditions[0].operator).toBe("=");
    expect(result!.conditions[0].value).toBe("3");
    expect(result!.conditions[0].connector).toBe("");
  });

  it("extracts NOT IN condition", () => {
    const result = extractWhereClause(
      "SELECT * FROM dbo.Work_Item WHERE Type_fk NOT IN (3,4,5,7)"
    );
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(1);
    expect(result!.conditions[0].operator).toBe("NOT IN");
    expect(result!.conditions[0].value).toBe("(3,4,5,7)");
    expect(result!.conditions[0].isSubquery).toBe(false);
  });

  it("extracts compound AND/OR conditions", () => {
    const sql = "SELECT * FROM dbo.T WHERE a = 1 AND b = 2 OR c = 3";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(3);
    expect(result!.conditions[0].connector).toBe("");
    expect(result!.conditions[1].connector).toBe("AND");
    expect(result!.conditions[2].connector).toBe("OR");
  });

  it("detects subquery in IN clause", () => {
    const sql = "SELECT * FROM dbo.T WHERE id IN (SELECT id FROM dbo.Other)";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(1);
    expect(result!.conditions[0].isSubquery).toBe(true);
    expect(result!.conditions[0].subqueryTable).toBe("dbo.Other");
  });

  it("stops at GROUP BY", () => {
    const sql = "SELECT * FROM dbo.T WHERE status = 1 GROUP BY status";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe("status = 1");
  });

  it("stops at ORDER BY", () => {
    const sql = "SELECT * FROM dbo.T WHERE status = 1 ORDER BY name";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe("status = 1");
  });

  it("handles IS NULL and IS NOT NULL", () => {
    const sql = "SELECT * FROM dbo.T WHERE a IS NULL AND b IS NOT NULL";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(2);
    expect(result!.conditions[0].operator).toBe("IS NULL");
    expect(result!.conditions[1].operator).toBe("IS NOT NULL");
  });

  it("handles real CDC dest_query pattern with escape hatches", () => {
    const sql = `SELECT a.Work_Item_id AS pcx_workitemid
      FROM dbo.Agenda_Work_Item_Staging a
      WHERE a.Work_Item_Type_fk NOT IN (3,4,5,7)
      AND a.Status_fk = 3
      OR a.Work_Item_id IN (SELECT Work_Item_id FROM dbo.Agenda_Additional_Work_Item_Staging)`;
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.conditions.length).toBeGreaterThanOrEqual(3);

    const orCondition = result!.conditions.find((c) => c.connector === "OR");
    expect(orCondition).toBeDefined();
    expect(orCondition!.isSubquery).toBe(true);
    expect(orCondition!.subqueryTable).toBe("dbo.Agenda_Additional_Work_Item_Staging");
  });

  it("handles BETWEEN operator", () => {
    const sql = "SELECT * FROM dbo.T WHERE date BETWEEN '2024-01-01' AND '2024-12-31'";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(1);
    expect(result!.conditions[0].operator).toBe("BETWEEN");
  });

  it("handles comparison operators", () => {
    const sql = "SELECT * FROM dbo.T WHERE a >= 10 AND b <> 'test'";
    const result = extractWhereClause(sql);
    expect(result).not.toBeNull();
    expect(result!.conditions).toHaveLength(2);
    expect(result!.conditions[0].operator).toBe(">=");
    expect(result!.conditions[1].operator).toBe("<>");
  });
});
