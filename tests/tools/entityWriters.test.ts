import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleEntityCoverage, EntityCoverageResult } from "../../src/tools/entityCoverage.js";
import { handleFindConsumers } from "../../src/tools/consumers.js";
import { handleEnhancedSearch } from "../../src/tools/enhancedSearch.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures-entity-writers");

function coveragePipelines(entity: string): string[] {
  const { graph } = buildGraph(fixtureRoot);
  const result = handleEntityCoverage(graph, entity, "full") as EntityCoverageResult;
  return [...new Set(result.coverageEntries.map((e) => e.pipeline))].sort();
}

function consumers(entity: string, usage: string): string[] {
  const { graph } = buildGraph(fixtureRoot);
  return [
    ...new Set(
      handleFindConsumers(graph, entity, "dataverse_entity")
        .consumers.filter((c) => c.usage === usage)
        .map((c) => `${c.pipeline}/${c.activity}`),
    ),
  ].sort();
}

const EMPLOYEE_WRITERS = [
  "Delta Load Individual to Employee",
  "Generic DV Parent",
  "Load Individual to Employee",
  "Load Restricted Settlement Service List",
];

describe("entity writers resolved from activity dataset parameters", () => {
  it("entity coverage lists auto-mapped Copy sinks with no column mappings", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleEntityCoverage(graph, "alm_employee", "full") as EntityCoverageResult;
    const rsl = result.coverageEntries.find((e) => e.activity === "ALJ RSL to Employee DataVerse");
    expect(rsl).toBeDefined();
    expect(rsl!.source).toBe("source_query");
    expect(rsl!.columns).toEqual(["alm_firstname", "alm_atmsaljrslidfk"]);
  });

  it("entity coverage covers literal, Expression, nested, dynamic-dataset and caller-passed writers", () => {
    expect(coveragePipelines("alm_employee")).toEqual(EMPLOYEE_WRITERS);
  });

  it("entity coverage is case-insensitive on the requested entity", () => {
    expect(coveragePipelines("ALM_Employee")).toEqual(EMPLOYEE_WRITERS);
  });

  it("find_consumers agrees with entity coverage on writers", () => {
    const writers = [...new Set(consumers("alm_employee", "writes").map((c) => c.split("/")[0]))].sort();
    expect(writers).toEqual(EMPLOYEE_WRITERS);
  });

  it("graph_search targetEntity agrees with find_consumers", () => {
    const { graph } = buildGraph(fixtureRoot);
    const hits = handleEnhancedSearch(graph, "", { targetEntity: "alm_employee", nodeType: "activity" }).hits;
    const searchPipelines = [...new Set(hits.map((h) => h.pipeline!))].sort();
    const consumerPipelines = [
      ...new Set([...consumers("alm_employee", "writes"), ...consumers("alm_employee", "reads")].map((c) => c.split("/")[0])),
    ].sort();
    expect(searchPipelines).toEqual(consumerPipelines);
  });

  it("resolves hard-coded dataset entityName and dataset parameter defaults", () => {
    expect(coveragePipelines("contact")).toEqual(["Load Contacts Hardcoded"]);
    expect(coveragePipelines("alm_regionaloffice")).toEqual(["Load Contacts Hardcoded"]);
  });

  it("records reads from FetchXML sources, Lookups and caller-passed read parameters", () => {
    const readers = consumers("pcx_workpackage", "reads");
    expect(readers).toContain("Read Entities/Fetch Work Packages");
    expect(readers).toContain("Generic DV Parent/Run Child For Employee");
    expect(consumers("alm_employee", "reads")).toContain("Read Entities/Lookup Employee");
    expect(consumers("contact", "reads")).toEqual([]);
  });

  it("classifies dataverse_entity_name passed to a read-only child as a read", () => {
    expect(consumers("alm_employee", "reads")).toContain("Load Mailing List/Get alm_Employee from DataVerse");
    expect(consumers("alm_employee", "writes").some((w) => w.startsWith("Load Mailing List/"))).toBe(false);
  });

  it("does not record the dynamic child activity against a literal entity", () => {
    const writers = consumers("alm_employee", "writes");
    expect(writers.some((w) => w.startsWith("Generic DV Child/"))).toBe(false);
  });
});
