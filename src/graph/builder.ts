import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, extname, basename } from "path";
import { Graph, GraphNode, GraphEdge, NodeType, EdgeType } from "./model.js";
import { ADF_DIRS } from "../constants.js";
import { inferNodeType, parseNodeId } from "../utils/nodeId.js";
import { ParseResult, parsePipelineFile } from "../parsers/pipeline.js";
import { extractColumnMappings } from "../parsers/columns.js";
import { CONTAINER_TYPES } from "../parsers/activities/container.js";
import { parseDatasetFile } from "../parsers/dataset.js";
import { parseLinkedServiceFile } from "../parsers/linkedService.js";
import { scanSqlDirectory } from "../parsers/sql.js";
import { parseSpBody } from "../parsers/spColumnParser.js";

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
 * Generic helper that reads JSON files from a directory, parses each with the
 * given parser, and merges the results into the graph.  An optional postProcess
 * callback runs after a successful parse (used for column-mapping extraction in
 * the pipeline pass).
 */
function processJsonDirectory(
  rootPath: string,
  dirName: string,
  parser: (json: unknown) => ParseResult,
  graph: Graph,
  warnings: string[],
  postProcess?: (filePath: string, json: unknown, graph: Graph) => void,
): void {
  const dir = join(rootPath, dirName);
  if (!existsSync(dir)) return;

  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    warnings.push(`Failed to read ${dirName} dir: ${String(err)}`);
    return;
  }

  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== ".json") continue;
    const filePath = join(dir, entry);
    try {
      const json = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
      const result = parser(json);
      warnings.push(...result.warnings);
      merge(graph, result);
      if (postProcess) {
        postProcess(filePath, json, graph);
      }
    } catch (err) {
      warnings.push(`Failed to parse ${dirName} file '${entry}': ${String(err)}`);
    }
  }
}

function extractColumnMappingsRecursive(
  activities: unknown[],
  pipelineName: string,
  prefix: string,
  graph: Graph,
): void {
  for (const act of activities) {
    const activity = act as Record<string, unknown>;
    const activityName = activity.name as string;
    const activityType = activity.type as string;
    const fullPrefix = `${prefix}${activityName}`;

    if (activityType === "Copy") {
      const activityId = `activity:${pipelineName}/${fullPrefix}`;
      const colEdges = extractColumnMappings(activityId, activity);
      for (const edge of colEdges) {
        graph.addEdge(edge);
      }
    }

    const containerProps = CONTAINER_TYPES[activityType];
    if (containerProps) {
      const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;
      if (typeProperties) {
        for (const key of containerProps) {
          const innerActivities = (typeProperties[key] as unknown[]) ?? [];
          extractColumnMappingsRecursive(innerActivities, pipelineName, `${fullPrefix}/`, graph);
        }
      }
    }
  }
}

function extractPipelineColumnMappings(_filePath: string, json: unknown, graph: Graph): void {
  const root = json as Record<string, unknown>;
  const pipelineName = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;
  const activities = (properties?.activities as unknown[]) ?? [];
  extractColumnMappingsRecursive(activities, pipelineName, "", graph);
}


/**
 * Build a dependency graph from an ADF artifact root directory.
 *
 * Pass 1 — Pipelines:        reads pipeline/*.json
 * Pass 2 — Datasets:         reads dataset/*.json
 * Pass 3 — Linked Services:  reads linkedService/*.json
 * Pass 4 — SQL:              scans each subdirectory under "SQL DB/"
 * Pass 5 — Stubs:            creates stub nodes for any referenced IDs with no node
 */
export function buildGraph(rootPath: string): BuildResult {
  const start = Date.now();
  const graph = new Graph();
  const warnings: string[] = [];

  // ── Pass 1: Pipelines ────────────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.PIPELINE, parsePipelineFile, graph, warnings, extractPipelineColumnMappings);

  // ── Pass 2: Datasets ─────────────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.DATASET, parseDatasetFile, graph, warnings);

  // ── Pass 3: Linked Services ───────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.LINKED_SERVICE, parseLinkedServiceFile, graph, warnings);

  // ── Pass 4: SQL ───────────────────────────────────────────────────────────
  const sqlBaseDir = join(rootPath, ADF_DIRS.SQL);
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

  // ── Pass 4b: SP column-level mappings ──────────────────────────────────────
  const spNodes = graph.getNodesByType(NodeType.StoredProcedure);
  for (const spNode of spNodes) {
    const filePath = spNode.metadata.filePath as string | undefined;
    if (!filePath || !existsSync(filePath)) continue;

    let sqlContent: string;
    try {
      sqlContent = readFileSync(filePath, "utf-8");
    } catch (err) {
      warnings.push(`Failed to read SP file '${filePath}': ${String(err)}`);
      continue;
    }

    const parseResult = parseSpBody(spNode.name, sqlContent);
    warnings.push(...parseResult.warnings);

    // Store confidence on SP node metadata
    spNode.metadata.spConfidence = parseResult.confidence;
    spNode.metadata.spMappingCount = parseResult.mappings.length;
    graph.replaceNode(spNode);

    // Add reads_from edges: SP → source table
    for (const sourceTable of parseResult.readTables) {
      const tableNodeId = `${NodeType.Table}:${sourceTable}`;
      const edge: GraphEdge = {
        from: spNode.id,
        to: tableNodeId,
        type: EdgeType.ReadsFrom,
        metadata: {},
      };
      graph.addEdge(edge);
    }

    // Add writes_to edges: SP → target table
    for (const targetTable of parseResult.writeTables) {
      const tableNodeId = `${NodeType.Table}:${targetTable}`;
      const edge: GraphEdge = {
        from: spNode.id,
        to: tableNodeId,
        type: EdgeType.WritesTo,
        metadata: {},
      };
      graph.addEdge(edge);
    }

    // Add maps_column edges (SP self-edges) for each column mapping
    for (const mapping of parseResult.mappings) {
      const edge: GraphEdge = {
        from: spNode.id,
        to: spNode.id,
        type: EdgeType.MapsColumn,
        metadata: {
          sourceTable: mapping.sourceTable,
          sourceColumn: mapping.sourceColumn,
          targetTable: mapping.targetTable,
          targetColumn: mapping.targetColumn,
          ...(mapping.transformExpression ? { transformExpression: mapping.transformExpression } : {}),
        },
      };
      graph.addEdge(edge);
    }
  }

  // ── Pass 5: Stub nodes ────────────────────────────────────────────────────
  const referencedIds = graph.getAllReferencedIds();
  for (const id of referencedIds) {
    if (!graph.getNode(id)) {
      const nodeType = inferNodeType(id);
      if (!nodeType) continue; // skip unknown prefixes
      const name = parseNodeId(id).name;
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
