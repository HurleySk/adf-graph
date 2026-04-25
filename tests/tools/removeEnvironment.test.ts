import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleRemoveEnvironment } from "../../src/tools/removeEnvironment.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleRemoveEnvironment", () => {
  it("removes a runtime environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    mgr.addEnvironment("temp", fixtureRoot);
    const result = handleRemoveEnvironment(mgr, "temp");
    expect(result.removed).toBe(true);
    expect(mgr.listEnvironments().find((e) => e.name === "temp")).toBeUndefined();
  });

  it("rejects removal of config-based environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const result = handleRemoveEnvironment(mgr, "main");
    expect(result.removed).toBe(false);
    expect(result.error).toMatch(/config-based/);
  });
});
