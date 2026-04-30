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

export function stripSqlComments(sql: string): string {
  const lines = sql.split("\n");
  return lines
    .map((line) => {
      let inString = false;
      let stringChar = "";
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
          if (ch === stringChar) inString = false;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inString = true;
          stringChar = ch;
          continue;
        }
        if (ch === "-" && i + 1 < line.length && line[i + 1] === "-") {
          return line.substring(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

export function extractSelectClause(sql: string): string | null {
  const upper = sql.toUpperCase();
  const selectIdx = upper.indexOf("SELECT");
  if (selectIdx === -1) return null;

  let start = selectIdx + 6;
  const topMatch = upper.substring(start).match(/^\s+TOP\s+\d+\s+/i);
  if (topMatch) start += topMatch[0].length;

  // Find the top-level FROM (not inside subqueries)
  let depth = 0;
  let caseDepth = 0;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth > 0) continue;

    const remaining = upper.substring(i);
    if (remaining.startsWith("CASE")) {
      const after = sql[i + 4];
      if (!after || /\s/.test(after)) caseDepth++;
      continue;
    }
    if (remaining.startsWith("END")) {
      const after = sql[i + 3];
      if (!after || /\s/.test(after)) {
        if (caseDepth > 0) caseDepth--;
      }
      continue;
    }
    if (caseDepth > 0) continue;

    if (remaining.startsWith("FROM")) {
      const after = sql[i + 4];
      if (!after || /\s/.test(after)) {
        return sql.substring(start, i).trim();
      }
    }
  }

  return sql.substring(start).trim();
}

export function splitTopLevelCommas(clause: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let caseDepth = 0;
  let current = "";
  const upper = clause.toUpperCase();

  for (let i = 0; i < clause.length; i++) {
    const ch = clause[i];

    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth--; current += ch; continue; }

    if (depth === 0) {
      const remaining = upper.substring(i);
      if (remaining.startsWith("CASE")) {
        const after = clause[i + 4];
        if (!after || /\s/.test(after)) caseDepth++;
      }
      if (remaining.startsWith("END")) {
        const after = clause[i + 3];
        if (!after || /\s/.test(after) || after === ",") {
          if (caseDepth > 0) caseDepth--;
        }
      }
    }

    if (ch === "," && depth === 0 && caseDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function extractAlias(expr: string): { expression: string; alias: string } | null {
  const trimmed = expr.trim();
  const upper = trimmed.toUpperCase();

  // Walk backwards through the expression to find the last top-level AS keyword
  let depth = 0;
  let caseDepth = 0;
  let lastAsPos = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }

    const remaining = upper.substring(i);
    if (depth === 0) {
      if (remaining.startsWith("CASE")) {
        const after = trimmed[i + 4];
        if (!after || /\s/.test(after)) caseDepth++;
      }
      if (remaining.startsWith("END")) {
        const after = trimmed[i + 3];
        if (!after || /\s/.test(after)) {
          if (caseDepth > 0) caseDepth--;
        }
      }
    }

    if (depth === 0 && caseDepth === 0 && remaining.match(/^AS\s/i)) {
      // Verify it's a word boundary before AS
      if (i === 0 || /\s/.test(trimmed[i - 1])) {
        lastAsPos = i;
      }
    }
  }

  if (lastAsPos === -1) return null;

  const beforeAs = trimmed.substring(0, lastAsPos).trim();
  const afterAs = trimmed.substring(lastAsPos + 2).trim();

  let alias = afterAs;
  if (alias.startsWith("[") && alias.endsWith("]")) {
    alias = alias.substring(1, alias.length - 1);
  } else if (alias.startsWith('"') && alias.endsWith('"')) {
    alias = alias.substring(1, alias.length - 1);
  }

  if (!alias) return null;

  return { expression: beforeAs, alias };
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
    const result = extractAlias(part);
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
