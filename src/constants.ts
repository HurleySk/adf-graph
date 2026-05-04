export const ADF_DIRS = {
  PIPELINE: "pipeline",
  DATASET: "dataset",
  LINKED_SERVICE: "linkedService",
  SQL: "SQL DB",
  TRIGGER: "trigger",
  INTEGRATION_RUNTIME: "integrationRuntime",
} as const;

export const OVERLAY_SUFFIX = "+overlays";

export const WATCHED_DIRS = [
  ADF_DIRS.PIPELINE,
  ADF_DIRS.DATASET,
  ADF_DIRS.LINKED_SERVICE,
  ADF_DIRS.SQL,
  ADF_DIRS.TRIGGER,
  ADF_DIRS.INTEGRATION_RUNTIME,
] as const;
