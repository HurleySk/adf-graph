import { Graph } from "../graph/model.js";
import { lookupPipelineNode, iterDestQueryTargets, getEntityDetail } from "./toolUtils.js";
import { type OptionSetValue } from "../parsers/dataverseSchema.js";
import {
  extractDestQueryAliases,
  extractCaseValues,
  extractCaseElseValue,
  type DestQueryAlias,
} from "../parsers/destQueryParser.js";

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

function validateStatusAliases(
  graph: Graph,
  aliases: DestQueryAlias[],
  entityName: string,
  activityId: string,
  activityName: string,
  schemaPath?: string,
): StatusCodeValidation[] {
  const validations: StatusCodeValidation[] = [];

  for (const alias of aliases) {
    if (!STATUS_ALIASES.has(alias.alias.toLowerCase())) continue;
    if (!alias.isCaseExpression) continue;

    const caseValues = extractCaseValues(alias.expression);
    const elseValue = extractCaseElseValue(alias.expression);
    const mappedValues = caseValues.map((v) => v.thenValue);
    if (elseValue !== undefined) mappedValues.push(elseValue);

    let validOptionSetValues: OptionSetValue[] = [];
    let optionSetAvailable = false;

    const attr = getEntityDetail(graph, entityName, schemaPath)?.attributes.find(
      (a) => a.logicalName === alias.alias.toLowerCase()
    );
    if (attr?.optionSet) {
      optionSetAvailable = true;
      validOptionSetValues = attr.optionSet;
    }

    const validSet = new Set(validOptionSetValues.map((v) => v.value));
    const invalidValues = optionSetAvailable
      ? mappedValues.filter((v) => !validSet.has(v))
      : [];

    validations.push({
      activityId,
      activityName,
      entityName,
      alias: alias.alias,
      mappedValues,
      validValues: validOptionSetValues,
      invalidValues,
      optionSetAvailable,
    });
  }

  return validations;
}

export function handleValidateStatuscode(
  graph: Graph,
  pipeline: string,
  schemaPath?: string,
): ValidateStatusCodeResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
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

  for (const target of iterDestQueryTargets(graph, lookup.node)) {
    if (!target.entityName) {
      warnings.push(`Activity '${target.name}': could not resolve target entity`);
      continue;
    }

    const parseResult = extractDestQueryAliases(target.destQuery);
    warnings.push(...parseResult.warnings);

    validations.push(
      ...validateStatusAliases(graph, parseResult.aliases, target.entityName, target.id, target.name, schemaPath)
    );
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
