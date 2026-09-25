import { extractSelectClause } from "./destQueryParser.js";
import { stripSqlComments, splitTopLevelCommas, splitTrailingAlias } from "./sqlLex.js";

export interface SourceQueryColumn {
  effectiveName: string;
  expression: string;
  hasExplicitAlias: boolean;
}

export interface SourceQueryParseResult {
  columns: SourceQueryColumn[];
  warnings: string[];
}

function extractBareColumnName(expr: string): string | null {
  const trimmed = expr.trim();
  // table.column or alias.column pattern
  const dotParts = trimmed.split(".");
  const last = dotParts[dotParts.length - 1].replace(/^\[|\]$/g, "").trim();
  if (/^\w+$/.test(last)) return last;
  return null;
}

export function extractSourceQueryColumns(sql: string): SourceQueryParseResult {
  const columns: SourceQueryColumn[] = [];
  const warnings: string[] = [];

  const cleaned = stripSqlComments(sql);
  const selectClause = extractSelectClause(cleaned);
  if (!selectClause) {
    warnings.push("Could not find SELECT clause in source_query");
    return { columns, warnings };
  }

  if (selectClause.trim() === "*") {
    warnings.push("SELECT * — cannot validate individual columns");
    return { columns, warnings };
  }

  const parts = splitTopLevelCommas(selectClause);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed === "*") {
      warnings.push("SELECT * — cannot validate individual columns");
      continue;
    }

    const aliasResult = splitTrailingAlias(trimmed);
    if (aliasResult) {
      columns.push({
        effectiveName: aliasResult.alias,
        expression: trimmed,
        hasExplicitAlias: true,
      });
      continue;
    }

    const colName = extractBareColumnName(trimmed);
    if (colName) {
      columns.push({
        effectiveName: colName,
        expression: trimmed,
        hasExplicitAlias: false,
      });
      continue;
    }

    warnings.push(`Could not determine effective column name: ${trimmed.substring(0, 80)}`);
  }

  return { columns, warnings };
}
