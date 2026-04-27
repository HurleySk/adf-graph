import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleFindConsumers } from "../../src/tools/consumers.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleFindConsumers", () => {
  it("finds activities that write to a Dataverse entity", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindConsumers(graph, "alm_organization", "dataverse_entity");
    expect(result.nodeId).toBe("dataverse_entity:alm_organization");
    expect(result.consumers.length).toBeGreaterThan(0);
    const writer = result.consumers.find((c) => c.usage === "writes" && c.pipeline === "Copy_To_Dataverse");
    expect(writer).toBeDefined();
  });

  it("finds activities that use a dataset", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindConsumers(graph, "ds_dataverse", "dataset");
    expect(result.consumers.length).toBeGreaterThan(0);
    const user = result.consumers.find((c) => c.pipeline === "Copy_To_Dataverse");
    expect(user).toBeDefined();
    expect(user!.usage).toBe("uses");
  });

  it("finds activities that call a stored procedure", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindConsumers(graph, "dbo.p_Transform_Org", "stored_procedure");
    expect(result.consumers.length).toBeGreaterThan(0);
    const caller = result.consumers.find((c) => c.usage === "calls" && c.pipeline === "SP_Transform");
    expect(caller).toBeDefined();
  });

  it("returns empty consumers for an unknown target", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleFindConsumers(graph, "nonexistent_entity", "dataverse_entity");
    expect(result.consumers).toEqual([]);
    expect(result.nodeId).toBe("dataverse_entity:nonexistent_entity");
  });
});
