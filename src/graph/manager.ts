import { AdfGraphConfig, EnvironmentConfig } from "../config.js";
import { buildGraph } from "./builder.js";
import { Graph } from "./model.js";
import { scanOverlayPath, mergeOverlayInto } from "./overlay.js";
import { StalenessChecker } from "./staleness.js";

const OVERLAY_SUFFIX = "+overlays";

export interface EnvironmentInfo {
  name: string;
  path: string;
  isDefault: boolean;
  nodeCount: number | null;
  edgeCount: number | null;
  lastBuild: Date | null;
  isStale: boolean;
  source: "config" | "runtime" | "derived";
  hasOverlays: boolean;
}

interface EnvState {
  graph: Graph;
  warnings: string[];
  buildTimeMs: number;
  staleness: StalenessChecker;
}

export class GraphManager {
  private graphs: Map<string, EnvState> = new Map();
  private config: AdfGraphConfig;
  private defaultEnv: string;

  /** Runtime overlays added via addOverlay(), keyed by base env name. */
  private runtimeOverlays: Map<string, string[]> = new Map();

  /** Runtime environments added via addEnvironment(). */
  private runtimeEnvs: Map<string, { path: string; overlays: string[] }> = new Map();

  constructor(config: AdfGraphConfig) {
    this.config = config;
    this.defaultEnv = this.resolveDefaultEnvironment();
  }

  /**
   * Get or rebuild graph for an environment.
   * Handles base envs, runtime envs, and derived merged views (`name+overlays`).
   */
  ensureGraph(environment?: string): { graph: Graph; warnings: string[]; buildTimeMs: number } {
    const envName = environment ?? this.defaultEnv;

    // Check if this is a derived merged-view request
    if (envName.endsWith(OVERLAY_SUFFIX)) {
      return this.ensureMergedGraph(envName);
    }

    // Resolve the path for this environment (config or runtime)
    const envPath = this.resolveEnvPath(envName);
    if (!envPath) {
      const available = this.allKnownEnvNames().join(", ");
      throw new Error(
        `adf-graph: unknown environment '${envName}'. Available: ${available}`,
      );
    }

    const existing = this.graphs.get(envName);
    if (existing && !existing.staleness.isStale()) {
      return {
        graph: existing.graph,
        warnings: existing.warnings,
        buildTimeMs: existing.buildTimeMs,
      };
    }

    // Build (or rebuild) graph for this environment
    const result = buildGraph(envPath);

    // Each environment keeps its own staleness checker
    const staleness = existing?.staleness ?? new StalenessChecker(envPath);
    staleness.markBuilt();

    const state: EnvState = {
      graph: result.graph,
      warnings: result.warnings,
      buildTimeMs: result.buildTimeMs,
      staleness,
    };
    this.graphs.set(envName, state);

    // Invalidate merged view so it gets rebuilt on next access
    this.graphs.delete(envName + OVERLAY_SUFFIX);

    return {
      graph: result.graph,
      warnings: result.warnings,
      buildTimeMs: result.buildTimeMs,
    };
  }

  /** Return the name of the default environment. */
  getDefaultEnvironment(): string {
    return this.defaultEnv;
  }

  /** List all environments with stats (graph built lazily — unbuilt envs show null counts). */
  listEnvironments(): EnvironmentInfo[] {
    const result: EnvironmentInfo[] = [];

    // Config-based environments
    for (const [name, cfg] of Object.entries(this.config.environments)) {
      const overlays = this.getEffectiveOverlays(name);
      result.push(this.buildEnvInfo(name, cfg.path, "config", overlays.length > 0));

      // Derived merged view if overlays exist
      if (overlays.length > 0) {
        const mergedName = name + OVERLAY_SUFFIX;
        result.push(this.buildEnvInfo(mergedName, cfg.path, "derived", false));
      }
    }

    // Runtime environments
    for (const [name, rt] of this.runtimeEnvs) {
      const overlays = this.getEffectiveOverlays(name);
      result.push(this.buildEnvInfo(name, rt.path, "runtime", overlays.length > 0));

      if (overlays.length > 0) {
        const mergedName = name + OVERLAY_SUFFIX;
        result.push(this.buildEnvInfo(mergedName, rt.path, "derived", false));
      }
    }

    return result;
  }

  // ── Runtime overlay management ──────────────────────────────────────

  /** Add an overlay path to an environment at runtime. */
  addOverlay(env: string, path: string): void {
    if (!this.resolveEnvPath(env)) {
      throw new Error(`adf-graph: unknown environment '${env}'`);
    }
    const list = this.runtimeOverlays.get(env) ?? [];
    if (!list.includes(path)) {
      list.push(path);
      this.runtimeOverlays.set(env, list);
    }
    // Invalidate merged view
    this.graphs.delete(env + OVERLAY_SUFFIX);
    // Recompute default in case overlays changed
    this.defaultEnv = this.resolveDefaultEnvironment();
  }

  /** Remove a runtime overlay. Config-based overlays cannot be removed. */
  removeOverlay(env: string, path: string): { removed: boolean; isConfigOverlay?: boolean } {
    if (!this.resolveEnvPath(env)) {
      throw new Error(`adf-graph: unknown environment '${env}'`);
    }
    const configOverlays = this.getConfigOverlays(env);
    if (configOverlays.includes(path)) {
      return { removed: false, isConfigOverlay: true };
    }

    const list = this.runtimeOverlays.get(env);
    if (!list) return { removed: false };

    const idx = list.indexOf(path);
    if (idx === -1) return { removed: false };

    list.splice(idx, 1);
    if (list.length === 0) {
      this.runtimeOverlays.delete(env);
    }

    // Invalidate merged view
    this.graphs.delete(env + OVERLAY_SUFFIX);
    // Recompute default
    this.defaultEnv = this.resolveDefaultEnvironment();

    return { removed: true };
  }

  /** List all overlays (config + runtime) for an environment. */
  listOverlays(env: string): Array<{ path: string; source: "config" | "runtime" }> {
    if (!this.resolveEnvPath(env)) {
      throw new Error(`adf-graph: unknown environment '${env}'`);
    }
    const result: Array<{ path: string; source: "config" | "runtime" }> = [];

    for (const p of this.getConfigOverlays(env)) {
      result.push({ path: p, source: "config" });
    }
    for (const p of this.runtimeOverlays.get(env) ?? []) {
      result.push({ path: p, source: "runtime" });
    }

    return result;
  }

  // ── Runtime environment management ──────────────────────────────────

  /** Register a new runtime environment. */
  addEnvironment(name: string, path: string, overlays?: string[]): void {
    if (name.includes("+")) {
      throw new Error(`adf-graph: environment name '${name}' cannot contain '+'`);
    }
    if (this.config.environments[name]) {
      throw new Error(`adf-graph: environment name '${name}' conflicts with a config-defined environment`);
    }
    if (this.runtimeEnvs.has(name)) {
      throw new Error(`adf-graph: runtime environment '${name}' already exists`);
    }
    this.runtimeEnvs.set(name, { path, overlays: overlays ?? [] });
    if (overlays && overlays.length > 0) {
      // Store as runtime overlays for consistency
      this.runtimeOverlays.set(name, [...overlays]);
    }
  }

  /** Remove a runtime environment. Config-based environments cannot be removed. */
  removeEnvironment(name: string): { removed: boolean; isConfigEnv?: boolean } {
    if (this.config.environments[name]) {
      return { removed: false, isConfigEnv: true };
    }
    if (!this.runtimeEnvs.has(name)) {
      return { removed: false };
    }

    this.runtimeEnvs.delete(name);
    this.runtimeOverlays.delete(name);
    this.graphs.delete(name);
    this.graphs.delete(name + OVERLAY_SUFFIX);
    this.defaultEnv = this.resolveDefaultEnvironment();

    return { removed: true };
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Build and cache a merged view for `baseName+overlays`.
   */
  private ensureMergedGraph(mergedName: string): { graph: Graph; warnings: string[]; buildTimeMs: number } {
    const baseName = mergedName.slice(0, -OVERLAY_SUFFIX.length);
    const overlays = this.getEffectiveOverlays(baseName);

    if (overlays.length === 0) {
      throw new Error(
        `adf-graph: no overlays configured for environment '${baseName}' — '${mergedName}' does not exist`,
      );
    }

    // Build the base graph first (this caches it)
    const baseResult = this.ensureGraph(baseName);

    // Check cache for the merged view — reuse if base is fresh and merged was already built
    const existingMerged = this.graphs.get(mergedName);
    if (existingMerged && !existingMerged.staleness.isStale()) {
      return {
        graph: existingMerged.graph,
        warnings: existingMerged.warnings,
        buildTimeMs: existingMerged.buildTimeMs,
      };
    }

    // Clone the base and apply each overlay
    const start = performance.now();
    const merged = baseResult.graph.clone();
    const allWarnings = [...baseResult.warnings];

    for (const overlayPath of overlays) {
      const scan = scanOverlayPath(overlayPath);
      allWarnings.push(...scan.warnings);

      // Build a temporary graph from the scan results so we can use mergeOverlayInto
      const overlayGraph = new Graph();
      for (const node of scan.nodes) overlayGraph.addNode(node);
      for (const edge of scan.edges) overlayGraph.addEdge(edge);

      mergeOverlayInto(merged, overlayGraph);
    }

    const buildTimeMs = baseResult.buildTimeMs + (performance.now() - start);

    // Staleness for the merged view tracks base path + overlay paths
    const basePath = this.resolveEnvPath(baseName)!;
    const staleness = existingMerged?.staleness ?? new StalenessChecker([basePath, ...overlays]);
    staleness.markBuilt();

    const state: EnvState = {
      graph: merged,
      warnings: allWarnings,
      buildTimeMs,
      staleness,
    };
    this.graphs.set(mergedName, state);

    return { graph: merged, warnings: allWarnings, buildTimeMs };
  }

  /** Resolve the filesystem path for an environment name (config or runtime). */
  private resolveEnvPath(name: string): string | null {
    const cfgEnv = this.config.environments[name];
    if (cfgEnv) return cfgEnv.path;

    const rtEnv = this.runtimeEnvs.get(name);
    if (rtEnv) return rtEnv.path;

    return null;
  }

  /** Get config-defined overlays for an environment. */
  private getConfigOverlays(env: string): string[] {
    const cfg = this.config.environments[env];
    return cfg?.overlays ?? [];
  }

  /** Get combined config + runtime overlays for an environment. */
  private getEffectiveOverlays(env: string): string[] {
    const configOverlays = this.getConfigOverlays(env);
    const runtimeOvl = this.runtimeOverlays.get(env) ?? [];
    return [...configOverlays, ...runtimeOvl];
  }

  /** All known environment names (config + runtime, no derived). */
  private allKnownEnvNames(): string[] {
    const names = Object.keys(this.config.environments);
    for (const name of this.runtimeEnvs.keys()) {
      names.push(name);
    }
    // Also include derived names for environments with overlays
    for (const name of [...Object.keys(this.config.environments), ...this.runtimeEnvs.keys()]) {
      if (this.getEffectiveOverlays(name).length > 0) {
        names.push(name + OVERLAY_SUFFIX);
      }
    }
    return names;
  }

  private buildEnvInfo(
    name: string,
    path: string,
    source: "config" | "runtime" | "derived",
    hasOverlays: boolean,
  ): EnvironmentInfo {
    const state = this.graphs.get(name);
    const stats = state ? state.graph.stats() : null;
    return {
      name,
      path,
      isDefault: name === this.defaultEnv,
      nodeCount: stats?.nodeCount ?? null,
      edgeCount: stats?.edgeCount ?? null,
      lastBuild: state ? state.staleness.lastBuildTime() : null,
      isStale: state ? state.staleness.isStale() : true,
      source,
      hasOverlays,
    };
  }

  private resolveDefaultEnvironment(): string {
    const envs = this.config.environments;
    // Use the one with default: true
    for (const [name, cfg] of Object.entries(envs)) {
      if (cfg.default) {
        // If this env has overlays, return the merged view name
        if (this.getEffectiveOverlays(name).length > 0) {
          return name + OVERLAY_SUFFIX;
        }
        return name;
      }
    }
    // Fall back to the first config key
    const first = Object.keys(envs)[0];
    if (first) {
      if (this.getEffectiveOverlays(first).length > 0) {
        return first + OVERLAY_SUFFIX;
      }
      return first;
    }
    // Fall back to the first runtime env
    const firstRuntime = this.runtimeEnvs.keys().next().value;
    if (firstRuntime) {
      if (this.getEffectiveOverlays(firstRuntime).length > 0) {
        return firstRuntime + OVERLAY_SUFFIX;
      }
      return firstRuntime;
    }
    throw new Error("adf-graph: no environments defined");
  }
}
