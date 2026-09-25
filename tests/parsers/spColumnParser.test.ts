import { describe, it, expect } from "vitest";
import { parseSpBody, SpParseResult } from "../../src/parsers/spColumnParser.js";

describe("parseSpBody", () => {
  /* ───────── UPDATE ───────── */

  describe("UPDATE statements", () => {
    it("reads only FROM/JOIN table references, not aliases or ON-clause keywords", () => {
      const sql = `
        UPDATE s
        SET s.code = CAST(m.code AS varchar(10))
        FROM dbo.Staging s
        INNER JOIN dbo.Matches AS m ON m.id = s.id AND m.kind IS NOT NULL
        LEFT JOIN (SELECT id FROM dbo.Extra) x ON x.id = s.id OR x.id IS NULL
        WHERE s.active = 1;
      `;
      const result = parseSpBody("p_Update_From_Join", sql);
      expect(result.writeTables).toEqual(["dbo.Staging"]);
      expect(result.readTables.sort()).toEqual(["dbo.Extra", "dbo.Matches"]);
    });

    it("does not spill the FROM clause into the next statement", () => {
      const sql = `
        UPDATE s SET s.a = m.a FROM dbo.S s JOIN dbo.M m ON m.id = s.id

        UPDATE dbo.T SET x = 1, y = 2 WHERE z = 3
        UPDATE s2 SET s2.a = m.a FROM dbo.S2 s2 JOIN dbo.M m ON m.id = s2.id
        INSERT INTO dbo.Z (c1, c2) SELECT q1, q2 FROM dbo.Q
      `;
      const result = parseSpBody("p_No_Spill", sql);
      expect(result.readTables.sort()).toEqual(["dbo.M", "dbo.Q"]);
      expect(result.writeTables.sort()).toEqual(["dbo.S", "dbo.S2", "dbo.T", "dbo.Z"]);
    });

    it("keeps assignments after a CASE...END and still reads the FROM tables", () => {
      const sql = `
        UPDATE t SET t.a = CASE WHEN m.x = 1 THEN 1 ELSE 0 END, t.b = m.b
        FROM dbo.T t JOIN dbo.M m ON m.id = t.id;
      `;
      const result = parseSpBody("p_Case_Set", sql);
      expect(result.mappings.map((m) => m.targetColumn)).toEqual(["a", "b"]);
      expect(result.readTables).toEqual(["dbo.M"]);
      expect(result.writeTables).toEqual(["dbo.T"]);
    });

    it("scans JOINs after a derived table containing WHERE", () => {
      const sql = `
        UPDATE t SET a = m.a
        FROM dbo.T t
        JOIN (SELECT id, a FROM dbo.M WHERE f = 1) m ON m.id = t.id
        INNER JOIN dbo.Other o ON o.id = t.id
        WHERE t.z = 1;
      `;
      const result = parseSpBody("p_Derived_Where", sql);
      expect(result.readTables.sort()).toEqual(["dbo.M", "dbo.Other"]);
    });

    it("reads tables from subqueries in the SET and WHERE clauses", () => {
      const sql = `
        UPDATE dbo.Run
        SET [Status] = CASE WHEN EXISTS (SELECT 1 FROM dbo.Result WHERE RunId = @RunId) THEN '' ELSE '' END,
            [Done] = done_flag
        WHERE RunId IN (SELECT RunId FROM dbo.Pending)
      `;
      const result = parseSpBody("p_Subquery_Reads", sql);
      expect(result.readTables.sort()).toEqual(["dbo.Pending", "dbo.Result"]);
      expect(result.mappings.map((m) => m.targetColumn)).toEqual(["Status", "Done"]);
    });

    it("does not treat table-valued functions as tables", () => {
      const sql = `
        UPDATE t SET t.a = j.a
        FROM dbo.T t CROSS APPLY OPENJSON(t.payload) j;
      `;
      const result = parseSpBody("p_Apply_Fn", sql);
      expect(result.readTables).toEqual([]);
    });

    it("reads comma-joined tables but not subquery select-list columns", () => {
      const sql = `
        UPDATE target
        SET target.code = source.code
        FROM dbo.Target_Staging as target,
        dbo.Source_Staging as source,
        (SELECT id, code FROM dbo.Lookup) lk
        WHERE target.id = source.id AND lk.id = source.id;
      `;
      const result = parseSpBody("p_Update_Comma_Join", sql);
      expect(result.writeTables).toEqual(["dbo.Target_Staging"]);
      expect(result.readTables.sort()).toEqual(["dbo.Lookup", "dbo.Source_Staging"]);
    });

    it("extracts simple UPDATE SET assignments", () => {
      const sql = `
        CREATE PROCEDURE [dbo].[p_Simple_Update]
        AS
        BEGIN
          UPDATE dbo.Target
          SET col_a = col_b, col_c = col_d
          WHERE id IS NOT NULL;
        END
      `;
      const result = parseSpBody("p_Simple_Update", sql);

      expect(result.storedProcedure).toBe("p_Simple_Update");
      expect(result.writeTables).toContain("dbo.Target");
      expect(result.mappings).toHaveLength(2);
      expect(result.mappings[0]).toEqual({
        sourceTable: "dbo.Target",
        sourceColumn: "col_b",
        targetTable: "dbo.Target",
        targetColumn: "col_a",
      });
      expect(result.mappings[1]).toEqual({
        sourceTable: "dbo.Target",
        sourceColumn: "col_d",
        targetTable: "dbo.Target",
        targetColumn: "col_c",
      });
      expect(result.confidence).toBe("high");
    });

    it("extracts transform expressions like UPPER(LTRIM(RTRIM(col)))", () => {
      const sql = `
        CREATE PROCEDURE [dbo].[p_Transform_Org]
        AS
        BEGIN
          SET NOCOUNT ON;
          UPDATE dbo.Org_Staging
          SET
            org_type_code = UPPER(LTRIM(RTRIM(org_type_code))),
            is_ready = 1
          WHERE org_id IS NOT NULL AND org_name IS NOT NULL AND is_ready = 0;
        END
      `;
      const result = parseSpBody("p_Transform_Org", sql);

      expect(result.writeTables).toContain("dbo.Org_Staging");
      expect(result.confidence).toBe("high");

      // Should find the org_type_code mapping with transform
      const orgTypeMapping = result.mappings.find(
        (m) => m.targetColumn === "org_type_code"
      );
      expect(orgTypeMapping).toBeDefined();
      expect(orgTypeMapping!.sourceColumn).toBe("org_type_code");
      expect(orgTypeMapping!.transformExpression).toBe(
        "UPPER(LTRIM(RTRIM(org_type_code)))"
      );
    });

    it("handles bracket-quoted table/column names", () => {
      const sql = `
        UPDATE [dbo].[My Table]
        SET [Column A] = [Column B]
        WHERE [ID] > 0;
      `;
      const result = parseSpBody("p_Brackets", sql);

      expect(result.writeTables).toContain("dbo.My Table");
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0].targetColumn).toBe("Column A");
      expect(result.mappings[0].sourceColumn).toBe("Column B");
    });
  });

  /* ───────── INSERT INTO … SELECT ───────── */

  describe("INSERT INTO … SELECT statements", () => {
    it("extracts positional column mappings from INSERT…SELECT", () => {
      const sql = `
        CREATE PROCEDURE dbo.p_Insert_Stage
        AS
        BEGIN
          INSERT INTO dbo.Staging (name, code, status)
          SELECT org_name, org_code, org_status
          FROM dbo.Source;
        END
      `;
      const result = parseSpBody("p_Insert_Stage", sql);

      expect(result.writeTables).toContain("dbo.Staging");
      expect(result.readTables).toContain("dbo.Source");
      expect(result.mappings).toHaveLength(3);

      expect(result.mappings[0]).toEqual({
        sourceTable: "dbo.Source",
        sourceColumn: "org_name",
        targetTable: "dbo.Staging",
        targetColumn: "name",
      });
      expect(result.mappings[1]).toEqual({
        sourceTable: "dbo.Source",
        sourceColumn: "org_code",
        targetTable: "dbo.Staging",
        targetColumn: "code",
      });
      expect(result.mappings[2]).toEqual({
        sourceTable: "dbo.Source",
        sourceColumn: "org_status",
        targetTable: "dbo.Staging",
        targetColumn: "status",
      });
      expect(result.confidence).toBe("high");
    });

    it("extracts transform expressions in SELECT list", () => {
      const sql = `
        INSERT INTO dbo.Target (full_name, upper_code)
        SELECT CONCAT(first, last), UPPER(code)
        FROM dbo.Source;
      `;
      const result = parseSpBody("p_TransformInsert", sql);

      expect(result.mappings).toHaveLength(2);
      // CONCAT(first, last) — innermost extraction gets 'last' (last paren content)
      // The important thing is the transformExpression is preserved
      expect(result.mappings[0].targetColumn).toBe("full_name");
      expect(result.mappings[0].transformExpression).toBe("CONCAT(first, last)");
      expect(result.mappings[1].targetColumn).toBe("upper_code");
      expect(result.mappings[1].sourceColumn).toBe("code");
      expect(result.mappings[1].transformExpression).toBe("UPPER(code)");
    });
  });

  /* ───────── MERGE ───────── */

  describe("MERGE statements", () => {
    it("extracts mappings from WHEN MATCHED UPDATE SET clause", () => {
      const sql = `
        MERGE dbo.Target AS t
        USING dbo.Source AS s
        ON t.id = s.id
        WHEN MATCHED THEN
          UPDATE SET t.name = s.name, t.code = UPPER(s.code)
        WHEN NOT MATCHED THEN
          INSERT (id, name, code)
          VALUES (s.id, s.name, UPPER(s.code));
      `;
      const result = parseSpBody("p_Merge_Example", sql);

      expect(result.writeTables).toContain("dbo.Target");
      expect(result.readTables).toContain("dbo.Source");

      // WHEN MATCHED: t.name = s.name, t.code = UPPER(s.code)
      const nameMapping = result.mappings.find(
        (m) => m.targetColumn === "name" && !m.transformExpression
      );
      expect(nameMapping).toBeDefined();
      expect(nameMapping!.sourceColumn).toBe("name");
      expect(nameMapping!.sourceTable).toBe("dbo.Source");

      const codeMapping = result.mappings.find(
        (m) => m.targetColumn === "code" && m.transformExpression !== undefined
      );
      expect(codeMapping).toBeDefined();
      expect(codeMapping!.sourceColumn).toBe("code");
      expect(codeMapping!.transformExpression).toBe("UPPER(s.code)");

      // WHEN NOT MATCHED: INSERT (id, name, code) VALUES (s.id, s.name, UPPER(s.code))
      const insertIdMapping = result.mappings.find(
        (m) => m.targetColumn === "id"
      );
      expect(insertIdMapping).toBeDefined();

      expect(result.confidence).toBe("high");
    });
  });

  /* ───────── Dynamic SQL / EXEC ───────── */

  describe("dynamic SQL detection", () => {
    it("sets confidence to low when EXEC( is present", () => {
      const sql = `
        CREATE PROCEDURE dbo.p_Dynamic
        AS
        BEGIN
          DECLARE @sql NVARCHAR(MAX) = 'UPDATE dbo.T SET a = 1';
          EXEC(@sql);
        END
      `;
      const result = parseSpBody("p_Dynamic", sql);

      expect(result.confidence).toBe("low");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("dynamic SQL");
    });

    it("sets confidence to low when sp_executesql is present", () => {
      const sql = `
        CREATE PROCEDURE dbo.p_Dynamic2
        AS
        BEGIN
          EXEC sp_executesql N'SELECT 1';
        END
      `;
      const result = parseSpBody("p_Dynamic2", sql);

      expect(result.confidence).toBe("low");
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  /* ───────── Confidence levels ───────── */

  describe("confidence levels", () => {
    it("high confidence when all DML is parsed", () => {
      const sql = `
        UPDATE dbo.T SET a = b WHERE id > 0;
      `;
      const result = parseSpBody("p_AllParsed", sql);
      expect(result.confidence).toBe("high");
    });

    it("high confidence when no DML statements present", () => {
      const sql = `
        CREATE PROCEDURE dbo.p_NoOp
        AS
        BEGIN
          SET NOCOUNT ON;
          -- Just a comment
        END
      `;
      const result = parseSpBody("p_NoOp", sql);
      expect(result.confidence).toBe("high");
      expect(result.mappings).toHaveLength(0);
    });

    it("medium confidence when some DML is unparsed", () => {
      // This has an UPDATE that will be parsed, plus a DELETE that won't be
      // But we only count UPDATE/INSERT/MERGE as DML for parsing.
      // Let's use an INSERT without SELECT pattern (INSERT VALUES) which won't be parsed
      const sql = `
        UPDATE dbo.T SET a = b WHERE id > 0;
        INSERT INTO dbo.T2 (x) SELECT y FROM dbo.S;
        INSERT INTO dbo.T3 VALUES (1, 2, 3);
      `;
      const result = parseSpBody("p_MixedParsed", sql);
      // 2 INSERT INTO + 1 UPDATE = 3 statements; 2 parsed (UPDATE + INSERT...SELECT)
      expect(result.confidence).toBe("medium");
    });
  });

  /* ───────── Fixture SP file ───────── */

  describe("fixture SP: p_Transform_Org", () => {
    it("parses the actual fixture SQL correctly", () => {
      const sql = `CREATE PROCEDURE [dbo].[p_Transform_Org]
AS
BEGIN
    SET NOCOUNT ON;

    -- Normalize org type codes and flag rows ready for Dataverse upsert
    UPDATE dbo.Org_Staging
    SET
        org_type_code = UPPER(LTRIM(RTRIM(org_type_code))),
        is_ready = 1
    WHERE
        org_id IS NOT NULL
        AND org_name IS NOT NULL
        AND is_ready = 0;
END`;

      const result = parseSpBody("p_Transform_Org", sql);

      expect(result.storedProcedure).toBe("p_Transform_Org");
      expect(result.writeTables).toContain("dbo.Org_Staging");
      expect(result.confidence).toBe("high");
      expect(result.warnings).toHaveLength(0);

      // Should map org_type_code with transform expression
      const mapping = result.mappings.find(
        (m) => m.targetColumn === "org_type_code"
      );
      expect(mapping).toBeDefined();
      expect(mapping!.sourceColumn).toBe("org_type_code");
      expect(mapping!.transformExpression).toContain("UPPER");
    });
  });

  describe("CTEs", () => {
    it("excludes CTE names from read and write tables", () => {
      const sql = `
;WITH P0 AS (SELECT id, name FROM dbo.Staff),
[Ranked] (id, name) AS (SELECT id, name FROM P0 JOIN dbo.Roster r ON r.id = P0.id)
INSERT INTO dbo.Matches (id, name)
SELECT id, name FROM ranked;
UPDATE t SET t.flag = 1 FROM dbo.Target t JOIN P0 ON P0.id = t.id;`;
      const result = parseSpBody("p_Cte", sql);
      const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
      expect(lower(result.readTables)).not.toContain("p0");
      expect(lower(result.readTables)).not.toContain("ranked");
      expect(result.writeTables).toContain("dbo.Matches");
      expect(result.writeTables).toContain("dbo.Target");
    });
  });
});
