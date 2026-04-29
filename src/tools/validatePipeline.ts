import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { lookupPipelineNode, resolveEntityName } from "./toolUtils.js";
import { loadEntityDetail } from "../parsers/dataverseSchema.js";
import { extractDestQueryAliases } from "../parsers/destQueryParser.js";

const SYSTEM_ATTRIBUTES = new Set([
  "statecode", "statuscode", "ownerid", "modifiedby", "createdby",
  "createdon", "modifiedon", "overriddencreatedon", "importsequencenumber",
  "timezoneruleversionnumber", "utcconversiontimezonecode", "versionnumber",
]);

export interface ColumnValidation {
  alias: string;
  status: "valid" | "invalid" | "system";
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

export function validateDestQueryActivity(
  graph: Graph,
  activityNode: GraphNode,
  schemaPath?: string,
): { validation: ActivityValidation; warnings: string[] } | null {
  const params = activityNode.metadata.pipelineParameters as Record<string, unknown> | undefined;
  if (!params) return null;

  const destQuery = params.dest_query;
  if (typeof destQuery !== "string") return null;
  if (destQuery.startsWith("@")) return null;

  const entityName = resolveEntityName(graph, activityNode);
  if (!entityName) return null;

  const warnings: string[] = [];
  const parseResult = extractDestQueryAliases(destQuery);
  warnings.push(...parseResult.warnings);

  const entityAttrs = getEntityAttributes(graph, entityName, schemaPath);
  const entityFound = entityAttrs !== null;

  const columns: ColumnValidation[] = parseResult.aliases.map((a) => {
    const aliasLower = a.alias.toLowerCase();
    if (SYSTEM_ATTRIBUTES.has(aliasLower)) {
      return { alias: a.alias, status: "system" as const };
    }
    if (!entityFound) {
      return { alias: a.alias, status: "valid" as const };
    }
    return {
      alias: a.alias,
      status: entityAttrs!.has(aliasLower) ? "valid" as const : "invalid" as const,
    };
  });

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
      summary: { totalActivities: 0, totalColumns: 0, validColumns: 0, invalidColumns: 0, systemColumns: 0 },
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

  const totalColumns = activities.reduce((sum, a) => sum + a.columns.length, 0);
  const validColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "valid").length, 0);
  const invalidColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "invalid").length, 0);
  const systemColumns = activities.reduce((sum, a) => sum + a.columns.filter((c) => c.status === "system").length, 0);

  return {
    pipeline,
    activities,
    summary: {
      totalActivities: activities.length,
      totalColumns,
      validColumns,
      invalidColumns,
      systemColumns,
    },
    warnings,
  };
}
