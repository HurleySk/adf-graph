import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface EnvironmentConfig {
  path: string;
  default?: boolean;
  overlays?: string[];
}

export interface AdfGraphConfig {
  environments: Record<string, EnvironmentConfig>;
}

/**
 * Load the ADF Graph configuration.
 *
 * Priority:
 * 1. `ADF_CONFIG` env var → path to a JSON config file
 * 2. `adf-graph.json` next to `dist/server.js`
 * 3. `ADF_ROOT` env var → single "default" environment
 * 4. Error
 */
export function loadConfig(): AdfGraphConfig {
  // Priority 1: explicit config path
  const configPath = process.env.ADF_CONFIG;
  if (configPath) {
    return readConfigFile(configPath);
  }

  // Priority 2: adf-graph.json next to dist/server.js
  // import.meta.dirname is the dist/ directory at runtime; go up one level to repo root
  let serverDir: string;
  try {
    // Works when file is bundled/compiled to dist/
    serverDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    serverDir = process.cwd();
  }
  const sidecarPath = join(serverDir, "..", "adf-graph.json");
  if (existsSync(sidecarPath)) {
    return readConfigFile(sidecarPath);
  }

  // Priority 3: ADF_ROOT env var
  const adfRoot = process.env.ADF_ROOT;
  if (adfRoot) {
    return {
      environments: {
        default: { path: adfRoot, default: true },
      },
    };
  }

  // Priority 4: error
  throw new Error(
    "adf-graph: no configuration found. " +
      "Set ADF_CONFIG to a config file path, place adf-graph.json next to the server, " +
      "or set ADF_ROOT for a single-environment setup.",
  );
}

function readConfigFile(filePath: string): AdfGraphConfig {
  if (!existsSync(filePath)) {
    throw new Error(`adf-graph: config file not found: ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(`adf-graph: failed to parse config file '${filePath}': ${String(err)}`);
  }
  return validateConfig(raw, filePath);
}

function validateConfig(raw: unknown, source: string): AdfGraphConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`adf-graph: config '${source}' must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.environments || typeof obj.environments !== "object" || Array.isArray(obj.environments)) {
    throw new Error(`adf-graph: config '${source}' must have an "environments" object`);
  }
  const envs = obj.environments as Record<string, unknown>;
  const environments: Record<string, EnvironmentConfig> = {};
  for (const [name, value] of Object.entries(envs)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`adf-graph: environment '${name}' in '${source}' must be an object`);
    }
    const envObj = value as Record<string, unknown>;
    if (name.includes("+")) {
      throw new Error(
        `adf-graph: environment name '${name}' in '${source}' cannot contain '+' (reserved for merged views)`,
      );
    }
    if (typeof envObj.path !== "string" || !envObj.path) {
      throw new Error(`adf-graph: environment '${name}' in '${source}' must have a "path" string`);
    }
    let overlays: string[] | undefined;
    if (envObj.overlays !== undefined) {
      if (!Array.isArray(envObj.overlays)) {
        throw new Error(
          `adf-graph: environment '${name}' in '${source}': overlays must be an array of strings`,
        );
      }
      for (const entry of envObj.overlays) {
        if (typeof entry !== "string" || !entry) {
          throw new Error(
            `adf-graph: environment '${name}' in '${source}': overlays entries must be non-empty strings`,
          );
        }
      }
      overlays = envObj.overlays as string[];
    }
    environments[name] = {
      path: envObj.path,
      ...(envObj.default === true ? { default: true } : {}),
      ...(overlays ? { overlays } : {}),
    };
  }
  if (Object.keys(environments).length === 0) {
    throw new Error(`adf-graph: config '${source}' must define at least one environment`);
  }
  const defaults = Object.entries(environments).filter(([, e]) => e.default);
  if (defaults.length > 1) {
    const names = defaults.map(([n]) => n).join(", ");
    throw new Error(`adf-graph: config '${source}' has multiple default environments (${names}). Only one is allowed.`);
  }
  return { environments };
}
