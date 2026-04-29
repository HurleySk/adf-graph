import { describe, it, expect } from "vitest";
import {
  stripSqlComments,
  extractDestQueryAliases,
  extractCaseValues,
  extractCaseElseValue,
} from "../../src/parsers/destQueryParser.js";

describe("stripSqlComments", () => {
  it("removes -- comments", () => {
    const sql = "SELECT a\n-- this is a comment\nFROM t";
    expect(stripSqlComments(sql)).toBe("SELECT a\n\nFROM t");
  });

  it("preserves -- inside string literals", () => {
    const sql = "SELECT 'foo--bar' AS x FROM t";
    expect(stripSqlComments(sql)).toBe(sql);
  });

  it("handles mid-line comments", () => {
    const sql = "SELECT a AS x, -- inline comment\nb AS y FROM t";
    expect(stripSqlComments(sql)).toBe("SELECT a AS x, \nb AS y FROM t");
  });
});

describe("extractDestQueryAliases", () => {
  it("extracts simple aliases", () => {
    const sql = "SELECT org_id AS alm_orgid, org_name AS alm_name FROM dbo.Staging";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(2);
    expect(result.aliases[0]).toMatchObject({ alias: "alm_orgid", isCaseExpression: false });
    expect(result.aliases[1]).toMatchObject({ alias: "alm_name", isCaseExpression: false });
    expect(result.warnings).toHaveLength(0);
  });

  it("handles CAST(x AS type) AS alias without confusing inner AS", () => {
    const sql = "SELECT CAST(col AS int) AS my_col FROM t";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("my_col");
    expect(result.aliases[0].expression).toBe("CAST(col AS int)");
  });

  it("handles CASE WHEN ... END AS alias", () => {
    const sql =
      "SELECT CASE WHEN status = 'A' THEN 1 WHEN status = 'I' THEN 2 END AS statuscode FROM t";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("statuscode");
    expect(result.aliases[0].isCaseExpression).toBe(true);
  });

  it("handles mixed expressions", () => {
    const sql = `SELECT
      org_id AS alm_orgid,
      CASE WHEN x = 1 THEN 100 ELSE 200 END AS statuscode,
      CAST(y AS varchar) AS alm_name
    FROM dbo.Staging`;
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(3);
    expect(result.aliases[0].alias).toBe("alm_orgid");
    expect(result.aliases[1].alias).toBe("statuscode");
    expect(result.aliases[1].isCaseExpression).toBe(true);
    expect(result.aliases[2].alias).toBe("alm_name");
  });

  it("handles bracket-quoted aliases", () => {
    const sql = "SELECT col AS [my alias] FROM t";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("my alias");
  });

  it("handles double-quoted aliases", () => {
    const sql = 'SELECT col AS "my alias" FROM t';
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("my alias");
  });

  it("warns on expressions without aliases", () => {
    const sql = "SELECT bare_col, other AS aliased FROM t";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("aliased");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("bare_col");
  });

  it("strips comments before parsing", () => {
    const sql = "SELECT\n-- skip this\norg_id AS alm_orgid FROM t";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("alm_orgid");
  });

  it("warns when no SELECT clause found", () => {
    const result = extractDestQueryAliases("INSERT INTO t VALUES (1)");
    expect(result.aliases).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("handles SELECT TOP N", () => {
    const sql = "SELECT TOP 100 org_id AS alm_orgid FROM t";
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("alm_orgid");
  });

  it("handles nested CASE inside CASE", () => {
    const sql = `SELECT CASE WHEN a = 1 THEN CASE WHEN b = 2 THEN 10 ELSE 20 END ELSE 30 END AS nested_val FROM t`;
    const result = extractDestQueryAliases(sql);
    expect(result.aliases).toHaveLength(1);
    expect(result.aliases[0].alias).toBe("nested_val");
    expect(result.aliases[0].isCaseExpression).toBe(true);
  });
});

describe("extractCaseValues", () => {
  it("extracts THEN integer values", () => {
    const expr = "CASE WHEN status = 'Active' THEN 1 WHEN status = 'Inactive' THEN 2 END";
    const values = extractCaseValues(expr);
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ thenValue: 1, whenCondition: "status = 'Active'" });
    expect(values[1]).toMatchObject({ thenValue: 2, whenCondition: "status = 'Inactive'" });
  });

  it("handles negative values", () => {
    const expr = "CASE WHEN x = 1 THEN -1 END";
    const values = extractCaseValues(expr);
    expect(values).toHaveLength(1);
    expect(values[0].thenValue).toBe(-1);
  });

  it("returns empty for no CASE pattern", () => {
    expect(extractCaseValues("col_name")).toHaveLength(0);
  });
});

describe("extractCaseElseValue", () => {
  it("extracts ELSE integer", () => {
    const expr = "CASE WHEN x = 1 THEN 1 ELSE 0 END";
    expect(extractCaseElseValue(expr)).toBe(0);
  });

  it("returns undefined when no ELSE", () => {
    const expr = "CASE WHEN x = 1 THEN 1 END";
    expect(extractCaseElseValue(expr)).toBeUndefined();
  });
});
