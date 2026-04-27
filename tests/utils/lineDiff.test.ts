import { describe, it, expect } from "vitest";
import { computeLineDiff } from "../../src/utils/lineDiff.js";

describe("computeLineDiff", () => {
  it("returns empty array for identical strings", () => {
    const result = computeLineDiff("SELECT * FROM foo", "SELECT * FROM foo");
    expect(result).toEqual([" SELECT * FROM foo"]);
  });

  it("marks added lines with +", () => {
    const result = computeLineDiff("line1\nline2", "line1\nline2\nline3");
    expect(result).toContain("+line3");
  });

  it("marks removed lines with -", () => {
    const result = computeLineDiff("line1\nline2\nline3", "line1\nline3");
    expect(result).toContain("-line2");
  });

  it("handles multiline SQL diff", () => {
    const a = "SELECT org_id\nFROM dbo.Org_Staging\nWHERE active = 1";
    const b = "SELECT org_id, org_name\nFROM dbo.Org_Staging\nJOIN dbo.Names ON 1=1\nWHERE active = 1";
    const result = computeLineDiff(a, b);
    expect(result).toContain("-SELECT org_id");
    expect(result).toContain("+SELECT org_id, org_name");
    expect(result).toContain("+JOIN dbo.Names ON 1=1");
    expect(result).toContain(" WHERE active = 1");
  });

  it("handles empty before string", () => {
    const result = computeLineDiff("", "new content");
    expect(result).toEqual(["+new content"]);
  });

  it("handles empty after string", () => {
    const result = computeLineDiff("old content", "");
    expect(result).toEqual(["-old content"]);
  });
});
