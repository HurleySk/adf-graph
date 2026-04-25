import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleListOverlays } from "../../src/tools/listOverlays.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayDir = join(fixtureRoot, "overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleListOverlays", () => {
  it("lists config and runtime overlays together", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot, overlays: ["/config/path"] } }));
    mgr.addOverlay("main", overlayDir);
    const result = handleListOverlays(mgr, "main");
    expect(result.overlays).toHaveLength(2);
    expect(result.overlays[0]).toEqual({ path: "/config/path", source: "config" });
    expect(result.overlays[1]).toEqual({ path: overlayDir, source: "runtime" });
  });

  it("returns empty list when no overlays", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const result = handleListOverlays(mgr, "main");
    expect(result.overlays).toHaveLength(0);
  });
});
