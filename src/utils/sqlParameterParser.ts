import { extractSourceQueryColumns, type SourceQueryColumn } from "../parsers/sourceQueryParser.js";
import { extractAllTablesFromSql, type TableRef } from "../parsers/parseResult.js";
import { extractWhereClause, type WhereClause } from "../parsers/sqlWhereParser.js";

export interface ParsedSqlParameter {
  parameterName: string;
  sql: string;
  columns: SourceQueryColumn[];
  tables: TableRef[];
  whereClause: WhereClause | null;
  isCdcDependent: boolean;
  cdcDependencyTable?: string;
  warnings: string[];
}

const SQL_PARAMETER_NAMES = new Set(["source_query", "dest_query"]);

export function isSqlParameter(name: string): boolean {
  return SQL_PARAMETER_NAMES.has(name);
}

export function parseSqlParameter(parameterName: string, sql: string): ParsedSqlParameter {
  const columnResult = extractSourceQueryColumns(sql);
  const tables = extractAllTablesFromSql(sql);
  const whereClause = extractWhereClause(sql);

  let isCdcDependent = false;
  let cdcDependencyTable: string | undefined;

  if (whereClause) {
    for (const condition of whereClause.conditions) {
      if (condition.isSubquery && condition.subqueryTable && /CDC_.*_Current/i.test(condition.subqueryTable)) {
        isCdcDependent = true;
        cdcDependencyTable = condition.subqueryTable;
        break;
      }
    }
  }

  if (!isCdcDependent) {
    for (const t of tables) {
      if (t.depth > 0 && /CDC_.*_Current/i.test(t.table)) {
        isCdcDependent = true;
        cdcDependencyTable = t.table;
        break;
      }
    }
  }

  return {
    parameterName,
    sql,
    columns: columnResult.columns,
    tables,
    whereClause,
    isCdcDependent,
    cdcDependencyTable,
    warnings: columnResult.warnings,
  };
}
