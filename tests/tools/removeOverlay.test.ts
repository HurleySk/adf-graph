import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleRemoveOverlay } from "../../src/tools/removeOverlay.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayDir = join(fixtureRoot, "overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleRemoveOverlay", () => {
  it("removes a runtime overlay", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    mgr.addOverlay("main", overlayDir);
    const result = handleRemoveOverlay(mgr, "main", overlayDir);
    expect(result.removed).toBe(true);
  });

  it("rejects removal of config-based overlay", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot, overlays: [overlayDir] } }));
    const result = handleRemoveOverlay(mgr, "main", overlayDir);
    expect(result.removed).toBe(false);
    expect(result.error).toMatch(/config-based/);
  });
});
