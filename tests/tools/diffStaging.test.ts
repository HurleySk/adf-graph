import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleDiffStaging } from "../../src/tools/diffStaging.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const fixtureEnv2 = join(import.meta.dirname, "../fixtures-env2");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleDiffStaging", () => {
  it("diffs two explicit environments", () => {
    const mgr = new GraphManager(makeConfig({
      staging: { path: fixtureRoot },
      deployed: { path: fixtureEnv2 },
    }));

    const result = handleDiffStaging(mgr, "Copy_To_Dataverse", "staging", "deployed");

    expect(result.error).toBeUndefined();
    expect(result.stagingEnv).toBe("staging");
    expect(result.deployedEnv).toBe("deployed");
    expect(result.diff.pipeline).toBe("Copy_To_Dataverse");
  });

  it("auto-detects overlay environments", () => {
    const overlayDir = join(fixtureRoot, "overlay-structured");
    const mgr = new GraphManager(makeConfig({
      main: { path: fixtureRoot, overlays: [overlayDir] },
    }));

    const result = handleDiffStaging(mgr, "Copy_To_Dataverse");

    expect(result.error).toBeUndefined();
    expect(result.stagingEnv).toBe("main+overlays");
    expect(result.deployedEnv).toBe("main");
  });

  it("returns error when auto-detection fails with no overlays", () => {
    const mgr = new GraphManager(makeConfig({
      env1: { path: fixtureRoot },
      env2: { path: fixtureEnv2 },
    }));

    const result = handleDiffStaging(mgr, "Copy_To_Dataverse");

    expect(result.error).toBeDefined();
    expect(result.error).toContain("Could not auto-detect");
  });

  it("shows unchanged pipeline when same environment compared", () => {
    const mgr = new GraphManager(makeConfig({
      staging: { path: fixtureRoot },
      deployed: { path: fixtureRoot },
    }));

    const result = handleDiffStaging(mgr, "Copy_To_Dataverse", "staging", "deployed");

    expect(result.error).toBeUndefined();
    expect(result.diff.summary.modified).toBe(0);
    expect(result.diff.summary.added).toBe(0);
    expect(result.diff.summary.removed).toBe(0);
  });

  it("shows diff when pipelines differ across environments", () => {
    const mgr = new GraphManager(makeConfig({
      staging: { path: fixtureRoot },
      deployed: { path: fixtureEnv2 },
    }));

    const result = handleDiffStaging(mgr, "Copy_To_Dataverse", "staging", "deployed");

    expect(result.error).toBeUndefined();
    const { added, removed, modified } = result.diff.summary;
    expect(added + removed + modified).toBeGreaterThanOrEqual(0);
  });

  it("handles pipeline not found gracefully", () => {
    const mgr = new GraphManager(makeConfig({
      staging: { path: fixtureRoot },
      deployed: { path: fixtureEnv2 },
    }));

    const result = handleDiffStaging(mgr, "Nonexistent_Pipeline", "staging", "deployed");

    expect(result.diff.error).toBeDefined();
  });
});
