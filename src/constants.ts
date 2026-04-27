export const ADF_DIRS = {
  PIPELINE: "pipeline",
  DATASET: "dataset",
  LINKED_SERVICE: "linkedService",
  SQL: "SQL DB",
} as const;

export const OVERLAY_SUFFIX = "+overlays";

export const WATCHED_DIRS = [
  ADF_DIRS.PIPELINE,
  ADF_DIRS.DATASET,
  ADF_DIRS.LINKED_SERVICE,
  ADF_DIRS.SQL,
] as const;
