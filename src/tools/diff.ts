import { Graph } from "../graph/model.js";
import { handleDescribePipeline, ActivityInfo, ParameterDef } from "./describe.js";
import { computeLineDiff } from "../utils/lineDiff.js";

export interface FieldChange {
  field: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  lineDiff?: string[];
}

export interface ActivityDiff {
  activity: string;
  status: "added" | "removed" | "modified" | "unchanged";
  details?: FieldChange[];
}

export interface PipelineDiffResult {
  pipeline: string;
  envA: string;
  envB: string;
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  parameterChanges?: {
    added: string[];
    removed: string[];
    modified: Array<{ name: string; before: ParameterDef; after: ParameterDef }>;
  };
  activityDiffs: ActivityDiff[];
  error?: string;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].map((v) => JSON.stringify(v)).sort();
  const sortedB = [...b].map((v) => JSON.stringify(v)).sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function textDiff(field: string, a: string | undefined, b: string | undefined): FieldChange | null {
  if (a === b) return null;
  const change: FieldChange = {
    field,
    summary: `${field} changed`,
    before: a ?? null,
    after: b ?? null,
  };
  if (a && b) {
    change.lineDiff = computeLineDiff(a, b);
  }
  return change;
}

function diffActivity(a: ActivityInfo, b: ActivityInfo): FieldChange[] {
  const changes: FieldChange[] = [];

  if (a.activityType !== b.activityType) {
    changes.push({
      field: "activityType",
      summary: `activityType: '${a.activityType}' → '${b.activityType}'`,
      before: a.activityType,
      after: b.activityType,
    });
  }

  if (!arraysEqual(a.dependsOn, b.dependsOn)) {
    changes.push({
      field: "dependsOn",
      summary: "dependsOn changed",
      before: a.dependsOn,
      after: b.dependsOn,
    });
  }

  const srcA = a.sources ?? [];
  const srcB = b.sources ?? [];
  if (!arraysEqual(srcA, srcB)) {
    changes.push({
      field: "sources",
      summary: "sources changed",
      before: srcA,
      after: srcB,
    });
  }

  const snkA = a.sinks ?? [];
  const snkB = b.sinks ?? [];
  if (!arraysEqual(snkA, snkB)) {
    changes.push({
      field: "sinks",
      summary: "sinks changed",
      before: snkA,
      after: snkB,
    });
  }

  const sqlDiff = textDiff("sqlQuery", a.sqlQuery, b.sqlQuery);
  if (sqlDiff) changes.push(sqlDiff);

  const fxmlDiff = textDiff("fetchXmlQuery", a.fetchXmlQuery, b.fetchXmlQuery);
  if (fxmlDiff) changes.push(fxmlDiff);

  if (a.storedProcedureName !== b.storedProcedureName) {
    changes.push({
      field: "storedProcedureName",
      summary: `storedProcedureName: '${a.storedProcedureName}' → '${b.storedProcedureName}'`,
      before: a.storedProcedureName,
      after: b.storedProcedureName,
    });
  }

  if (JSON.stringify(a.storedProcedureParameters) !== JSON.stringify(b.storedProcedureParameters)) {
    changes.push({
      field: "storedProcedureParameters",
      summary: "storedProcedureParameters changed",
      before: a.storedProcedureParameters,
      after: b.storedProcedureParameters,
    });
  }

  if (JSON.stringify(a.pipelineParameters) !== JSON.stringify(b.pipelineParameters)) {
    changes.push({
      field: "pipelineParameters",
      summary: "pipelineParameters changed",
      before: a.pipelineParameters,
      after: b.pipelineParameters,
    });
  }

  const colsA = a.columnMappings ?? [];
  const colsB = b.columnMappings ?? [];
  if (!arraysEqual(colsA, colsB)) {
    changes.push({
      field: "columnMappings",
      summary: `columnMappings changed (${colsA.length} → ${colsB.length})`,
      before: colsA,
      after: colsB,
    });
  }

  return changes;
}

export function handleDiffPipeline(
  graphA: Graph,
  graphB: Graph,
  pipeline: string,
  envA: string,
  envB: string,
): PipelineDiffResult {
  const resultA = handleDescribePipeline(graphA, pipeline, "full");
  const resultB = handleDescribePipeline(graphB, pipeline, "full");

  if (resultA.error && resultB.error) {
    return {
      pipeline, envA, envB,
      summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      activityDiffs: [],
      error: `Pipeline '${pipeline}' not found in either environment`,
    };
  }

  if (resultA.error) {
    return {
      pipeline, envA, envB,
      summary: { added: (resultB.activities ?? []).length, removed: 0, modified: 0, unchanged: 0 },
      activityDiffs: (resultB.activities ?? []).map((a) => ({ activity: a.name, status: "added" as const })),
      error: `Pipeline '${pipeline}' only exists in ${envB}`,
    };
  }

  if (resultB.error) {
    return {
      pipeline, envA, envB,
      summary: { added: 0, removed: (resultA.activities ?? []).length, modified: 0, unchanged: 0 },
      activityDiffs: (resultA.activities ?? []).map((a) => ({ activity: a.name, status: "removed" as const })),
      error: `Pipeline '${pipeline}' only exists in ${envA}`,
    };
  }

  // Parameter diff — now with definition comparison
  const paramsA = resultA.summary.parameters;
  const paramsB = resultB.summary.parameters;
  const paramNamesA = new Set(paramsA.map((p) => p.name));
  const paramNamesB = new Set(paramsB.map((p) => p.name));
  const addedParams = [...paramNamesB].filter((n) => !paramNamesA.has(n));
  const removedParams = [...paramNamesA].filter((n) => !paramNamesB.has(n));
  const modifiedParams: Array<{ name: string; before: ParameterDef; after: ParameterDef }> = [];

  for (const pA of paramsA) {
    const pB = paramsB.find((p) => p.name === pA.name);
    if (pB && (pA.type !== pB.type || JSON.stringify(pA.defaultValue) !== JSON.stringify(pB.defaultValue))) {
      modifiedParams.push({ name: pA.name, before: pA, after: pB });
    }
  }

  const parameterChanges =
    addedParams.length > 0 || removedParams.length > 0 || modifiedParams.length > 0
      ? { added: addedParams, removed: removedParams, modified: modifiedParams }
      : undefined;

  // Activity diff
  const activitiesA = new Map((resultA.activities ?? []).map((a) => [a.name, a]));
  const activitiesB = new Map((resultB.activities ?? []).map((a) => [a.name, a]));

  const activityDiffs: ActivityDiff[] = [];
  let added = 0, removed = 0, modified = 0, unchanged = 0;

  for (const [name, actA] of activitiesA) {
    const actB = activitiesB.get(name);
    if (!actB) {
      activityDiffs.push({ activity: name, status: "removed" });
      removed++;
    } else {
      const details = diffActivity(actA, actB);
      if (details.length > 0) {
        activityDiffs.push({ activity: name, status: "modified", details });
        modified++;
      } else {
        activityDiffs.push({ activity: name, status: "unchanged" });
        unchanged++;
      }
    }
  }

  for (const name of activitiesB.keys()) {
    if (!activitiesA.has(name)) {
      activityDiffs.push({ activity: name, status: "added" });
      added++;
    }
  }

  return {
    pipeline, envA, envB,
    summary: { added, removed, modified, unchanged },
    parameterChanges,
    activityDiffs,
  };
}
