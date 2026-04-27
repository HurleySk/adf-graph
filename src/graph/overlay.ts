import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";
import { ADF_DIRS } from "../constants.js";
import { Graph, GraphNode, GraphEdge } from "./model.js";
import { parsePipelineFile } from "../parsers/pipeline.js";
import { parseDatasetFile } from "../parsers/dataset.js";
import { buildGraph } from "./builder.js";

const DATASET_TYPES = new Set([
  "AzureSqlTable", "SqlServerTable", "AzureBlobStorage", "AzureBlobFSLocation",
  "DelimitedText", "Json", "Parquet", "Avro", "Orc", "Binary", "Excel",
  "CommonDataServiceForAppsEntity", "DynamicsEntity",
]);

export type ArtifactType = "pipeline" | "dataset" | "sql";

export function detectArtifactType(json: unknown): ArtifactType | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const properties = root.properties as Record<string, unknown> | undefined;
  if (!properties) return null;

  if (Array.isArray(properties.activities)) return "pipeline";

  const typeName = properties.type as string | undefined;
  if (properties.typeProperties && typeName && DATASET_TYPES.has(typeName)) return "dataset";

  return null;
}

export interface OverlayScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

function hasAdfStructure(dirPath: string): boolean {
  const adfDirs = [ADF_DIRS.PIPELINE, ADF_DIRS.DATASET, ADF_DIRS.LINKED_SERVICE, ADF_DIRS.SQL];
  return adfDirs.some((d) => existsSync(join(dirPath, d)));
}

function parseJsonArtifact(filePath: string, label: string): OverlayScanResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  try {
    const json = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    const artifactType = detectArtifactType(json);
    if (artifactType === "pipeline") {
      const result = parsePipelineFile(json);
      nodes.push(...result.nodes); edges.push(...result.edges); warnings.push(...result.warnings);
    } else if (artifactType === "dataset") {
      const result = parseDatasetFile(json);
      nodes.push(...result.nodes); edges.push(...result.edges); warnings.push(...result.warnings);
    } else {
      warnings.push(`Could not determine artifact type for '${label}' — skipping`);
    }
  } catch (err) {
    warnings.push(`Failed to parse overlay file '${label}': ${String(err)}`);
  }
  return { nodes, edges, warnings };
}

function scanLooseFiles(dirPath: string): OverlayScanResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch (err) {
    warnings.push(`Failed to read overlay dir '${dirPath}': ${String(err)}`);
    return { nodes, edges, warnings };
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      const sub = scanLooseFiles(fullPath);
      nodes.push(...sub.nodes);
      edges.push(...sub.edges);
      warnings.push(...sub.warnings);
      continue;
    }

    const ext = extname(entry).toLowerCase();
    if (ext === ".sql") continue;
    if (ext !== ".json") continue;

    const result = parseJsonArtifact(fullPath, entry);
    nodes.push(...result.nodes); edges.push(...result.edges); warnings.push(...result.warnings);
  }
  return { nodes, edges, warnings };
}

function scanSingleFile(filePath: string): OverlayScanResult {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".json") return { nodes: [], edges: [], warnings: [] };
  const label = filePath.split(/[\\/]/).pop() ?? filePath;
  return parseJsonArtifact(filePath, label);
}

/**
 * Deduplicate edges in a graph by (from, to, type) key.
 * Removes duplicate edges from the outgoing/incoming adjacency lists.
 */
function deduplicateEdgeList(edges: GraphEdge[]): void {
  if (edges.length <= 1) return;
  const seen = new Set<string>();
  const dupeIndices: number[] = [];
  for (let i = 0; i < edges.length; i++) {
    const key = `${edges[i].from}|${edges[i].to}|${edges[i].type}`;
    if (seen.has(key)) {
      dupeIndices.push(i);
    } else {
      seen.add(key);
    }
  }
  for (let i = dupeIndices.length - 1; i >= 0; i--) {
    edges.splice(dupeIndices[i], 1);
  }
}

function deduplicateEdges(graph: Graph): void {
  const allNodes = graph.allNodes();
  for (const node of allNodes) {
    deduplicateEdgeList(graph.getOutgoing(node.id));
    deduplicateEdgeList(graph.getIncoming(node.id));
  }
}

export function scanOverlayPath(overlayPath: string): OverlayScanResult {
  if (!existsSync(overlayPath)) {
    return { nodes: [], edges: [], warnings: [`Overlay path not found: '${overlayPath}'`] };
  }
  let stat;
  try { stat = statSync(overlayPath); } catch (err) {
    return { nodes: [], edges: [], warnings: [`Cannot stat overlay path '${overlayPath}': ${String(err)}`] };
  }

  if (!stat.isDirectory()) return scanSingleFile(overlayPath);

  if (hasAdfStructure(overlayPath)) {
    const buildResult = buildGraph(overlayPath);
    return {
      nodes: buildResult.graph.allNodes(),
      edges: buildResult.graph.allEdges(),
      warnings: buildResult.warnings,
    };
  }
  return scanLooseFiles(overlayPath);
}

export function mergeOverlayInto(target: Graph, overlay: Graph): void {
  const overlayNodes = overlay.allNodes();
  const overlayEdges = overlay.allEdges();

  for (const node of overlayNodes) {
    if (node.metadata?.stub && target.getNode(node.id)) {
      continue;
    }
    if (target.getNode(node.id)) {
      target.removeEdgesForNode(node.id);
    }
    target.replaceNode(node);
  }
  for (const edge of overlayEdges) {
    target.addEdge(edge);
  }

  // Deduplicate edges by (from, to, type) after merging
  deduplicateEdges(target);
}
