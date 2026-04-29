import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { lookupPipelineNode, resolveEntityName } from "./toolUtils.js";
import { loadEntityDetail } from "../parsers/dataverseSchema.js";
import { extractDestQueryAliases } from "../parsers/destQueryParser.js";
import { getParameterDefs } from "../graph/nodeMetadata.js";
import { asString } from "../utils/expressionValue.js";

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

function getEntityAttributes(
  graph: Graph,
  entityName: string,
  schemaPath?: string,
): Set<string> | null {
  const entityNodeId = `${NodeType.DataverseEntity}:${entityName}`;
  const entityNode = graph.getNode(entityNodeId);
  if (!entityNode) return null;

  const attrs = new Set<string>();

  // From graph HasAttribute edges
  const outgoing = graph.getOutgoing(entityNodeId);
  for (const edge of outgoing) {
    if (edge.type !== EdgeType.HasAttribute) continue;
    const attrNode = graph.getNode(edge.to);
    if (attrNode) {
      const name = attrNode.name.includes(".") ? attrNode.name.split(".").pop()! : attrNode.name;
      attrs.add(name.toLowerCase());
    }
  }

  if (schemaPath && entityNode.metadata.schemaFile) {
    const detail = loadEntityDetail(schemaPath, entityNode.metadata.schemaFile as string);
    if (detail) {
      for (const attr of detail.attributes) {
        attrs.add(attr.logicalName.toLowerCase());
      }
    }
  }

  return attrs;
}

function classifyAlias(
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

  const destQuery = asString(params.dest_query);
  if (!destQuery) return null;
  if (destQuery.startsWith("@")) return null;

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
  const paramDefs = getParameterDefs(pipelineNode);
  const destQueryParam = paramDefs.find((p) => p.name === "dest_query");
  const destQueryDefault = asString(destQueryParam?.defaultValue);
  if (!destQueryDefault || destQueryDefault.startsWith("@")) return null;

  const entityParam = paramDefs.find((p) => p.name === "dataverse_entity_name");
  const entityDefault = asString(entityParam?.defaultValue);
  if (!entityDefault || entityDefault.startsWith("@")) return null;

  const warnings: string[] = [];
  const parseResult = extractDestQueryAliases(destQueryDefault);
  warnings.push(...parseResult.warnings);

  const entityAttrs = getEntityAttributes(graph, entityDefault, schemaPath);
  const entityFound = entityAttrs !== null;

  const columns = parseResult.aliases.map((a) => classifyAlias(a.alias, entityAttrs));

  return {
    validation: {
      activityId: pipelineNode.id,
      activityName: `${pipelineNode.name} (parameter default)`,
      entityName: entityDefault,
      entityFound,
      columns,
      destQuery: destQueryDefault,
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

  // Find all activities contained by this pipeline
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
