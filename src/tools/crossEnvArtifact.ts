import { GraphManager } from "../graph/manager.js";
import { makeNodeId } from "../utils/nodeId.js";

export interface ArtifactEnvironmentView {
  environment: string;
  found: boolean;
  metadata?: Record<string, unknown>;
}

export interface CrossEnvDiff {
  field: string;
  values: Record<string, unknown>;
  consistent: boolean;
}

export interface CrossEnvArtifactResult {
  artifactName: string;
  artifactType: string;
  environments: ArtifactEnvironmentView[];
  diffs: CrossEnvDiff[];
  error?: string;
}

export function handleCrossEnvArtifact(
  manager: GraphManager,
  name: string,
  artifactType: string,
): CrossEnvArtifactResult {
  const allEnvs = manager.listEnvironments().filter((e) => e.source !== "derived");

  if (allEnvs.length === 0) {
    return { artifactName: name, artifactType, environments: [], diffs: [], error: "No environments configured" };
  }

  const nodeId = makeNodeId(artifactType, name);
  const views: ArtifactEnvironmentView[] = [];

  for (const env of allEnvs) {
    try {
      const { graph } = manager.ensureGraph(env.name);
      const node = graph.getNode(nodeId);
      if (node) {
        views.push({ environment: env.name, found: true, metadata: node.metadata });
      } else {
        views.push({ environment: env.name, found: false });
      }
    } catch {
      views.push({ environment: env.name, found: false });
    }
  }

  const foundViews = views.filter((v) => v.found && v.metadata);
  const diffs = computeDiffs(foundViews);

  return { artifactName: name, artifactType, environments: views, diffs };
}

function computeDiffs(views: ArtifactEnvironmentView[]): CrossEnvDiff[] {
  if (views.length < 2) return [];

  const allKeys = new Set<string>();
  for (const v of views) {
    if (v.metadata) {
      flattenKeys(v.metadata, "", allKeys);
    }
  }

  const diffs: CrossEnvDiff[] = [];
  for (const key of allKeys) {
    const values: Record<string, unknown> = {};
    for (const v of views) {
      values[v.environment] = getNestedValue(v.metadata!, key);
    }

    const vals = Object.values(values);
    const serialized = vals.map((v) => JSON.stringify(v));
    const consistent = serialized.every((s) => s === serialized[0]);

    if (!consistent) {
      diffs.push({ field: key, values, consistent: false });
    }
  }

  return diffs;
}

function flattenKeys(obj: Record<string, unknown>, prefix: string, keys: Set<string>): void {
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenKeys(v as Record<string, unknown>, fullKey, keys);
    } else {
      keys.add(fullKey);
    }
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}
