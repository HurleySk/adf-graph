import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { lookupPipelineNode, resolveEntityName, getEntityAttributes, resolveDestQueryDefaults } from "./toolUtils.js";
import { extractDestQueryAliases } from "../parsers/destQueryParser.js";
import { asNonDynamic } from "../utils/expressionValue.js";

const SYSTEM_ATTRIBUTES = new Set([
  "statecode", "statuscode", "ownerid", "modifiedby", "createdby",
  "createdon", "modifiedon", "overriddencreatedon", "importsequencenumber",
  "timezoneruleversionnumber", "utcconversiontimezonecode", "versionnumber",
]);

export interface ColumnValidation {
  alias: string;
  status: "valid" | "invalid" | "system" | "annotation";
}

export interface ActivityValidation {
  activityId: string;
  activityName: string;
  entityName: string;
  entityFound: boolean;
  columns: ColumnValidation[];
  destQuery: string;
}

export interface ValidatePipelineResult {
  pipeline: string;
  activities: ActivityValidation[];
  summary: {
    totalActivities: number;
    totalColumns: number;
    validColumns: number;
    invalidColumns: number;
    systemColumns: number;
    annotationColumns: number;
  };
  warnings: string[];
  error?: string;
}

export function classifyAlias(
  alias: string,
  entityAttrs: Set<string> | null,
): ColumnValidation {
  if (alias.includes("@")) {
    return { alias, status: "annotation" };
  }
  const aliasLower = alias.toLowerCase();
  if (SYSTEM_ATTRIBUTES.has(aliasLower)) {
    return { alias, status: "system" };
  }
  if (!entityAttrs) {
    return { alias, status: "valid" };
  }
  return { alias, status: entityAttrs.has(aliasLower) ? "valid" : "invalid" };
}

export function validateDestQueryActivity(
  graph: Graph,
  activityNode: GraphNode,
  schemaPath?: string,
): { validation: ActivityValidation; warnings: string[] } | null {
  const params = activityNode.metadata.pipelineParameters as Record<string, unknown> | undefined;
  if (!params) return null;

  const destQuery = asNonDynamic(params.dest_query);
  if (!destQuery) return null;

  const entityName = resolveEntityName(graph, activityNode);
  if (!entityName) return null;

  const warnings: string[] = [];
  const parseResult = extractDestQueryAliases(destQuery);
  warnings.push(...parseResult.warnings);

  const entityAttrs = getEntityAttributes(graph, entityName, schemaPath);
  const entityFound = entityAttrs !== null;
  const columns = parseResult.aliases.map((a) => classifyAlias(a.alias, entityAttrs));

  return {
    validation: {
      activityId: activityNode.id,
      activityName: activityNode.name,
      entityName,
      entityFound,
      columns,
      destQuery,
    },
    warnings,
  };
}

export function validatePipelineDefaults(
  graph: Graph,
  pipelineNode: GraphNode,
  schemaPath?: string,
): { validation: ActivityValidation; warnings: string[] } | null {
  const defaults = resolveDestQueryDefaults(pipelineNode);
  if (!defaults) return null;

  const warnings: string[] = [];
  const parseResult = extractDestQueryAliases(defaults.destQuery);
  warnings.push(...parseResult.warnings);

  const entityAttrs = getEntityAttributes(graph, defaults.entityName, schemaPath);
  const entityFound = entityAttrs !== null;
  const columns = parseResult.aliases.map((a) => classifyAlias(a.alias, entityAttrs));

  return {
    validation: {
      activityId: defaults.pipelineId,
      activityName: `${defaults.pipelineName} (parameter default)`,
      entityName: defaults.entityName,
      entityFound,
      columns,
      destQuery: defaults.destQuery,
    },
    warnings,
  };
}

export function handleValidatePipeline(
  graph: Graph,
  pipeline: string,
  schemaPath?: string,
): ValidatePipelineResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error) {
    return {
      pipeline,
      activities: [],
      summary: { totalActivities: 0, totalColumns: 0, validColumns: 0, invalidColumns: 0, systemColumns: 0, annotationColumns: 0 },
      warnings: [],
      error: lookup.error,
    };
  }

  const warnings: string[] = [];
  const activities: ActivityValidation[] = [];

  const contained = graph.getOutgoing(lookup.id);
  for (const edge of contained) {
    if (edge.type !== EdgeType.Contains) continue;
    const actNode = graph.getNode(edge.to);
    if (!actNode || actNode.type !== NodeType.Activity) continue;

    const result = validateDestQueryActivity(graph, actNode, schemaPath);
    if (!result) continue;

    activities.push(result.validation);
    warnings.push(...result.warnings);
  }

  const defaultResult = validatePipelineDefaults(graph, lookup.node!, schemaPath);
  if (defaultResult) {
    activities.push(defaultResult.validation);
    warnings.push(...defaultResult.warnings);
  }

  const totalColumns = activities.reduce((sum, a) => sum + a.columns.length, 0);
  const validColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "valid").length, 0);
  const invalidColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "invalid").length, 0);
  const systemColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "system").length, 0);
  const annotationColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "annotation").length, 0);

  return {
    pipeline,
    activities,
    summary: {
      totalActivities: activities.length,
      totalColumns,
      validColumns,
      invalidColumns,
      systemColumns,
      annotationColumns,
    },
    warnings,
  };
}
