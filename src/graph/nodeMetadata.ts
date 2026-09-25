import { GraphNode, GraphEdge } from "./model.js";
import type { FilterCondition } from "../parsers/sqlWhereParser.js";

export interface ParameterDef {
  name: string;
  type: string;
  defaultValue: unknown;
}

export function hasEmptyDefault(param: ParameterDef): boolean {
  return param.defaultValue === "" || param.defaultValue === null || param.defaultValue === undefined;
}

export interface ActivityMetadata {
  activityType: string;
  sqlQuery?: string;
  sqlWhereClause?: string;
  sqlFilterConditions?: FilterCondition[];
  fetchXmlQuery?: string;
  storedProcedureName?: string;
  storedProcedureParameters?: Record<string, unknown>;
  pipelineParameters?: Record<string, unknown>;
  executedPipeline?: string;
  sourceType?: string;
  sinkType?: string;
  sinkWriteBehavior?: string;
  sinkIgnoreNullValues?: boolean;
  sinkAlternateKeyName?: string;
}

export function getParameterDefs(node: GraphNode): ParameterDef[] {
  const params = node.metadata.parameters;
  if (!Array.isArray(params)) return [];
  return params as ParameterDef[];
}

export function getActivityType(node: GraphNode): string {
  return (node.metadata.activityType as string) ?? "Unknown";
}

export function getActivityMetadata(node: GraphNode): ActivityMetadata {
  const m = node.metadata;
  return {
    activityType: (m.activityType as string) ?? "Unknown",
    sqlQuery: m.sqlQuery as string | undefined,
    sqlWhereClause: m.sqlWhereClause as string | undefined,
    sqlFilterConditions: m.sqlFilterConditions as FilterCondition[] | undefined,
    fetchXmlQuery: m.fetchXmlQuery as string | undefined,
    storedProcedureName: m.storedProcedureName as string | undefined,
    storedProcedureParameters: m.storedProcedureParameters as Record<string, unknown> | undefined,
    pipelineParameters: m.pipelineParameters as Record<string, unknown> | undefined,
    executedPipeline: m.executedPipeline as string | undefined,
    sourceType: m.sourceType as string | undefined,
    sinkType: m.sinkType as string | undefined,
    sinkWriteBehavior: m.sinkWriteBehavior as string | undefined,
    sinkIgnoreNullValues: m.sinkIgnoreNullValues as boolean | undefined,
    sinkAlternateKeyName: m.sinkAlternateKeyName as string | undefined,
  };
}

export function isStub(node: GraphNode): boolean {
  return node.metadata.stub === true;
}

export interface ColumnInfo {
  name: string;
  type?: string;
  nullable?: boolean;
}

export interface TableMetadata {
  filePath?: string;
  columns: ColumnInfo[];
  columnCount: number;
}

export function getTableMetadata(node: GraphNode): TableMetadata {
  const m = node.metadata;
  const columns = (m.columns as ColumnInfo[] | undefined) ?? [];
  return {
    filePath: m.filePath as string | undefined,
    columns,
    columnCount: (m.columnCount as number | undefined) ?? columns.length,
  };
}

export interface SpParameterInfo {
  name: string;
  type: string;
}

export interface SpMetadata {
  filePath?: string;
  parameters: SpParameterInfo[];
  spConfidence: string;
  spMappingCount: number;
}

export function getSpMetadata(node: GraphNode): SpMetadata {
  const m = node.metadata;
  return {
    filePath: m.filePath as string | undefined,
    parameters: (m.parameters as SpParameterInfo[] | undefined) ?? [],
    spConfidence: (m.spConfidence as string | undefined) ?? "unknown",
    spMappingCount: (m.spMappingCount as number | undefined) ?? 0,
  };
}

export interface EntityMetadata {
  displayName?: string;
  entitySetName?: string;
  primaryId?: string;
  primaryName?: string;
  attributeCount?: number;
  schemaFile?: string;
}

export function getEntityMetadata(node: GraphNode): EntityMetadata {
  const m = node.metadata;
  return {
    displayName: m.displayName as string | undefined,
    entitySetName: m.entitySetName as string | undefined,
    primaryId: m.primaryId as string | undefined,
    primaryName: m.primaryName as string | undefined,
    attributeCount: m.attributeCount as number | undefined,
    schemaFile: m.schemaFile as string | undefined,
  };
}

export interface LinkedServiceMetadata {
  linkedServiceType: string;
  connectionProperties: Record<string, string>;
}

export function getLinkedServiceMetadata(node: GraphNode): LinkedServiceMetadata {
  const m = node.metadata;
  return {
    linkedServiceType: (m.linkedServiceType as string | undefined) ?? "",
    connectionProperties: (m.connectionProperties as Record<string, string> | undefined) ?? {},
  };
}

export interface ColumnMappingMetadata {
  sourceColumn: string | null;
  sinkColumn: string | null;
  targetColumn: string | null;
  sourceTable?: string;
  targetTable?: string;
  transformExpression?: string;
}

export function getColumnMappingMetadata(edge: GraphEdge): ColumnMappingMetadata {
  const m = edge.metadata;
  return {
    sourceColumn: (m.sourceColumn as string | null | undefined) ?? null,
    sinkColumn: (m.sinkColumn as string | null | undefined) ?? null,
    targetColumn: (m.targetColumn as string | null | undefined) ?? null,
    sourceTable: (m.sourceTable as string | undefined) || undefined,
    targetTable: (m.targetTable as string | undefined) || undefined,
    transformExpression: (m.transformExpression as string | undefined) || undefined,
  };
}
