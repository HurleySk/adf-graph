import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleAddEnvironment } from "../../src/tools/addEnvironment.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleAddEnvironment", () => {
  it("adds a runtime environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const result = handleAddEnvironment(mgr, "new-env", fixtureRoot);
    expect(result.added).toBe(true);
    expect(result.name).toBe("new-env");
    const envs = mgr.listEnvironments();
    expect(envs.find((e) => e.name === "new-env")).toBeDefined();
  });

  it("rejects name collision with config env", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    expect(() => handleAddEnvironment(mgr, "main", "/other")).toThrow(/conflicts/);
  });

  it("rejects names containing +", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    expect(() => handleAddEnvironment(mgr, "bad+name", "/path")).toThrow(/cannot contain/);
  });

  it("adds environment with overlays", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const overlayDir = join(fixtureRoot, "overlay-structured");
    handleAddEnvironment(mgr, "with-overlays", fixtureRoot, [overlayDir]);
    const overlays = mgr.listOverlays("with-overlays");
    expect(overlays).toHaveLength(1);
  });
});
