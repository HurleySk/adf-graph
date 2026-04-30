import { stripSqlComments, extractSelectClause, splitTopLevelCommas } from "./destQueryParser.js";

export interface SourceQueryColumn {
  effectiveName: string;
  expression: string;
  hasExplicitAlias: boolean;
}

export interface SourceQueryParseResult {
  columns: SourceQueryColumn[];
  warnings: string[];
}

function extractTopLevelAlias(expr: string): { before: string; alias: string } | null {
  const trimmed = expr.trim();
  const upper = trimmed.toUpperCase();

  let depth = 0;
  let caseDepth = 0;
  let lastAsPos = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }

    const remaining = upper.substring(i);
    if (depth === 0) {
      if (remaining.startsWith("CASE") && (!trimmed[i + 4] || /\s/.test(trimmed[i + 4]))) caseDepth++;
      if (remaining.startsWith("END") && (!trimmed[i + 3] || /\s/.test(trimmed[i + 3]))) {
        if (caseDepth > 0) caseDepth--;
      }
    }

    if (depth === 0 && caseDepth === 0 && remaining.match(/^AS\s/i)) {
      if (i === 0 || /\s/.test(trimmed[i - 1])) {
        lastAsPos = i;
      }
    }
  }

  if (lastAsPos === -1) return null;

  const before = trimmed.substring(0, lastAsPos).trim();
  let alias = trimmed.substring(lastAsPos + 2).trim();

  if (alias.startsWith("[") && alias.endsWith("]")) {
    alias = alias.substring(1, alias.length - 1);
  } else if (alias.startsWith('"') && alias.endsWith('"')) {
    alias = alias.substring(1, alias.length - 1);
  }

  return alias ? { before, alias } : null;
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

    const aliasResult = extractTopLevelAlias(trimmed);
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
