import { describe, it, expect } from "vitest";
import { parseTableDdl } from "../../src/parsers/tableDdlParser.js";

describe("parseTableDdl", () => {
  it("extracts columns from standard CREATE TABLE", () => {
    const ddl = `CREATE TABLE [dbo].[Org_Staging] (
      [org_id]        NVARCHAR(50)   NOT NULL,
      [org_name]      NVARCHAR(255)  NOT NULL,
      [org_type_code] NVARCHAR(50)   NULL,
      CONSTRAINT [PK_Org_Staging] PRIMARY KEY CLUSTERED ([org_id] ASC)
    );`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["org_id", "org_name", "org_type_code"]);
    expect(result.warnings).toEqual([]);
  });

  it("handles bracket-quoted column names with spaces", () => {
    const ddl = `CREATE TABLE [dbo].[T](
      [Project Name] NVARCHAR(100) NULL,
      [id] INT NOT NULL
    )`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["project name", "id"]);
  });

  it("skips CONSTRAINT and PRIMARY KEY lines", () => {
    const ddl = `CREATE TABLE [dbo].[T](
      [id] INT NOT NULL,
      [name] VARCHAR(50) NULL,
      CONSTRAINT [PK_T] PRIMARY KEY CLUSTERED (
        [id] ASC
      )WITH (STATISTICS_NORECOMPUTE = OFF) ON [PRIMARY]
    ) ON [PRIMARY]`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["id", "name"]);
  });

  it("handles IDENTITY and DEFAULT inline", () => {
    const ddl = `CREATE TABLE [dbo].[T](
      [id] INT IDENTITY(1,1) NOT NULL,
      [is_active] BIT DEFAULT 1 NOT NULL,
      [created] DATETIME NOT NULL CONSTRAINT [DF_created] DEFAULT (GETDATE())
    )`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["id", "is_active", "created"]);
  });

  it("handles UTF-8 BOM", () => {
    const ddl = `﻿CREATE TABLE [dbo].[T](
      [col1] INT NULL
    )`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["col1"]);
  });

  it("warns on missing CREATE TABLE", () => {
    const result = parseTableDdl("SELECT 1");
    expect(result.columns).toEqual([]);
    expect(result.warnings.length).toBe(1);
  });

  it("handles bare column names without brackets", () => {
    const ddl = `CREATE TABLE dbo.T (
      id INT NOT NULL,
      name VARCHAR(50) NULL
    )`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["id", "name"]);
  });

  it("returns lowercase column names", () => {
    const ddl = `CREATE TABLE [dbo].[T](
      [EmployeeId] BIGINT NULL,
      [FirstName] NVARCHAR(100) NULL
    )`;
    const result = parseTableDdl(ddl);
    expect(result.columns).toEqual(["employeeid", "firstname"]);
  });
});
