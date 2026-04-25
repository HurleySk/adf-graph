import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleAddOverlay } from "../../src/tools/addOverlay.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayDir = join(fixtureRoot, "overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleAddOverlay", () => {
  it("adds a runtime overlay and returns the overlay list", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot, default: true } }));
    const result = handleAddOverlay(mgr, "main", overlayDir);
    expect(result.added).toBe(true);
    expect(result.overlays).toHaveLength(1);
    expect(result.overlays[0]).toEqual({ path: overlayDir, source: "runtime" });
  });

  it("returns error for unknown environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    expect(() => handleAddOverlay(mgr, "nope", overlayDir)).toThrow(/unknown environment/);
  });
});
