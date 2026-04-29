import { GraphNode } from "./model.js";
import type { FilterCondition } from "../parsers/sqlWhereParser.js";

export interface ParameterDef {
  name: string;
  type: string;
  defaultValue: unknown;
}

export interface PipelineMetadata {
  parameters: ParameterDef[];
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
