import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractColumnMappings } from "../../src/parsers/columns.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/pipelines");

function loadActivity(file: string, activityName: string): Record<string, unknown> {
  const json = JSON.parse(readFileSync(join(fixtureDir, file), "utf-8")) as {
    properties: { activities: Array<Record<string, unknown>> };
  };
  const activity = json.properties.activities.find((a) => a.name === activityName);
  if (!activity) throw new Error(`Activity '${activityName}' not found in ${file}`);
  return activity;
}

describe("extractColumnMappings", () => {
  it("extracts 3 column mappings from copy-to-staging fixture", () => {
    const activity = loadActivity("copy-to-staging.json", "Copy Legacy Data");
    const edges = extractColumnMappings("activity:Copy_To_Staging/Copy Legacy Data", activity);
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.type === "maps_column")).toBe(true);
    expect(edges.every((e) => e.from === "activity:Copy_To_Staging/Copy Legacy Data")).toBe(true);
    expect(edges.every((e) => e.to === "activity:Copy_To_Staging/Copy Legacy Data")).toBe(true);
  });

  it("returns empty for activity without translator (SP activity)", () => {
    const activity = loadActivity("sp-transform.json", "Run p_Transform_Org");
    const edges = extractColumnMappings("activity:SP_Transform/Run p_Transform_Org", activity);
    expect(edges).toHaveLength(0);
  });

  it("maps source→sink correctly when names differ (org_type → org_type_code)", () => {
    const activity = loadActivity("copy-to-staging.json", "Copy Legacy Data");
    const edges = extractColumnMappings("activity:Copy_To_Staging/Copy Legacy Data", activity);
    const renamed = edges.find(
      (e) => e.metadata.sourceColumn === "org_type" && e.metadata.sinkColumn === "org_type_code"
    );
    expect(renamed).toBeDefined();
  });
});
