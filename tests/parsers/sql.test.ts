import { describe, it, expect } from "vitest";
import { join } from "path";
import { scanSqlDirectory } from "../../src/parsers/sql.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/SQL DB/test-project");

describe("scanSqlDirectory", () => {
  it("discovers stored procedures (1 SP: stored_procedure:dbo.p_Transform_Org)", () => {
    const result = scanSqlDirectory(fixtureDir);
    const spNodes = result.nodes.filter((n) => n.type === "stored_procedure");
    expect(spNodes).toHaveLength(1);
    expect(spNodes[0].id).toBe("stored_procedure:dbo.p_Transform_Org");
    expect(spNodes[0].name).toBe("p_Transform_Org");
  });

  it("discovers tables", () => {
    const result = scanSqlDirectory(fixtureDir);
    const tableNodes = result.nodes.filter((n) => n.type === "table");
    expect(tableNodes).toHaveLength(2);
    const ids = tableNodes.map((n) => n.id).sort();
    expect(ids).toContain("table:dbo.Org_Staging");
    expect(ids).toContain("table:dbo.Work_Item_Staging");
  });

  it("returns empty for missing directory", () => {
    const result = scanSqlDirectory("/nonexistent/path/that/does/not/exist");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
