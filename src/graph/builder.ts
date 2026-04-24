import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, extname, basename } from "path";
import { Graph, GraphNode, NodeType } from "./model.js";
import { ParseResult, parsePipelineFile } from "../parsers/pipeline.js";
import { extractColumnMappings } from "../parsers/columns.js";
import { parseDatasetFile } from "../parsers/dataset.js";
import { scanSqlDirectory } from "../parsers/sql.js";

export interface BuildResult {
  graph: Graph;
  warnings: string[];
  buildTimeMs: number;
}

/**
 * Merge a ParseResult into a graph: add any nodes not already present,
 * and add all edges.
 */
function merge(graph: Graph, result: ParseResult): void {
  for (const node of result.nodes) {
    if (!graph.getNode(node.id)) {
      graph.addNode(node);
    }
  }
  for (const edge of result.edges) {
    graph.addEdge(edge);
  }
}

/**
 * Infer NodeType from an ID prefix (e.g., "pipeline:Foo" → NodeType.Pipeline).
 * Returns null for unknown prefixes (e.g., "linked_service:") — caller should skip.
 */
function inferNodeType(id: string): NodeType | null {
  const prefix = id.split(":")[0];
  switch (prefix) {
    case "pipeline":
      return NodeType.Pipeline;
    case "activity":
      return NodeType.Activity;
    case "dataset":
      return NodeType.Dataset;
    case "stored_procedure":
      return NodeType.StoredProcedure;
    case "table":
      return NodeType.Table;
    case "dataverse_entity":
      return NodeType.DataverseEntity;
    default:
      return null;
  }
}

/**
 * Build a dependency graph from an ADF artifact root directory.
 *
 * Pass 1 — Pipelines:  reads pipeline/*.json
 * Pass 2 — Datasets:   reads dataset/*.json
 * Pass 3 — SQL:        scans each subdirectory under "SQL DB/"
 * Pass 4 — Stubs:      creates stub nodes for any referenced IDs with no node
 */
export function buildGraph(rootPath: string): BuildResult {
  const start = Date.now();
  const graph = new Graph();
  const warnings: string[] = [];

  // ── Pass 1: Pipelines ────────────────────────────────────────────────────
  const pipelineDir = join(rootPath, "pipeline");
  if (existsSync(pipelineDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(pipelineDir);
    } catch (err) {
      warnings.push(`Failed to read pipeline dir: ${String(err)}`);
    }
    for (const entry of entries) {
      if (extname(entry).toLowerCase() !== ".json") continue;
      const filePath = join(pipelineDir, entry);
      try {
        const json = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
        const result = parsePipelineFile(json);
        warnings.push(...result.warnings);
        merge(graph, result);

        // Also extract column mappings for Copy activities
        const root = json as Record<string, unknown>;
        const pipelineName = root.name as string;
        const properties = root.properties as Record<string, unknown> | undefined;
        const activities = (properties?.activities as unknown[]) ?? [];
        for (const act of activities) {
          const activity = act as Record<string, unknown>;
          const activityName = activity.name as string;
          const activityType = activity.type as string;
          if (activityType === "Copy") {
            const activityId = `activity:${pipelineName}/${activityName}`;
            const colEdges = extractColumnMappings(activityId, activity);
            for (const edge of colEdges) {
              graph.addEdge(edge);
            }
          }
        }
      } catch (err) {
        warnings.push(`Failed to parse pipeline file '${entry}': ${String(err)}`);
      }
    }
  }

  // ── Pass 2: Datasets ─────────────────────────────────────────────────────
  const datasetDir = join(rootPath, "dataset");
  if (existsSync(datasetDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(datasetDir);
    } catch (err) {
      warnings.push(`Failed to read dataset dir: ${String(err)}`);
    }
    for (const entry of entries) {
      if (extname(entry).toLowerCase() !== ".json") continue;
      const filePath = join(datasetDir, entry);
      try {
        const json = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
        const result = parseDatasetFile(json);
        warnings.push(...result.warnings);
        merge(graph, result);
      } catch (err) {
        warnings.push(`Failed to parse dataset file '${entry}': ${String(err)}`);
      }
    }
  }

  // ── Pass 3: SQL ───────────────────────────────────────────────────────────
  const sqlBaseDir = join(rootPath, "SQL DB");
  if (existsSync(sqlBaseDir)) {
    let projects: string[] = [];
    try {
      projects = readdirSync(sqlBaseDir);
    } catch (err) {
      warnings.push(`Failed to read SQL DB dir: ${String(err)}`);
    }
    for (const project of projects) {
      const projectPath = join(sqlBaseDir, project);
      try {
        const stat = statSync(projectPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      try {
        const result = scanSqlDirectory(projectPath);
        warnings.push(...result.warnings);
        merge(graph, result);
      } catch (err) {
        warnings.push(`Failed to scan SQL project '${project}': ${String(err)}`);
      }
    }
  }

  // ── Pass 4: Stub nodes ────────────────────────────────────────────────────
  const referencedIds = graph.getAllReferencedIds();
  for (const id of referencedIds) {
    if (!graph.getNode(id)) {
      const nodeType = inferNodeType(id);
      if (!nodeType) continue; // skip unknown prefixes (e.g., linked_service:)
      const name = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
      const stub: GraphNode = {
        id,
        type: nodeType,
        name,
        metadata: { stub: true },
      };
      graph.addNode(stub);
    }
  }

  return {
    graph,
    warnings,
    buildTimeMs: Date.now() - start,
  };
}
