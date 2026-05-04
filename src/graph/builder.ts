import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, extname, basename } from "path";
import { Graph, GraphNode, GraphEdge, NodeType, EdgeType } from "./model.js";
import { ADF_DIRS } from "../constants.js";
import { inferNodeType, parseNodeId, makeNodeId, makeActivityId, makeIntegrationRuntimeId } from "../utils/nodeId.js";
import { ParseResult, parsePipelineFile } from "../parsers/pipeline.js";
import { extractColumnMappings } from "../parsers/columns.js";
import { CONTAINER_TYPES } from "../parsers/activities/container.js";
import { parseDatasetFile } from "../parsers/dataset.js";
import { parseLinkedServiceFile } from "../parsers/linkedService.js";
import { scanSqlDirectory } from "../parsers/sql.js";
import { parseSpBody } from "../parsers/spColumnParser.js";
import { parseSchemaIndex } from "../parsers/dataverseSchema.js";
import { parseTriggerFile } from "../parsers/trigger.js";
import { parseIntegrationRuntimeFile } from "../parsers/integrationRuntime.js";

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
      const activityId = makeActivityId(pipelineName, prefix, activityName);
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
 * Pass 5 — Dataverse Schema: enriches/replaces stub entity nodes from schema index
 * Pass 6 — Stubs:            creates stub nodes for any referenced IDs with no node
 */
export function buildGraph(rootPath: string, schemaPath?: string): BuildResult {
  const start = Date.now();
  const graph = new Graph();
  const warnings: string[] = [];

  // ── Pass 1: Pipelines ────────────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.PIPELINE, parsePipelineFile, graph, warnings, extractPipelineColumnMappings);

  // ── Pass 2: Datasets ─────────────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.DATASET, parseDatasetFile, graph, warnings);

  // ── Pass 3: Linked Services ───────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.LINKED_SERVICE, parseLinkedServiceFile, graph, warnings);

  // ── Pass 3b: Triggers ─────────────────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.TRIGGER, parseTriggerFile, graph, warnings);

  // ── Pass 3c: Integration Runtimes ─────────────────────────────────────────
  processJsonDirectory(rootPath, ADF_DIRS.INTEGRATION_RUNTIME, parseIntegrationRuntimeFile, graph, warnings);

  // ── Pass 3d: LS → IR edges ────────────────────────────────────────────────
  for (const lsNode of graph.getNodesByType(NodeType.LinkedService)) {
    const connProps = lsNode.metadata.connectionProperties as Record<string, string> | undefined;
    const irName = connProps?.connectVia;
    if (irName) {
      const irId = makeIntegrationRuntimeId(irName);
      graph.addEdge({
        from: lsNode.id,
        to: irId,
        type: EdgeType.UsesIntegrationRuntime,
        metadata: {},
      });
    }
  }

  // ── Pass 4: SQL ───────────────────────────────────────────────────────────
  const sqlBaseDir = join(rootPath, ADF_DIRS.SQL);
  let sqlProjects: string[] = [];
  if (existsSync(sqlBaseDir)) {
    try {
      sqlProjects = readdirSync(sqlBaseDir).filter(entry => {
        try { return statSync(join(sqlBaseDir, entry)).isDirectory(); } catch { return false; }
      });
    } catch (err) {
      warnings.push(`Failed to read SQL DB dir: ${String(err)}`);
    }
    for (const project of sqlProjects) {
      const projectPath = join(sqlBaseDir, project);
      try {
        const result = scanSqlDirectory(projectPath);
        warnings.push(...result.warnings);
        merge(graph, result);
      } catch (err) {
        warnings.push(`Failed to scan SQL project '${project}': ${String(err)}`);
      }
    }
  }

  // ── Pass 4b: SQL _index.json enrichment ────────────────────────────────────
  if (existsSync(sqlBaseDir)) {
    for (const project of sqlProjects) {
      const projectPath = join(sqlBaseDir, project);
      const indexPath = join(projectPath, "_index.json");
      if (!existsSync(indexPath)) continue;
      try {
        const indexData = JSON.parse(readFileSync(indexPath, "utf-8")) as Record<string, unknown>;
        const tables = indexData.tables as Array<Record<string, unknown>> | undefined;
        if (tables) {
          for (const tbl of tables) {
            const tblName = tbl.name as string;
            if (!tblName) continue;
            const tableId = makeNodeId(NodeType.Table, `dbo.${tblName}`);
            const tableNode = graph.getNode(tableId);
            if (tableNode) {
              tableNode.metadata.columns = tbl.columns ?? [];
              tableNode.metadata.columnCount = tbl.columnCount ?? (tbl.columns as unknown[] | undefined)?.length ?? 0;
              graph.replaceNode(tableNode);
            }
          }
        }
        const storedProcedures = indexData.storedProcedures as Array<Record<string, unknown>> | undefined;
        if (storedProcedures) {
          for (const sp of storedProcedures) {
            const spName = sp.name as string;
            if (!spName) continue;
            const spId = makeNodeId(NodeType.StoredProcedure, `dbo.${spName}`);
            const spNode = graph.getNode(spId);
            if (spNode) {
              spNode.metadata.parameters = sp.parameters ?? [];
              graph.replaceNode(spNode);
            }
          }
        }
      } catch (err) {
        warnings.push(`Failed to read SQL _index.json in '${project}': ${String(err)}`);
      }
    }
  }

  // ── Pass 4c: SP column-level mappings ─────────────────────────────────────
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
      const tableNodeId = makeNodeId(NodeType.Table, sourceTable);
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
      const tableNodeId = makeNodeId(NodeType.Table, targetTable);
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

  // ── Pass 5: Dataverse Schema ─────────────────────────────────────────────
  if (schemaPath) {
    const schemaResult = parseSchemaIndex(schemaPath);
    warnings.push(...schemaResult.warnings);
    for (const node of schemaResult.nodes) {
      const existing = graph.getNode(node.id);
      if (existing && existing.metadata.stub) {
        graph.replaceNode(node);
      } else if (!existing) {
        graph.addNode(node);
      }
    }
    for (const edge of schemaResult.edges) {
      graph.addEdge(edge);
    }
  }

  // ── Pass 6: Stub nodes ────────────────────────────────────────────────────
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
