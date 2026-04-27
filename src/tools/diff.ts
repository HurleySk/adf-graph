import { Graph } from "../graph/model.js";
import { handleDescribePipeline, ActivityInfo } from "./describe.js";

export interface ActivityDiff {
  activity: string;
  status: "added" | "removed" | "modified" | "unchanged";
  changes?: string[];
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
  parameterChanges?: { added: string[]; removed: string[] };
  activityDiffs: ActivityDiff[];
  error?: string;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].map((v) => JSON.stringify(v)).sort();
  const sortedB = [...b].map((v) => JSON.stringify(v)).sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function diffActivity(a: ActivityInfo, b: ActivityInfo): string[] {
  const changes: string[] = [];

  if (a.activityType !== b.activityType) {
    changes.push(`activityType: '${a.activityType}' → '${b.activityType}'`);
  }

  if (!arraysEqual(a.dependsOn, b.dependsOn)) {
    changes.push(`dependsOn changed`);
  }

  const srcA = a.sources ?? [];
  const srcB = b.sources ?? [];
  if (!arraysEqual(srcA, srcB)) {
    changes.push(`sources changed`);
  }

  const snkA = a.sinks ?? [];
  const snkB = b.sinks ?? [];
  if (!arraysEqual(snkA, snkB)) {
    changes.push(`sinks changed`);
  }

  if (a.sqlQuery !== b.sqlQuery) {
    changes.push(`sqlQuery changed`);
  }

  if (a.fetchXmlQuery !== b.fetchXmlQuery) {
    changes.push(`fetchXmlQuery changed`);
  }

  if (a.storedProcedureName !== b.storedProcedureName) {
    changes.push(`storedProcedureName changed`);
  }

  if (JSON.stringify(a.storedProcedureParameters) !== JSON.stringify(b.storedProcedureParameters)) {
    changes.push(`storedProcedureParameters changed`);
  }

  if (JSON.stringify(a.pipelineParameters) !== JSON.stringify(b.pipelineParameters)) {
    changes.push(`pipelineParameters changed`);
  }

  const colsA = a.columnMappings ?? [];
  const colsB = b.columnMappings ?? [];
  if (!arraysEqual(colsA, colsB)) {
    changes.push(`columnMappings changed (${colsA.length} → ${colsB.length})`);
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

  // Parameter diff
  const paramsA = new Set(resultA.summary.parameters.map((p) => p.name));
  const paramsB = new Set(resultB.summary.parameters.map((p) => p.name));
  const addedParams = [...paramsB].filter((p) => !paramsA.has(p));
  const removedParams = [...paramsA].filter((p) => !paramsB.has(p));
  const parameterChanges = (addedParams.length > 0 || removedParams.length > 0)
    ? { added: addedParams, removed: removedParams }
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
      const changes = diffActivity(actA, actB);
      if (changes.length > 0) {
        activityDiffs.push({ activity: name, status: "modified", changes });
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
