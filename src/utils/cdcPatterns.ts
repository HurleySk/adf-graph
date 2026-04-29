import { asNonDynamic, asString } from "./expressionValue.js";

export interface CdcPipelineInfo {
  isCdc: boolean;
  cdcCurrentTable: string | null;
  cdcHistoricalTable: string | null;
  cdcPendingTable: string | null;
  cdcSourceTableName: string | null;
  cdcSourceTableQuery: string | null;
  storedProcedure: string | null;
  sourceObjectName: string | null;
  destObjectName: string | null;
  dataverseEntity: string | null;
  sourceQuery: string | null;
  destQuery: string | null;
  preCopyScript: string | null;
}

const CDC_PARAM_NAMES = [
  "cdc_current_table",
  "cdc_historical_table",
  "cdc_source_table_name",
  "cdc_pending_table_name",
] as const;

export function isCdcPipeline(params: Record<string, unknown>): boolean {
  let count = 0;
  for (const name of CDC_PARAM_NAMES) {
    if (params[name] !== undefined && params[name] !== "") count++;
  }
  return count >= 2;
}

export function detectCdcPattern(params: Record<string, unknown>): CdcPipelineInfo {
  const isCdc = isCdcPipeline(params);
  const get = (key: string): string | null => asNonDynamic(params[key]) ?? asString(params[key]) ?? null;

  return {
    isCdc,
    cdcCurrentTable: get("cdc_current_table"),
    cdcHistoricalTable: get("cdc_historical_table"),
    cdcPendingTable: get("cdc_pending_table_name"),
    cdcSourceTableName: get("cdc_source_table_name"),
    cdcSourceTableQuery: get("cdc_source_table_query"),
    storedProcedure: get("stored_procedure"),
    sourceObjectName: get("source_object_name"),
    destObjectName: get("dest_object_name"),
    dataverseEntity: get("dataverse_entity_name"),
    sourceQuery: get("source_query"),
    destQuery: get("dest_query"),
    preCopyScript: get("pre_copy_script"),
  };
}

export type StagingRole =
  | "cdc_current"
  | "cdc_historical"
  | "cdc_pending"
  | "staging"
  | "source"
  | "unknown";

export function classifyStagingRole(
  tableName: string,
  cdc: CdcPipelineInfo,
): StagingRole {
  const lower = tableName.toLowerCase();

  if (cdc.cdcCurrentTable && lower === cdc.cdcCurrentTable.toLowerCase()) return "cdc_current";
  if (cdc.cdcHistoricalTable && lower === cdc.cdcHistoricalTable.toLowerCase()) return "cdc_historical";
  if (cdc.cdcPendingTable && lower === cdc.cdcPendingTable.toLowerCase()) return "cdc_pending";
  if (cdc.destObjectName && lower === cdc.destObjectName.toLowerCase()) return "staging";
  if (cdc.sourceObjectName && lower === cdc.sourceObjectName.toLowerCase()) return "source";

  // Naming convention fallback
  if (/\bcdc_.*_current\b/i.test(tableName)) return "cdc_current";
  if (/\bcdc_.*_historical\b/i.test(tableName)) return "cdc_historical";
  if (/\bcdc_.*_pending\b/i.test(tableName)) return "cdc_pending";
  if (/_staging\b/i.test(tableName)) return "staging";

  return "unknown";
}
