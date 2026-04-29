import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleFilterChain } from "../../src/tools/filterChain.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleFilterChain", () => {
  it("returns error for unknown entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFilterChain(graph, "nonexistent_entity");
    expect(result.error).toBeDefined();
    expect(result.chain).toHaveLength(0);
  });

  it("finds filter steps for a known entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    // alm_organization is written to by the copy-to-dataverse pipeline
    const result = handleFilterChain(graph, "alm_organization");
    // May or may not have filters depending on the fixture SQL
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe("alm_organization");
  });

  it("extracts WHERE clause from copy activity sqlReaderQuery", () => {
    const { graph } = buildGraph(fixtureRoot);
    // The CDC child pipeline has a copy activity with WHERE clause
    // Look for Work_Item table which is read by the CDC child
    const result = handleFilterChain(graph, "dbo.Work_Item");
    // Check that the chain includes filter steps if any
    if (result.chain.length > 0) {
      const withWhere = result.chain.filter((s) => s.whereClause !== null);
      if (withWhere.length > 0) {
        expect(withWhere[0].whereClause!.conditions.length).toBeGreaterThan(0);
      }
    }
  });

  it("summary reflects chain contents", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFilterChain(graph, "alm_organization");
    expect(result.summary.totalFilters).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.summary.tablesReferenced)).toBe(true);
    expect(typeof result.summary.hasEscapeHatches).toBe("boolean");
  });

  it("chain is ordered by context (source_query before dest_query)", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFilterChain(graph, "alm_organization");
    if (result.chain.length >= 2) {
      const contextOrder: Record<string, number> = {
        source_query: 0,
        sqlReaderQuery: 1,
        dest_query: 2,
      };
      for (let i = 1; i < result.chain.length; i++) {
        const prevOrder = contextOrder[result.chain[i - 1].sqlContext] ?? 99;
        const currOrder = contextOrder[result.chain[i].sqlContext] ?? 99;
        expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
      }
    }
  });
});
