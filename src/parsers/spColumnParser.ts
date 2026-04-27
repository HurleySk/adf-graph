/**
 * Parse stored procedure SQL bodies to extract column-level mappings.
 *
 * Regex-based extraction — NOT a full T-SQL parser. Handles:
 *   1. UPDATE <table> SET <col> = <expr>, …
 *   2. INSERT INTO <table> (<cols>) SELECT <cols> FROM <table>
 *   3. MERGE <target> USING <source> ON … WHEN MATCHED THEN UPDATE SET …
 *      WHEN NOT MATCHED THEN INSERT (<cols>) VALUES (<vals>)
 *
 * Dynamic SQL / EXEC statements reduce confidence and add warnings.
 */

export interface SpColumnMapping {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  transformExpression?: string;
}

export interface SpParseResult {
  storedProcedure: string;
  mappings: SpColumnMapping[];
  readTables: string[];
  writeTables: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}

/* ──────────────────────────── helpers ──────────────────────────── */

/** Strip square brackets and optional schema prefix whitespace. */
function normalizeName(raw: string): string {
  return raw.replace(/\[|\]/g, "").trim();
}

/** Normalize a potentially schema-qualified table name. */
function normalizeTable(raw: string): string {
  return raw
    .split(".")
    .map((part) => normalizeName(part))
    .join(".");
}

/**
 * Extract the innermost column reference from an expression.
 * For `UPPER(LTRIM(RTRIM(col)))` → `col`.
 * For `a.col` → `col`.
 * For plain `col` → `col`.
 */
function extractInnermostColumn(expr: string): string {
  let s = expr.trim();

  // Peel off nested function calls: UPPER(LTRIM(RTRIM(x)))
  // Repeatedly match IDENT( ... ) wrapper
  const funcPattern = /^\w+\(\s*(.*)\s*\)$/s;
  let peeled = true;
  while (peeled) {
    const m = funcPattern.exec(s);
    if (m) {
      s = m[1].trim();
      // Remove trailing closing parens that may have been part of outer layers
    } else {
      peeled = false;
    }
  }

  // Handle alias.column → column
  const dotParts = s.split(".");
  const last = dotParts[dotParts.length - 1];
  return normalizeName(last);
}

/**
 * Check if an expression is just a simple column reference (possibly alias-qualified).
 * Returns true for `col`, `t.col`, `[col]`, `s.[col]`, etc.
 */
function isSimpleColumnRef(expr: string): boolean {
  return /^(?:\[?\w+\]?\.)*\[?\w+\]?$/.test(expr.trim());
}

/**
 * Split a comma-separated column list while respecting parenthesized expressions.
 * E.g. `a, UPPER(LTRIM(b)), c` → [`a`, `UPPER(LTRIM(b))`, `c`]
 */
function splitColumnList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/** Strip inline/block comments and string literals to simplify regex matching. */
function stripCommentsAndStrings(sql: string): string {
  // Remove block comments
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove single-line comments
  result = result.replace(/--[^\r\n]*/g, " ");
  // Replace string literals with empty string placeholders
  result = result.replace(/'[^']*'/g, "''");
  return result;
}

/**
 * Pattern fragment for a SQL identifier: either [bracket quoted] or plain \w+.
 * Bracket-quoted identifiers may contain spaces.
 */
const IDENT = String.raw`(?:\[[^\]]+\]|\w+)`;
/** Schema-qualified identifier: [schema].[name] or schema.name */
const QUALIFIED_IDENT = `(?:${IDENT}\\.)*${IDENT}`;

/* ──────────────────────────── statement parsers ──────────────────────────── */

/**
 * Parse UPDATE <table> SET <col> = <expr>, … [FROM <tables>]
 */
function parseUpdateStatements(sql: string): {
  mappings: SpColumnMapping[];
  readTables: string[];
  writeTables: string[];
  parsed: number;
} {
  const mappings: SpColumnMapping[] = [];
  const readTables: string[] = [];
  const writeTables: string[] = [];
  let parsed = 0;

  // Match UPDATE [schema].[table] SET ...
  const updateRegex = new RegExp(
    `\\bUPDATE\\s+(${QUALIFIED_IDENT})\\s+SET\\s+([\\s\\S]*?)(?=\\bWHERE\\b|\\bFROM\\b|\\bOUTPUT\\b|;|\\bEND\\b|$)`,
    "gi"
  );

  let match: RegExpExecArray | null;
  while ((match = updateRegex.exec(sql)) !== null) {
    const targetTable = normalizeTable(match[1]);
    const setClause = match[2];

    writeTables.push(targetTable);
    parsed++;

    // Extract FROM clause for source tables
    const afterSet = sql.slice(match.index + match[0].length);
    const fromMatch = /^\s*(?:WHERE[\s\S]*?)?\bFROM\s+([\s\S]*?)(?=\bWHERE\b|;|\bEND\b|$)/i.exec(afterSet);
    if (fromMatch) {
      const fromClause = fromMatch[1];
      const tableRefs =
        fromClause.match(/(?:\[?\w+\]?\.)*\[?\w+\]?/g) ?? [];
      for (const ref of tableRefs) {
        const t = normalizeTable(ref);
        if (t && !t.match(/^\d+$/) && t !== targetTable) {
          readTables.push(t);
        }
      }
    }

    // Parse SET assignments: col = expr, col = expr, …
    const assignments = splitColumnList(setClause);
    for (const assignment of assignments) {
      const eqIdx = assignment.indexOf("=");
      if (eqIdx === -1) continue;
      const targetColumn = normalizeName(assignment.slice(0, eqIdx).trim());
      const expr = assignment.slice(eqIdx + 1).trim();
      const sourceColumn = extractInnermostColumn(expr);

      // Skip literal values / non-column expressions
      if (/^\d+$/.test(sourceColumn) || sourceColumn === "") continue;

      mappings.push({
        sourceTable: targetTable, // self-update unless we can determine differently
        sourceColumn,
        targetTable,
        targetColumn,
        ...(!isSimpleColumnRef(expr) ? { transformExpression: expr } : {}),
      });
    }
  }

  return { mappings, readTables, writeTables, parsed };
}

/**
 * Parse INSERT INTO <table> (<cols>) SELECT <cols> FROM <table>
 */
function parseInsertSelectStatements(sql: string): {
  mappings: SpColumnMapping[];
  readTables: string[];
  writeTables: string[];
  parsed: number;
} {
  const mappings: SpColumnMapping[] = [];
  const readTables: string[] = [];
  const writeTables: string[] = [];
  let parsed = 0;

  const insertRegex = new RegExp(
    `\\bINSERT\\s+INTO\\s+(${QUALIFIED_IDENT})\\s*\\(\\s*([\\s\\S]*?)\\s*\\)\\s*SELECT\\s+([\\s\\S]*?)\\s+FROM\\s+(${QUALIFIED_IDENT})`,
    "gi"
  );

  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(sql)) !== null) {
    const targetTable = normalizeTable(match[1]);
    const insertCols = splitColumnList(match[2]);
    const selectExprs = splitColumnList(match[3]);
    const sourceTable = normalizeTable(match[4]);

    writeTables.push(targetTable);
    readTables.push(sourceTable);
    parsed++;

    // Positional mapping
    const count = Math.min(insertCols.length, selectExprs.length);
    for (let i = 0; i < count; i++) {
      const targetColumn = normalizeName(insertCols[i]);
      const expr = selectExprs[i].trim();
      const sourceColumn = extractInnermostColumn(expr);

      if (/^\d+$/.test(sourceColumn) || sourceColumn === "") continue;

      mappings.push({
        sourceTable,
        sourceColumn,
        targetTable,
        targetColumn,
        ...(!isSimpleColumnRef(expr) ? { transformExpression: expr.trim() } : {}),
      });
    }
  }

  return { mappings, readTables, writeTables, parsed };
}

/**
 * Parse MERGE <target> USING <source> ON …
 *   WHEN MATCHED THEN UPDATE SET …
 *   WHEN NOT MATCHED THEN INSERT (<cols>) VALUES (<vals>)
 */
function parseMergeStatements(sql: string): {
  mappings: SpColumnMapping[];
  readTables: string[];
  writeTables: string[];
  parsed: number;
} {
  const mappings: SpColumnMapping[] = [];
  const readTables: string[] = [];
  const writeTables: string[] = [];
  let parsed = 0;

  const mergeRegex = new RegExp(
    `\\bMERGE\\s+(${QUALIFIED_IDENT})\\s+(?:AS\\s+\\w+\\s+)?USING\\s+(${QUALIFIED_IDENT})\\s+(?:AS\\s+\\w+\\s+)?ON\\s+([\\s\\S]*?)(?=\\bWHEN\\b)`,
    "gi"
  );

  let match: RegExpExecArray | null;
  while ((match = mergeRegex.exec(sql)) !== null) {
    const targetTable = normalizeTable(match[1]);
    const sourceTable = normalizeTable(match[2]);

    writeTables.push(targetTable);
    readTables.push(sourceTable);
    parsed++;

    // Get the rest of the MERGE statement after the ON clause
    const restOfMerge = sql.slice(match.index + match[0].length);

    // Parse WHEN MATCHED THEN UPDATE SET assignments
    const whenMatchedRegex =
      /\bWHEN\s+MATCHED\s+THEN\s+UPDATE\s+SET\s+([\s\S]*?)(?=\bWHEN\b|;|\bEND\b|$)/gi;
    let whenMatch: RegExpExecArray | null;
    while ((whenMatch = whenMatchedRegex.exec(restOfMerge)) !== null) {
      const setClause = whenMatch[1];
      const assignments = splitColumnList(setClause);
      for (const assignment of assignments) {
        const eqIdx = assignment.indexOf("=");
        if (eqIdx === -1) continue;
        let targetColumn = normalizeName(assignment.slice(0, eqIdx).trim());
        const expr = assignment.slice(eqIdx + 1).trim();
        const sourceColumn = extractInnermostColumn(expr);

        // Strip alias prefix from target (e.g. t.col → col)
        const targetDotParts = targetColumn.split(".");
        targetColumn = targetDotParts[targetDotParts.length - 1];

        if (/^\d+$/.test(sourceColumn) || sourceColumn === "") continue;

        mappings.push({
          sourceTable,
          sourceColumn,
          targetTable,
          targetColumn,
          ...(!isSimpleColumnRef(expr) ? { transformExpression: expr } : {}),
        });
      }
    }

    // Parse WHEN NOT MATCHED THEN INSERT (cols) VALUES (vals)
    const whenNotMatchedRegex =
      /\bWHEN\s+NOT\s+MATCHED\s+(?:BY\s+TARGET\s+)?THEN\s+INSERT\s*\(\s*([\s\S]*?)\s*\)\s*VALUES\s*\(\s*([\s\S]*?)\s*\)/gi;
    let notMatch: RegExpExecArray | null;
    while ((notMatch = whenNotMatchedRegex.exec(restOfMerge)) !== null) {
      const insertCols = splitColumnList(notMatch[1]);
      const valueExprs = splitColumnList(notMatch[2]);
      const count = Math.min(insertCols.length, valueExprs.length);
      for (let i = 0; i < count; i++) {
        const targetColumn = normalizeName(insertCols[i]);
        const expr = valueExprs[i].trim();
        const sourceColumn = extractInnermostColumn(expr);

        if (/^\d+$/.test(sourceColumn) || sourceColumn === "") continue;

        mappings.push({
          sourceTable,
          sourceColumn,
          targetTable,
          targetColumn,
          ...(!isSimpleColumnRef(expr) ? { transformExpression: expr } : {}),
        });
      }
    }
  }

  return { mappings, readTables, writeTables, parsed };
}

/* ──────────────────────────── main entry point ──────────────────────────── */

export function parseSpBody(spName: string, sql: string): SpParseResult {
  const warnings: string[] = [];
  const allMappings: SpColumnMapping[] = [];
  const readTables = new Set<string>();
  const writeTables = new Set<string>();

  // Check for dynamic SQL
  const hasDynamicSql = /\bEXEC(?:UTE)?\s*\(/i.test(sql) || /\bsp_executesql\b/i.test(sql);
  if (hasDynamicSql) {
    warnings.push(`${spName}: contains dynamic SQL (EXEC/sp_executesql) — column mappings may be incomplete`);
  }

  // Strip comments/strings for cleaner regex matching
  const cleaned = stripCommentsAndStrings(sql);

  let totalStatements = 0;
  let parsedStatements = 0;

  // Count total DML statements (standalone UPDATE, INSERT INTO, MERGE).
  // Exclude "THEN UPDATE SET" inside MERGE statements — those are handled by the MERGE parser.
  const standaloneUpdateCount = (cleaned.match(/\bUPDATE\s+(?:\[?[^\]]*\]?\.)*\[?[^\]]*\]?\s+SET\b/gi) ?? []).length;
  const insertIntoCount = (cleaned.match(/\bINSERT\s+INTO\b/gi) ?? []).length;
  const mergeCount = (cleaned.match(/\bMERGE\b/gi) ?? []).length;
  totalStatements = standaloneUpdateCount + insertIntoCount + mergeCount;

  // Parse UPDATE statements
  const updateResult = parseUpdateStatements(cleaned);
  allMappings.push(...updateResult.mappings);
  updateResult.readTables.forEach((t) => readTables.add(t));
  updateResult.writeTables.forEach((t) => writeTables.add(t));
  parsedStatements += updateResult.parsed;

  // Parse INSERT…SELECT statements
  const insertResult = parseInsertSelectStatements(cleaned);
  allMappings.push(...insertResult.mappings);
  insertResult.readTables.forEach((t) => readTables.add(t));
  insertResult.writeTables.forEach((t) => writeTables.add(t));
  parsedStatements += insertResult.parsed;

  // Parse MERGE statements
  const mergeResult = parseMergeStatements(cleaned);
  allMappings.push(...mergeResult.mappings);
  mergeResult.readTables.forEach((t) => readTables.add(t));
  mergeResult.writeTables.forEach((t) => writeTables.add(t));
  parsedStatements += mergeResult.parsed;

  // Determine confidence
  let confidence: "high" | "medium" | "low";
  if (hasDynamicSql) {
    confidence = "low";
  } else if (totalStatements > 0 && parsedStatements === totalStatements) {
    confidence = "high";
  } else if (parsedStatements > 0) {
    confidence = "medium";
  } else if (totalStatements === 0) {
    // No DML statements found — nothing to parse, but that's fine
    confidence = "high";
  } else {
    confidence = "low";
  }

  return {
    storedProcedure: spName,
    mappings: allMappings,
    readTables: [...readTables],
    writeTables: [...writeTables],
    warnings,
    confidence,
  };
}
