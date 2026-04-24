import { AdfGraphConfig } from "../config.js";
import { buildGraph } from "./builder.js";
import { Graph } from "./model.js";
import { StalenessChecker } from "./staleness.js";

export interface EnvironmentInfo {
  name: string;
  path: string;
  isDefault: boolean;
  nodeCount: number | null;
  edgeCount: number | null;
  lastBuild: Date | null;
  isStale: boolean;
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

  constructor(config: AdfGraphConfig) {
    this.config = config;
    this.defaultEnv = this.resolveDefaultEnvironment();
  }

  /**
   * Get or rebuild graph for an environment.
   * If `environment` is undefined, uses the default environment.
   */
  ensureGraph(environment?: string): { graph: Graph; warnings: string[]; buildTimeMs: number } {
    const envName = environment ?? this.defaultEnv;
    const envConfig = this.config.environments[envName];
    if (!envConfig) {
      const available = Object.keys(this.config.environments).join(", ");
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
    const result = buildGraph(envConfig.path);

    // Each environment keeps its own staleness checker
    const staleness = existing?.staleness ?? new StalenessChecker(envConfig.path);
    staleness.markBuilt();

    const state: EnvState = {
      graph: result.graph,
      warnings: result.warnings,
      buildTimeMs: result.buildTimeMs,
      staleness,
    };
    this.graphs.set(envName, state);

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
    const envNames = Object.keys(this.config.environments);
    return envNames.map((name) => {
      const cfg = this.config.environments[name];
      const state = this.graphs.get(name);
      const stats = state ? state.graph.stats() : null;
      return {
        name,
        path: cfg.path,
        isDefault: name === this.defaultEnv,
        nodeCount: stats?.nodeCount ?? null,
        edgeCount: stats?.edgeCount ?? null,
        lastBuild: state ? state.staleness.lastBuildTime() : null,
        isStale: state ? state.staleness.isStale() : true,
      };
    });
  }

  private resolveDefaultEnvironment(): string {
    const envs = this.config.environments;
    // Use the one with default: true
    for (const [name, cfg] of Object.entries(envs)) {
      if (cfg.default) return name;
    }
    // Fall back to the first key
    const first = Object.keys(envs)[0];
    if (!first) {
      throw new Error("adf-graph: no environments defined in config");
    }
    return first;
  }
}
