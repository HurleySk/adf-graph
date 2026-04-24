import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const tmpDir = join(import.meta.dirname, "../.tmp-manager");

function setup(): void {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  mkdirSync(tmpDir, { recursive: true });
}

beforeEach(() => setup());
afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("GraphManager", () => {
  describe("getDefaultEnvironment", () => {
    it("returns the env with default: true", () => {
      const mgr = new GraphManager(
        makeConfig({
          alpha: { path: fixtureRoot },
          beta: { path: fixtureRoot, default: true },
        }),
      );
      expect(mgr.getDefaultEnvironment()).toBe("beta");
    });

    it("falls back to the first env when none has default: true", () => {
      const mgr = new GraphManager(
        makeConfig({
          first: { path: fixtureRoot },
          second: { path: fixtureRoot },
        }),
      );
      expect(mgr.getDefaultEnvironment()).toBe("first");
    });

    it("single env with no default flag still resolves as default", () => {
      const mgr = new GraphManager(
        makeConfig({ only: { path: fixtureRoot } }),
      );
      expect(mgr.getDefaultEnvironment()).toBe("only");
    });
  });

  describe("ensureGraph", () => {
    it("builds and returns a graph for the default environment", () => {
      const mgr = new GraphManager(
        makeConfig({ default: { path: fixtureRoot, default: true } }),
      );
      const { graph, warnings, buildTimeMs } = mgr.ensureGraph();
      expect(graph.stats().nodeCount).toBeGreaterThan(0);
      expect(Array.isArray(warnings)).toBe(true);
      expect(buildTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("builds graph for a named environment", () => {
      const mgr = new GraphManager(
        makeConfig({
          env1: { path: fixtureRoot, default: true },
          env2: { path: fixtureRoot },
        }),
      );
      const { graph } = mgr.ensureGraph("env2");
      expect(graph.stats().nodeCount).toBeGreaterThan(0);
    });

    it("resolves undefined to the default environment", () => {
      const mgr = new GraphManager(
        makeConfig({ myenv: { path: fixtureRoot, default: true } }),
      );
      const a = mgr.ensureGraph(undefined);
      const b = mgr.ensureGraph("myenv");
      // Same graph instance when not stale
      expect(a.graph).toBe(b.graph);
    });

    it("throws for unknown environment names", () => {
      const mgr = new GraphManager(
        makeConfig({ env1: { path: fixtureRoot } }),
      );
      expect(() => mgr.ensureGraph("does-not-exist")).toThrow(/unknown environment/);
    });

    it("caches graph — second call returns same instance when not stale", () => {
      const mgr = new GraphManager(
        makeConfig({ env1: { path: fixtureRoot } }),
      );
      const first = mgr.ensureGraph("env1");
      const second = mgr.ensureGraph("env1");
      expect(first.graph).toBe(second.graph);
    });

    it("each environment gets its own graph instance", () => {
      // Use two separate temp dirs to avoid staleness cross-contamination
      const dir1 = join(tmpDir, "env1");
      const dir2 = join(tmpDir, "env2");
      mkdirSync(join(dir1, "pipeline"), { recursive: true });
      mkdirSync(join(dir2, "pipeline"), { recursive: true });

      const mgr = new GraphManager(
        makeConfig({
          env1: { path: dir1, default: true },
          env2: { path: dir2 },
        }),
      );
      const r1 = mgr.ensureGraph("env1");
      const r2 = mgr.ensureGraph("env2");
      expect(r1.graph).not.toBe(r2.graph);
    });

    it("rebuilds graph when stale (new file added after first build)", async () => {
      const dir = join(tmpDir, "stale-env");
      const pipelineDir = join(dir, "pipeline");
      mkdirSync(pipelineDir, { recursive: true });

      const mgr = new GraphManager(
        makeConfig({ env: { path: dir, default: true } }),
      );

      const first = mgr.ensureGraph("env");
      // Mark the first graph so we can confirm it changes
      const firstGraph = first.graph;

      // Wait to ensure new file gets a strictly later mtime
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Write a new pipeline file → makes the env stale
      writeFileSync(
        join(pipelineDir, "NewPipeline.json"),
        JSON.stringify({
          name: "NewPipeline",
          properties: { activities: [] },
        }),
      );

      const second = mgr.ensureGraph("env");
      // Rebuilt — different graph instance
      expect(second.graph).not.toBe(firstGraph);
    });
  });

  describe("listEnvironments", () => {
    it("lists all environments with metadata", () => {
      const mgr = new GraphManager(
        makeConfig({
          alpha: { path: fixtureRoot, default: true },
          beta: { path: "/nonexistent/path" },
        }),
      );

      const list = mgr.listEnvironments();
      expect(list).toHaveLength(2);

      const alpha = list.find((e) => e.name === "alpha")!;
      expect(alpha.name).toBe("alpha");
      expect(alpha.path).toBe(fixtureRoot);
      expect(alpha.isDefault).toBe(true);

      const beta = list.find((e) => e.name === "beta")!;
      expect(beta.isDefault).toBe(false);
    });

    it("shows null counts for unbuilt environments", () => {
      const mgr = new GraphManager(
        makeConfig({ env: { path: fixtureRoot } }),
      );
      const [info] = mgr.listEnvironments();
      expect(info.nodeCount).toBeNull();
      expect(info.edgeCount).toBeNull();
      expect(info.lastBuild).toBeNull();
      expect(info.isStale).toBe(true);
    });

    it("shows real counts after graph is built", () => {
      const mgr = new GraphManager(
        makeConfig({ env: { path: fixtureRoot } }),
      );
      mgr.ensureGraph("env");
      const [info] = mgr.listEnvironments();
      expect(info.nodeCount).toBeGreaterThan(0);
      expect(info.edgeCount).toBeGreaterThan(0);
      expect(info.lastBuild).toBeInstanceOf(Date);
      expect(info.isStale).toBe(false);
    });
  });
});
