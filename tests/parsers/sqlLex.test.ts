import { describe, it, expect } from "vitest";
import {
  stripSqlComments,
  splitTopLevelCommas,
  splitTrailingAlias,
  findTopLevelKeyword,
} from "../../src/parsers/sqlLex.js";
import { extractDestQueryAliases } from "../../src/parsers/destQueryParser.js";
import { extractSourceQueryColumns } from "../../src/parsers/sourceQueryParser.js";
import { parseTableDdl } from "../../src/parsers/tableDdlParser.js";
import { extractWhereClause } from "../../src/parsers/sqlWhereParser.js";
import { parseSpBody } from "../../src/parsers/spColumnParser.js";

describe("stripSqlComments", () => {
  it("removes block comments", () => {
    expect(stripSqlComments("a, /* b, */ c")).toBe("a,   c");
  });

  it("handles nested block comments", () => {
    expect(stripSqlComments("a /* x /* y */ z */ b")).toBe("a   b");
  });

  it("ignores quotes and line comments inside block comments", () => {
    expect(stripSqlComments("a /* it's --x */ b")).toBe("a   b");
  });

  it("keeps comment markers inside string literals", () => {
    expect(stripSqlComments("SELECT '--a' AS x, '/*b*/' AS y")).toBe("SELECT '--a' AS x, '/*b*/' AS y");
  });
});

describe("splitTopLevelCommas", () => {
  it("does not split inside string literals", () => {
    expect(splitTopLevelCommas("'a,b' AS x, c")).toEqual(["'a,b' AS x", "c"]);
  });

  it("does not split inside bracketed identifiers", () => {
    expect(splitTopLevelCommas("[a,b] AS x, c")).toEqual(["[a,b] AS x", "c"]);
  });

  it("handles END immediately followed by a comma", () => {
    expect(splitTopLevelCommas("CASE WHEN a THEN 1 ELSE 2 END, b")).toEqual(["CASE WHEN a THEN 1 ELSE 2 END", "b"]);
  });

  it("does not treat CASE inside an identifier as a keyword", () => {
    expect(splitTopLevelCommas("UPPERCASE AS a, b")).toEqual(["UPPERCASE AS a", "b"]);
  });
});

describe("splitTrailingAlias", () => {
  it("ignores AS inside CAST and CASE", () => {
    expect(splitTrailingAlias("CAST(x AS int) AS y")).toEqual({ expression: "CAST(x AS int)", alias: "y" });
  });

  it("unquotes bracketed aliases", () => {
    expect(splitTrailingAlias("a AS [my col]")).toEqual({ expression: "a", alias: "my col" });
  });
});

describe("findTopLevelKeyword", () => {
  it("ignores keywords inside strings and identifiers", () => {
    const sql = "SELECT 'from x' AS a, DateFROM AS b FROM t";
    expect(findTopLevelKeyword(sql, "FROM")).toBe(sql.lastIndexOf("FROM"));
  });
});

describe("parser integration", () => {
  it("dest_query ignores columns inside nested block comments", () => {
    const sql = "SELECT a AS x,\n/*CASE WHEN b /* inner */ THEN 1 END AS y,*/\nc AS z FROM t";
    expect(extractDestQueryAliases(sql).aliases.map((a) => a.alias)).toEqual(["x", "z"]);
  });

  it("dest_query handles string literals containing commas", () => {
    const sql = "SELECT CONCAT(a, ',', b) AS x, 'p,q' AS y FROM t";
    expect(extractDestQueryAliases(sql).aliases.map((a) => a.alias)).toEqual(["x", "y"]);
  });

  it("source_query ignores block comments", () => {
    const sql = "SELECT a, /* b, */ c FROM t";
    expect(extractSourceQueryColumns(sql).columns.map((c) => c.effectiveName)).toEqual(["a", "c"]);
  });

  it("DDL parser does not split default literals", () => {
    const ddl = "CREATE TABLE dbo.T ([a] INT, [b] VARCHAR(10) DEFAULT 'x,y', [c] INT)";
    expect(parseTableDdl(ddl).columns).toEqual(["a", "b", "c"]);
  });

  it("EXISTS subquery resolves its table", () => {
    const where = extractWhereClause("SELECT * FROM dbo.T WHERE NOT EXISTS (SELECT 1 FROM dbo.Other o WHERE o.id = T.id)");
    expect(where!.conditions[0].subqueryTable).toBe("dbo.Other");
  });

  it("unqualified IN subquery table gets dbo schema", () => {
    const where = extractWhereClause("SELECT * FROM dbo.T WHERE id NOT IN (SELECT id FROM Other)");
    expect(where!.conditions[0].subqueryTable).toBe("dbo.Other");
  });

  it("UPDATE strips alias prefix from target columns", () => {
    const result = parseSpBody("p", "UPDATE u SET u.col = s.val FROM dbo.U u JOIN dbo.S s ON u.id = s.id;");
    expect(result.mappings.map((m) => m.targetColumn)).toEqual(["col"]);
  });
});

describe("review regressions", () => {
  it("ignores apostrophes inside DDL comments", () => {
    const ddl = "CREATE TABLE dbo.T ([a] INT,\n -- don't touch\n [b] INT, [c] VARCHAR(10) DEFAULT 'x', [d] INT)";
    expect(parseTableDdl(ddl).columns).toEqual(["a", "b", "c", "d"]);
  });

  it("does not take a column ending in 'from' as the subquery table", () => {
    const where = extractWhereClause("SELECT * FROM dbo.X WHERE id IN (SELECT ValidFrom FROM dbo.CDC_X_Current)");
    expect(where!.conditions[0].subqueryTable).toBe("dbo.CDC_X_Current");
  });

  it("matches keywords after characters whose uppercase form is longer", () => {
    const { aliases } = extractDestQueryAliases("SELECT a AS x, 'Straße' AS y, b AS z FROM t");
    expect(aliases.map((a) => a.alias)).toEqual(["x", "y", "z"]);
  });

  it("skips commas inside comments when splitting", () => {
    expect(splitTopLevelCommas("a, -- b, c\n d")).toEqual(["a", "-- b, c\n d"]);
  });
});
