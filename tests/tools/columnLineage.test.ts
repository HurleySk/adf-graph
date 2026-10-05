import { describe, it, expect, beforeAll } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleColumnLineage, classifyRule } from "../../src/tools/columnLineage.js";
import type { Graph } from "../../src/graph/model.js";

let graph: Graph;
beforeAll(() => {
  graph = buildGraph(join(import.meta.dirname, "../fixtures-column-lineage")).graph;
});

const rowOf = (entity: string, pipeline: string, attribute: string) =>
  handleColumnLineage(graph, entity, pipeline).rows.find((r) => r.attribute === attribute)!;

describe("handleColumnLineage, alias-mapped Copy", () => {
  it("maps a plain column to its legacy column", () => {
    const r = rowOf("alm_thing", "Load Thing", "alm_atmsthingidfk");
    expect(r.rule).toBe("Direct");
    expect(r.staging).toEqual([{ table: "dbo.Wave3_Thing_Staging", column: "Thing_Id" }]);
    expect(r.legacy).toEqual([{ table: "dbo.Thing", column: "Thing_Id" }]);
  });

  it("follows a stored procedure transform back to the legacy column", () => {
    const r = rowOf("alm_thing", "Load Thing", "alm_thingname");
    expect(r.rule).toBe("Derived");
    expect(r.transforms).toEqual(["UPPER(LTRIM(RTRIM(Thing_Name)))"]);
    expect(r.legacy).toEqual([{ table: "dbo.Thing", column: "Thing_Name" }]);
  });

  it("classifies a CASE with integer results as a choice map", () => {
    const r = rowOf("alm_thing", "Load Thing", "alm_status");
    expect(r.rule).toBe("Choice map");
    expect(r.legacy).toEqual([{ table: "dbo.Thing", column: "Status_Cd" }]);
  });

  it("classifies a date rewrite", () => {
    expect(rowOf("alm_thing", "Load Thing", "alm_createddate").rule).toBe("Date conversion");
  });

  it("resolves a lookup through the Dataverse pull and its join key", () => {
    const r = rowOf("alm_thing", "Load Thing", "alm_ownerid");
    expect(r.rule).toBe("Lookup");
    expect(r.lookupEntity).toBe("alm_owner");
    expect(r.joinCondition).toBe("a.Owner_fk = b.alm_atmsowneridfk");
    expect(r.legacy).toEqual([{ table: "dbo.Thing", column: "Owner_fk" }]);
  });

  it("calls a literal a constant", () => {
    const r = rowOf("alm_thing", "Load Thing", "alm_source");
    expect(r.rule).toBe("Constant");
    expect(r.legacy).toEqual([]);
  });

  it("keeps an unresolved column with a warning", () => {
    const r = rowOf("alm_thing", "Load Thing", "alm_ownerkey");
    expect(r.staging).toEqual([]);
    expect(r.warnings).toContain("?.Owner_fk: source not resolved");
  });
});

describe("handleColumnLineage, other writer shapes", () => {
  it("reads a translator-mapped Copy", () => {
    const r = rowOf("alm_thingnote", "Load Thing", "alm_notetext");
    expect(r.expression).toBe("Thing_Name");
    expect(r.legacy).toEqual([{ table: "dbo.Thing", column: "Thing_Name" }]);
  });

  it("reads a dest_query passed to a generic child loader", () => {
    const res = handleColumnLineage(graph, "alm_gadget", "Load Gadget");
    expect(res.activities).toEqual(["activity:Load Gadget/Gadget to Dataverse"]);
    const r = res.rows.find((x) => x.attribute === "alm_gadgetname")!;
    expect(r.rule).toBe("Direct");
    expect(r.legacy).toEqual([{ table: "dbo.Gadget", column: "Gadget_Nm" }]);
  });

  it("reports an unknown pipeline", () => {
    expect(handleColumnLineage(graph, "alm_thing", "Nope").error).toBe("Pipeline 'Nope' not found");
  });
});

describe("classifyRule", () => {
  it("prefers Lookup, then Choice map, then Constant", () => {
    expect(classifyRule("b.alm_x", 1, "alm_owner")).toBe("Lookup");
    expect(classifyRule("CASE WHEN a.x = 1 THEN 455780000 END", 1, null)).toBe("Choice map");
    expect(classifyRule("CASE WHEN a.x = 1 THEN 'Yes' END", 1, null)).toBe("Derived");
    expect(classifyRule("'Migrated'", 0, null)).toBe("Constant");
    expect(classifyRule("CONVERT(date, a.d)", 1, null)).toBe("Date conversion");
    expect(classifyRule("a.x", 1, null, ["UPPER(x)"])).toBe("Derived");
  });
});
