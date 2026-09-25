import { Graph } from "../graph/model.js";
import { lookupPipelineNode, getEntityAttributes, iterDestQueryTargets, type DestQueryTarget } from "./toolUtils.js";
import { extractDestQueryAliases } from "../parsers/destQueryParser.js";

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

function validateTarget(
  graph: Graph,
  target: DestQueryTarget,
  schemaPath?: string,
): { validation: ActivityValidation; warnings: string[] } | null {
  if (!target.entityName) return null;

  const parseResult = extractDestQueryAliases(target.destQuery);
  const entityAttrs = getEntityAttributes(graph, target.entityName, schemaPath);

  return {
    validation: {
      activityId: target.id,
      activityName: target.name,
      entityName: target.entityName,
      entityFound: entityAttrs !== null,
      columns: parseResult.aliases.map((a) => classifyAlias(a.alias, entityAttrs)),
      destQuery: target.destQuery,
    },
    warnings: parseResult.warnings,
  };
}

export function handleValidatePipeline(
  graph: Graph,
  pipeline: string,
  schemaPath?: string,
): ValidatePipelineResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
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

  for (const target of iterDestQueryTargets(graph, lookup.node)) {
    const result = validateTarget(graph, target, schemaPath);
    if (!result) continue;

    activities.push(result.validation);
    warnings.push(...result.warnings);
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
