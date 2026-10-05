import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata, getColumnMappingMetadata } from "../graph/nodeMetadata.js";
import { collectPipelineActivities } from "../graph/traversalUtils.js";
import { resolveSelect, resolveRefs, type ColumnRef, type ResolvedSelect } from "../parsers/selectResolver.js";
import { stripSqlComments } from "../parsers/sqlLex.js";
import { asNonDynamic } from "../utils/expressionValue.js";
import { makeEntityId, makePipelineId } from "../utils/nodeId.js";
import { DATAVERSE_SINK_TYPES, getActivityDestQuery, getWrittenEntity, resolveEntityName, resolveNode } from "./toolUtils.js";

export type Rule = "Direct" | "Lookup" | "Choice map" | "Derived" | "Constant" | "Date conversion";

export interface ColumnSource {
  table: string;
  column: string;
}

export interface ColumnLineageRow {
  pipeline: string;
  activity: string;
  activityId: string;
  attribute: string;
  expression: string;
  rule: Rule;
  staging: ColumnSource[];
  legacy: ColumnSource[];
  transforms: string[];
  lookupEntity: string | null;
  joinCondition: string | null;
  warnings: string[];
}

export interface ColumnLineageResult {
  entity: string;
  pipeline: string | null;
  activities: string[];
  rows: ColumnLineageRow[];
  warnings: string[];
  error?: string;
}

interface Writer {
  pipeline: string;
  activity: GraphNode;
  sql: string | null;
  mapped: Map<string, string> | null;
}

interface Trace {
  legacy: ColumnSource[];
  transforms: string[];
  lookupEntity: string | null;
  warnings: string[];
}

const LEGACY_SOURCE_TYPES = new Set(["SqlServerSource"]);
const MAX_DEPTH = 6;
const DATE_FN = /\b(?:DATEADD|SWITCHOFFSET|TODATETIMEOFFSET)\s*\(|\bAT\s+TIME\s+ZONE\b|\b(?:TRY_)?CAST\s*\([\s\S]*\bAS\s+(?:DATE|DATETIME2?|DATETIMEOFFSET|SMALLDATETIME)\b|\b(?:TRY_)?CONVERT\s*\(\s*(?:DATE|DATETIME2?|DATETIMEOFFSET|SMALLDATETIME)\b/i;
const SIMPLE_REF = /^(?:\[?[\w$#@]+\]?\s*\.\s*)?\[?[\w$#@]+\]?$/;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const qualify = (t: string) => (t.includes(".") ? t : `dbo.${t}`);
const bareTable = (t: string) => qualify(t).toLowerCase();
const tableOf = (id: string) => id.slice(NodeType.Table.length + 1);

export function classifyRule(expression: string, refCount: number, lookupEntity: string | null, transforms: string[] = []): Rule {
  const e = stripSqlComments(expression).trim();
  if (lookupEntity) return "Lookup";
  if (/^CASE\b/i.test(e) && /\bTHEN\s+-?\d+\b/i.test(e)) return "Choice map";
  if (refCount === 0) return "Constant";
  if (DATE_FN.test([e, ...transforms].join("\n"))) return "Date conversion";
  if (SIMPLE_REF.test(e) && transforms.length === 0) return "Direct";
  return "Derived";
}

function emptyTrace(): Trace {
  return { legacy: [], transforms: [], lookupEntity: null, warnings: [] };
}

function addSource(list: ColumnSource[], s: ColumnSource): void {
  if (!list.some((x) => same(x.table, s.table) && same(x.column, s.column))) list.push(s);
}

function mergeTrace(into: Trace, from: Trace): void {
  for (const l of from.legacy) addSource(into.legacy, l);
  for (const t of from.transforms) if (!into.transforms.includes(t)) into.transforms.push(t);
  into.lookupEntity ??= from.lookupEntity;
  into.warnings.push(...from.warnings);
}

function sourceColumnFor(graph: Graph, activityId: string, sinkColumn: string): string {
  for (const edge of graph.getOutgoing(activityId, EdgeType.MapsColumn)) {
    const m = getColumnMappingMetadata(edge);
    if (m.sinkColumn && m.sourceColumn && same(m.sinkColumn, sinkColumn)) return m.sourceColumn;
  }
  return sinkColumn;
}

function readTables(graph: Graph, activityId: string): string[] {
  return graph
    .getOutgoing(activityId, EdgeType.ReadsFrom)
    .filter((e) => e.to.startsWith(`${NodeType.Table}:`))
    .map((e) => tableOf(e.to));
}

function readEntity(graph: Graph, activityId: string): string | null {
  const e = graph.getOutgoing(activityId, EdgeType.ReadsFrom).find((x) => x.to.startsWith(`${NodeType.DataverseEntity}:`));
  return e ? e.to.slice(NodeType.DataverseEntity.length + 1) : null;
}

function activitySql(activity: GraphNode): string | null {
  const meta = getActivityMetadata(activity);
  const sql = meta.sqlQuery ?? asNonDynamic(meta.pipelineParameters?.source_query) ?? null;
  return sql && !sql.trim().startsWith("@") ? sql : null;
}

function readsLegacy(graph: Graph, activity: GraphNode): boolean {
  const meta = getActivityMetadata(activity);
  if (meta.sourceType && LEGACY_SOURCE_TYPES.has(meta.sourceType)) return true;
  if (meta.activityType !== "ExecutePipeline" || !meta.executedPipeline) return false;
  return collectPipelineActivities(graph, makePipelineId(meta.executedPipeline)).some((a) => {
    const t = getActivityMetadata(a).sourceType;
    return !!t && LEGACY_SOURCE_TYPES.has(t);
  });
}

function copyInputs(graph: Graph, activity: GraphNode, column: string): ColumnRef[] {
  const srcColumn = sourceColumnFor(graph, activity.id, column);
  const sql = activitySql(activity);
  if (sql) {
    const sel = resolveSelect(sql);
    const item = sel.items.find((it) => same(it.alias, srcColumn));
    if (item) return item.refs;
    if (!sel.star) return [];
  }
  return readTables(graph, activity.id).map((table) => ({ qualifier: null, column: srcColumn, table, derived: false }));
}

function traceColumn(graph: Graph, table: string, column: string, depth: number, visited: Set<string>): Trace {
  const trace = emptyTrace();
  const key = `${bareTable(table)}|${column.toLowerCase()}`;
  if (visited.has(key) || depth > MAX_DEPTH) return trace;
  visited.add(key);
  const tableId = resolveNode(graph, NodeType.Table, table);
  if (!tableId) {
    trace.warnings.push(`${table}: not in the graph`);
    return trace;
  }
  for (const edge of graph.getIncoming(tableId, EdgeType.WritesTo)) {
    const writer = graph.getNode(edge.from);
    if (!writer) continue;
    if (writer.type === NodeType.StoredProcedure) {
      for (const mapEdge of graph.getOutgoing(writer.id, EdgeType.MapsColumn)) {
        const m = getColumnMappingMetadata(mapEdge);
        if (!m.targetTable || !m.targetColumn || !m.sourceTable || !m.sourceColumn) continue;
        if (bareTable(m.targetTable) !== bareTable(table) || !same(m.targetColumn, column)) continue;
        if (m.transformExpression && !trace.transforms.includes(m.transformExpression)) trace.transforms.push(m.transformExpression);
        if (bareTable(m.sourceTable) === bareTable(table) && same(m.sourceColumn, column)) continue;
        mergeTrace(trace, traceColumn(graph, m.sourceTable, m.sourceColumn, depth + 1, visited));
      }
      continue;
    }
    if (writer.type !== NodeType.Activity) continue;
    const entity = readEntity(graph, writer.id);
    if (entity) {
      trace.lookupEntity ??= entity;
      continue;
    }
    const legacy = readsLegacy(graph, writer);
    for (const ref of copyInputs(graph, writer, column)) {
      if (!ref.table) continue;
      if (legacy) addSource(trace.legacy, { table: qualify(ref.table), column: ref.column });
      else mergeTrace(trace, traceColumn(graph, ref.table, ref.column, depth + 1, visited));
    }
  }
  return trace;
}

function writerFor(graph: Graph, pipeline: string, act: GraphNode, entity: string): Writer | null {
  const destQuery = getActivityDestQuery(graph, act);
  if (destQuery) {
    if (destQuery.trim().startsWith("@")) return null;
    const name = resolveEntityName(graph, act);
    return name && same(name, entity) ? { pipeline, activity: act, sql: destQuery, mapped: null } : null;
  }
  const meta = getActivityMetadata(act);
  if (meta.activityType !== "Copy" || !meta.sinkType || !DATAVERSE_SINK_TYPES.has(meta.sinkType)) return null;
  const written = getWrittenEntity(graph, act.id);
  if (!written || !same(written, entity)) return null;
  const mapped = new Map<string, string>();
  for (const edge of graph.getOutgoing(act.id, EdgeType.MapsColumn)) {
    const { sourceColumn, sinkColumn } = getColumnMappingMetadata(edge);
    if (sourceColumn && sinkColumn) mapped.set(sinkColumn, sourceColumn);
  }
  return { pipeline, activity: act, sql: activitySql(act), mapped: mapped.size ? mapped : null };
}

function rowsFor(graph: Graph, writer: Writer): { rows: ColumnLineageRow[]; warnings: string[] } {
  const sel: ResolvedSelect | null = writer.sql ? resolveSelect(writer.sql) : null;
  const attrs: [string, string][] = writer.mapped
    ? [...writer.mapped]
    : (sel?.items ?? []).map((it) => [it.alias, it.alias] as [string, string]);
  const tables = readTables(graph, writer.activity.id);
  const rows: ColumnLineageRow[] = [];
  for (const [attribute, srcColumn] of attrs) {
    const item = sel?.items.find((it) => same(it.alias, srcColumn));
    const expression = item?.expression ?? srcColumn;
    const refs: ColumnRef[] = item ? item.refs : tables.map((table) => ({ qualifier: null, column: srcColumn, table, derived: false }));
    const trace = emptyTrace();
    const staging: ColumnSource[] = [];
    const warnings: string[] = [];
    let joinCondition: string | null = null;
    for (const ref of refs) {
      if (!ref.table) {
        warnings.push(`${ref.qualifier ?? "?"}.${ref.column}: source not resolved`);
        continue;
      }
      addSource(staging, { table: qualify(ref.table), column: ref.column });
      const t = traceColumn(graph, ref.table, ref.column, 0, new Set());
      const src = sel && ref.qualifier ? sel.sources.find((s) => same(s.alias, ref.qualifier!)) : undefined;
      if (t.lookupEntity && sel && src?.joinCondition) {
        joinCondition = src.joinCondition;
        for (const key of resolveRefs(src.joinCondition, sel.sources)) {
          if (!key.table || (key.qualifier && same(key.qualifier, ref.qualifier!))) continue;
          mergeTrace(t, { ...traceColumn(graph, key.table, key.column, 0, new Set()), lookupEntity: null });
        }
      }
      mergeTrace(trace, t);
    }
    rows.push({
      pipeline: writer.pipeline,
      activity: writer.activity.name,
      activityId: writer.activity.id,
      attribute,
      expression,
      rule: classifyRule(expression, refs.length, trace.lookupEntity, trace.transforms),
      staging,
      legacy: trace.legacy,
      transforms: trace.transforms,
      lookupEntity: trace.lookupEntity,
      joinCondition,
      warnings: [...warnings, ...trace.warnings],
    });
  }
  return { rows, warnings: sel?.warnings ?? [] };
}

export function handleColumnLineage(graph: Graph, entity: string, pipeline?: string): ColumnLineageResult {
  const target = entity.toLowerCase();
  const result: ColumnLineageResult = { entity: target, pipeline: pipeline ?? null, activities: [], rows: [], warnings: [] };
  if (!graph.getNode(makeEntityId(target))) result.warnings.push(`Entity '${entity}' has no node in the graph`);
  let queue: GraphNode[];
  if (pipeline) {
    const node = graph.getNode(makePipelineId(pipeline));
    if (!node) return { ...result, error: `Pipeline '${pipeline}' not found` };
    queue = [node];
  } else {
    queue = graph.getNodesByType(NodeType.Pipeline);
  }
  const seen = new Set<string>();
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    for (const act of collectPipelineActivities(graph, p.id)) {
      const child = getActivityMetadata(act).executedPipeline;
      if (pipeline && child) {
        const node = graph.getNode(makePipelineId(child));
        if (node) queue.push(node);
      }
      const writer = writerFor(graph, p.name, act, target);
      if (!writer) continue;
      result.activities.push(act.id);
      const { rows, warnings } = rowsFor(graph, writer);
      if (!rows.length) result.warnings.push(`${act.name}: no column list (auto-mapped copy)`);
      result.rows.push(...rows);
      result.warnings.push(...warnings.map((w) => `${act.name}: ${w}`));
    }
  }
  result.rows.sort((a, b) => a.attribute.localeCompare(b.attribute) || a.activity.localeCompare(b.activity));
  return result;
}
