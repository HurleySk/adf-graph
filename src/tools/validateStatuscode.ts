import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { lookupPipelineNode, resolveEntityName } from "./toolUtils.js";
import { loadEntityDetail, type OptionSetValue } from "../parsers/dataverseSchema.js";
import {
  extractDestQueryAliases,
  extractCaseValues,
  extractCaseElseValue,
} from "../parsers/destQueryParser.js";
import { getParameterDefs } from "../graph/nodeMetadata.js";
import { asString } from "../utils/expressionValue.js";

const STATUS_ALIASES = new Set(["statuscode", "statecode"]);

export interface StatusCodeValidation {
  activityId: string;
  activityName: string;
  entityName: string;
  alias: string;
  mappedValues: number[];
  validValues: OptionSetValue[];
  invalidValues: number[];
  optionSetAvailable: boolean;
}

export interface ValidateStatusCodeResult {
  pipeline: string;
  validations: StatusCodeValidation[];
  summary: {
    totalActivities: number;
    activitiesWithIssues: number;
    totalInvalidValues: number;
  };
  warnings: string[];
  error?: string;
}

export function handleValidateStatuscode(
  graph: Graph,
  pipeline: string,
  schemaPath?: string,
): ValidateStatusCodeResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error) {
    return {
      pipeline,
      validations: [],
      summary: { totalActivities: 0, activitiesWithIssues: 0, totalInvalidValues: 0 },
      warnings: [],
      error: lookup.error,
    };
  }

  const warnings: string[] = [];
  const validations: StatusCodeValidation[] = [];

  const contained = graph.getOutgoing(lookup.id);
  for (const edge of contained) {
    if (edge.type !== EdgeType.Contains) continue;
    const actNode = graph.getNode(edge.to);
    if (!actNode || actNode.type !== NodeType.Activity) continue;

    const params = actNode.metadata.pipelineParameters as Record<string, unknown> | undefined;
    if (!params) continue;

    const destQuery = asString(params.dest_query);
    if (!destQuery || destQuery.startsWith("@")) continue;

    const entityName = resolveEntityName(graph, actNode);
    if (!entityName) {
      warnings.push(`Activity '${actNode.name}': could not resolve target entity`);
      continue;
    }

    const parseResult = extractDestQueryAliases(destQuery);
    warnings.push(...parseResult.warnings);

    for (const alias of parseResult.aliases) {
      if (!STATUS_ALIASES.has(alias.alias.toLowerCase())) continue;
      if (!alias.isCaseExpression) continue;

      const caseValues = extractCaseValues(alias.expression);
      const elseValue = extractCaseElseValue(alias.expression);
      const mappedValues = caseValues.map((v) => v.thenValue);
      if (elseValue !== undefined) mappedValues.push(elseValue);

      let validOptionSetValues: OptionSetValue[] = [];
      let optionSetAvailable = false;

      if (schemaPath) {
        const entityNodeId = `${NodeType.DataverseEntity}:${entityName}`;
        const entityNode = graph.getNode(entityNodeId);
        if (entityNode?.metadata.schemaFile) {
          const detail = loadEntityDetail(schemaPath, entityNode.metadata.schemaFile as string);
          if (detail) {
            const attr = detail.attributes.find(
              (a) => a.logicalName === alias.alias.toLowerCase()
            );
            if (attr?.optionSet) {
              optionSetAvailable = true;
              validOptionSetValues = attr.optionSet;
            }
          }
        }
      }

      const validSet = new Set(validOptionSetValues.map((v) => v.value));
      const invalidValues = optionSetAvailable
        ? mappedValues.filter((v) => !validSet.has(v))
        : [];

      validations.push({
        activityId: actNode.id,
        activityName: actNode.name,
        entityName,
        alias: alias.alias,
        mappedValues,
        validValues: validOptionSetValues,
        invalidValues,
        optionSetAvailable,
      });
    }
  }

  // Check pipeline-level parameter defaults for dest_query statuscode
  const paramDefs = getParameterDefs(lookup.node!);
  const destQueryParam = paramDefs.find((p) => p.name === "dest_query");
  const destQueryDefault = asString(destQueryParam?.defaultValue);
  if (destQueryDefault && !destQueryDefault.startsWith("@")) {
    const entityParam = paramDefs.find((p) => p.name === "dataverse_entity_name");
    const entityDefault = asString(entityParam?.defaultValue);
    if (entityDefault && !entityDefault.startsWith("@")) {
      const parseResult = extractDestQueryAliases(destQueryDefault);
      warnings.push(...parseResult.warnings);

      for (const alias of parseResult.aliases) {
        if (!STATUS_ALIASES.has(alias.alias.toLowerCase())) continue;
        if (!alias.isCaseExpression) continue;

        const caseValues = extractCaseValues(alias.expression);
        const elseValue = extractCaseElseValue(alias.expression);
        const mappedValues = caseValues.map((v) => v.thenValue);
        if (elseValue !== undefined) mappedValues.push(elseValue);

        let validOptionSetValues: OptionSetValue[] = [];
        let optionSetAvailable = false;

        if (schemaPath) {
          const entityNodeId = `${NodeType.DataverseEntity}:${entityDefault}`;
          const entityNode = graph.getNode(entityNodeId);
          if (entityNode?.metadata.schemaFile) {
            const detail = loadEntityDetail(schemaPath, entityNode.metadata.schemaFile as string);
            if (detail) {
              const attr = detail.attributes.find(
                (a) => a.logicalName === alias.alias.toLowerCase()
              );
              if (attr?.optionSet) {
                optionSetAvailable = true;
                validOptionSetValues = attr.optionSet;
              }
            }
          }
        }

        const validSet = new Set(validOptionSetValues.map((v) => v.value));
        const invalidValues = optionSetAvailable
          ? mappedValues.filter((v) => !validSet.has(v))
          : [];

        validations.push({
          activityId: lookup.id,
          activityName: `${pipeline} (parameter default)`,
          entityName: entityDefault,
          alias: alias.alias,
          mappedValues,
          validValues: validOptionSetValues,
          invalidValues,
          optionSetAvailable,
        });
      }
    }
  }

  const activitiesWithIssues = validations.filter((v) => v.invalidValues.length > 0).length;
  const totalInvalidValues = validations.reduce((sum, v) => sum + v.invalidValues.length, 0);

  return {
    pipeline,
    validations,
    summary: {
      totalActivities: validations.length,
      activitiesWithIssues,
      totalInvalidValues,
    },
    warnings,
  };
}
