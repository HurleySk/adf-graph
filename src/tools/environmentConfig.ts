import { existsSync, readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { Graph, NodeType } from "../graph/model.js";

interface LinkedServiceEndpoint {
  name: string;
  type: string;
  serviceUri?: string;
  connectionString?: string;
  baseUrl?: string;
  connectVia?: string;
  secretName?: string;
}

export interface EnvironmentConfigResult {
  target: string;
  factoryName?: string;
  linkedServices: LinkedServiceEndpoint[];
  error?: string;
}

const endpointConfigCache = new Map<string, EnvironmentConfigResult>();

export function handleEnvironmentConfig(
  graph: Graph,
  target: string,
  linkedService: string | undefined,
  envPath: string,
): EnvironmentConfigResult {
  const cacheKey = `${envPath}:${target}`;
  let cached = endpointConfigCache.get(cacheKey);
  if (!cached) {
    cached = loadConfig(target, envPath);
    endpointConfigCache.set(cacheKey, cached);
  }

  if (linkedService && !cached.error) {
    const filtered = cached.linkedServices.filter(
      ls => ls.name.toLowerCase() === linkedService.toLowerCase()
    );
    return { ...cached, linkedServices: filtered };
  }

  return cached;
}

function loadConfig(target: string, envPath: string): EnvironmentConfigResult {
  const linkedServices: LinkedServiceEndpoint[] = [];
  let factoryName: string | undefined;

  const endpointsFile = join(envPath, "config", "ls-endpoints", `endpoints_${target}.json`);
  if (existsSync(endpointsFile)) {
    try {
      const data = JSON.parse(readFileSync(endpointsFile, "utf-8"));
      if (typeof data === "object" && data !== null) {
        for (const [lsName, config] of Object.entries(data as Record<string, unknown>)) {
          if (!config || typeof config !== "object") continue;
          const c = config as Record<string, unknown>;
          linkedServices.push({
            name: lsName,
            type: (c.type as string) ?? "unknown",
            ...(c.serviceUri ? { serviceUri: c.serviceUri as string } : {}),
            ...(c.connectionString ? { connectionString: c.connectionString as string } : {}),
            ...(c.baseUrl ? { baseUrl: c.baseUrl as string } : {}),
            ...(c.connectVia ? { connectVia: c.connectVia as string } : {}),
            ...(c.secretName ? { secretName: c.secretName as string } : {}),
          });
        }
      }
    } catch (err) {
      return { target, linkedServices: [], error: `Failed to parse ${endpointsFile}: ${String(err)}` };
    }
  }

  const paramsFile = join(envPath, "config", "parameters", `parameters_${target}.json`);
  if (existsSync(paramsFile)) {
    try {
      const data = JSON.parse(readFileSync(paramsFile, "utf-8")) as Record<string, unknown>;
      factoryName = data.factoryName as string | undefined;
    } catch { /* optional */ }
  }

  if (linkedServices.length === 0) {
    const lsFromGraph = loadFromLinkedServiceFiles(target, envPath);
    if (lsFromGraph.length > 0) {
      linkedServices.push(...lsFromGraph);
    }
  }

  if (linkedServices.length === 0) {
    return { target, linkedServices: [], error: `No endpoint config found for target '${target}' in ${envPath}` };
  }

  return { target, factoryName, linkedServices };
}

function loadFromLinkedServiceFiles(target: string, envPath: string): LinkedServiceEndpoint[] {
  const lsDir = join(envPath, "linkedService");
  if (!existsSync(lsDir)) return [];

  const results: LinkedServiceEndpoint[] = [];
  let entries: string[];
  try {
    entries = readdirSync(lsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== ".json") continue;
    try {
      const data = JSON.parse(readFileSync(join(lsDir, entry), "utf-8")) as Record<string, unknown>;
      const name = data.name as string;
      const props = data.properties as Record<string, unknown> | undefined;
      if (!name || !props) continue;
      const typeProps = props.typeProperties as Record<string, unknown> | undefined;
      if (!typeProps) continue;

      const connectVia = (props.connectVia as Record<string, unknown> | undefined)?.referenceName as string | undefined;
      results.push({
        name,
        type: (props.type as string) ?? "unknown",
        ...(typeProps.serviceUri && typeof typeProps.serviceUri === "string" ? { serviceUri: typeProps.serviceUri } : {}),
        ...(typeProps.connectionString && typeof typeProps.connectionString === "string" ? { connectionString: typeProps.connectionString } : {}),
        ...(typeProps.baseUrl && typeof typeProps.baseUrl === "string" ? { baseUrl: typeProps.baseUrl } : {}),
        ...(connectVia ? { connectVia } : {}),
      });
    } catch { /* skip unparseable files */ }
  }

  return results;
}

export function clearEnvironmentConfigCache(): void {
  endpointConfigCache.clear();
}
