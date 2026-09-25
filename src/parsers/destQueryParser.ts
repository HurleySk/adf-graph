import {
  stripSqlComments,
  scanSql,
  isKeywordAt,
  findTopLevelKeyword,
  splitTopLevelCommas,
  splitTrailingAlias,
} from "./sqlLex.js";

export interface DestQueryAlias {
  expression: string;
  alias: string;
  isCaseExpression: boolean;
}

export interface DestQueryParseResult {
  aliases: DestQueryAlias[];
  warnings: string[];
}

export interface CaseValue {
  thenValue: number;
  whenCondition?: string;
}

/**
 * Index of the statement's outermost SELECT keyword.
 *
 * The first SELECT in the text is not necessarily the one that shapes the
 * result set: a `WITH cte AS (SELECT ...) SELECT ...` query hides its real
 * projection behind one or more CTE bodies. CTE bodies (and subqueries) are
 * always parenthesised, so the outermost SELECT is the first one at paren
 * depth 0. Falls back to the first SELECT at any depth when the whole
 * statement is wrapped in parentheses.
 */
function findOuterSelectIndex(sql: string): number {
  let firstAnyDepth = -1;
  const topLevel = scanSql(sql, (i, depth) => {
    if (!isKeywordAt(sql, i, "SELECT")) return;
    if (depth === 0) return true;
    if (firstAnyDepth === -1) firstAnyDepth = i;
  });
  return topLevel !== -1 ? topLevel : firstAnyDepth;
}

export function extractSelectClause(sql: string): string | null {
  const selectIdx = findOuterSelectIndex(sql);
  if (selectIdx === -1) return null;

  let start = selectIdx + 6;
  const topMatch = sql.substring(start).match(/^\s+TOP\s+\d+\s+/i);
  if (topMatch) start += topMatch[0].length;

  const fromIdx = findTopLevelKeyword(sql, "FROM", start);
  return (fromIdx === -1 ? sql.substring(start) : sql.substring(start, fromIdx)).trim();
}

export function extractDestQueryAliases(sql: string): DestQueryParseResult {
  const aliases: DestQueryAlias[] = [];
  const warnings: string[] = [];

  const cleaned = stripSqlComments(sql);
  const selectClause = extractSelectClause(cleaned);
  if (!selectClause) {
    warnings.push("Could not find SELECT clause in dest_query");
    return { aliases, warnings };
  }

  const parts = splitTopLevelCommas(selectClause);

  for (const part of parts) {
    const result = splitTrailingAlias(part);
    if (!result) {
      warnings.push(`Could not extract alias from expression: ${part.substring(0, 80)}`);
      continue;
    }

    const isCaseExpression = /\bCASE\b/i.test(result.expression);
    aliases.push({
      expression: result.expression,
      alias: result.alias,
      isCaseExpression,
    });
  }

  return { aliases, warnings };
}

export function extractCaseValues(expression: string): CaseValue[] {
  const values: CaseValue[] = [];
  const regex = /WHEN\s+(.*?)\s+THEN\s+(-?\d+)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(expression)) !== null) {
    values.push({
      thenValue: parseInt(match[2], 10),
      whenCondition: match[1].trim(),
    });
  }

  return values;
}

export function extractCaseElseValue(expression: string): number | undefined {
  const match = expression.match(/ELSE\s+(-?\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}
