import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import { handleCrossEnvArtifact } from "../../src/tools/crossEnvArtifact.js";
import type { AdfGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const fixtureEnv2 = join(import.meta.dirname, "../fixtures-env2");

function makeManager(): GraphManager {
  const config: AdfGraphConfig = {
    environments: {
      dev: { path: fixtureRoot, default: true },
      prod: { path: fixtureEnv2 },
    },
  };
  return new GraphManager(config);
}

describe("handleCrossEnvArtifact", () => {
  it("shows linked service metadata from both environments", () => {
    const mgr = makeManager();
    const result = handleCrossEnvArtifact(mgr, "ls_dataverse_dev", "linked_service");
    expect(result.environments).toHaveLength(2);

    const dev = result.environments.find((e) => e.environment === "dev");
    const prod = result.environments.find((e) => e.environment === "prod");
    expect(dev!.found).toBe(true);
    expect(prod!.found).toBe(true);
  });

  it("detects serviceUri difference across environments", () => {
    const mgr = makeManager();
    const result = handleCrossEnvArtifact(mgr, "ls_dataverse_dev", "linked_service");
    const uriDiff = result.diffs.find((d) => d.field === "connectionProperties.serviceUri");
    expect(uriDiff).toBeDefined();
    expect(uriDiff!.consistent).toBe(false);
    expect(uriDiff!.values.dev).toBe("https://almdatadev.crm.dynamics.com");
    expect(uriDiff!.values.prod).toBe("https://almdataprod.crm.dynamics.com");
  });

  it("detects servicePrincipalId difference", () => {
    const mgr = makeManager();
    const result = handleCrossEnvArtifact(mgr, "ls_dataverse_dev", "linked_service");
    const spDiff = result.diffs.find((d) => d.field === "connectionProperties.servicePrincipalId");
    expect(spDiff).toBeDefined();
    expect(spDiff!.consistent).toBe(false);
  });

  it("reports consistent fields without diffs", () => {
    const mgr = makeManager();
    const result = handleCrossEnvArtifact(mgr, "ls_dataverse_dev", "linked_service");
    const tenantDiff = result.diffs.find((d) => d.field === "connectionProperties.tenant");
    expect(tenantDiff).toBeUndefined();
  });

  it("reports found: false when artifact missing in one environment", () => {
    const mgr = makeManager();
    const result = handleCrossEnvArtifact(mgr, "ls_azure_sql", "linked_service");
    const dev = result.environments.find((e) => e.environment === "dev");
    const prod = result.environments.find((e) => e.environment === "prod");
    expect(dev!.found).toBe(true);
    expect(prod!.found).toBe(false);
    expect(result.diffs).toHaveLength(0);
  });

  it("shows diffs when artifact has different metadata across environments", () => {
    const mgr = makeManager();
    const result = handleCrossEnvArtifact(mgr, "ls_key_vault", "linked_service");
    const dev = result.environments.find((e) => e.environment === "dev");
    const prod = result.environments.find((e) => e.environment === "prod");
    expect(dev!.found).toBe(true);
    expect(prod!.found).toBe(true);
    expect(result.diffs.length).toBeGreaterThan(0);
  });
});
