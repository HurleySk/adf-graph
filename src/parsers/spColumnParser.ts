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

import { stripSqlComments, splitTopLevelCommas, parenDepthMap, scanTopLevel, isKeywordAt } from "./sqlLex.js";

/* ──────────────────────────── helpers ──────────────────────────── */

/** Strip square brackets and optional schema prefix whitespace. */
function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
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

function stripCommentsAndStrings(sql: string): string {
  return stripSqlComments(sql).replace(/'[^']*'/g, "''");
}

type StatementResult = {
  mappings: SpColumnMapping[];
  readTables: string[];
  writeTables: string[];
  parsed: number;
};

function pushMapping(
  mappings: SpColumnMapping[],
  sourceTable: string,
  targetTable: string,
  targetColumn: string,
  rawExpr: string,
): void {
  const expr = rawExpr.trim();
  const sourceColumn = extractInnermostColumn(expr);
  if (/^\d+$/.test(sourceColumn) || sourceColumn === "") return;
  mappings.push({
    sourceTable,
    sourceColumn,
    targetTable,
    targetColumn,
    ...(!isSimpleColumnRef(expr) ? { transformExpression: expr } : {}),
  });
}

function pushSetAssignments(
  mappings: SpColumnMapping[],
  setClause: string,
  sourceTable: string,
  targetTable: string,
): void {
  for (const assignment of splitTopLevelCommas(setClause)) {
    const eqIdx = assignment.indexOf("=");
    if (eqIdx === -1) continue;
    const targetColumn = normalizeName(assignment.slice(0, eqIdx).trim()).split(".").pop()!;
    pushMapping(mappings, sourceTable, targetTable, targetColumn, assignment.slice(eqIdx + 1));
  }
}

function pushPositional(
  mappings: SpColumnMapping[],
  colList: string,
  exprList: string,
  sourceTable: string,
  targetTable: string,
): void {
  const cols = splitTopLevelCommas(colList);
  const exprs = splitTopLevelCommas(exprList);
  const count = Math.min(cols.length, exprs.length);
  for (let i = 0; i < count; i++) {
    pushMapping(mappings, sourceTable, targetTable, normalizeName(cols[i]), exprs[i]);
  }
}

/**
 * Pattern fragment for a SQL identifier: either [bracket quoted] or plain \w+.
 * Bracket-quoted identifiers may contain spaces.
 */
const IDENT = String.raw`(?:\[[^\]]+\]|\w+)`;
/** Schema-qualified identifier: [schema].[name] or schema.name */
const QUALIFIED_IDENT = `(?:${IDENT}\\.)*${IDENT}`;

/* ──────────────────────────── statement parsers ──────────────────────────── */

const STATEMENT_KEYWORDS = [
  "UPDATE", "INSERT", "DELETE", "MERGE", "SELECT", "SET", "IF", "ELSE", "WHILE", "BEGIN", "END",
  "DECLARE", "EXEC", "EXECUTE", "RETURN", "TRUNCATE", "PRINT", "RAISERROR", "THROW", "COMMIT", "ROLLBACK",
];
const SET_CLAUSE_STOPS = ["WHERE", "FROM", "OUTPUT", "OPTION", ...STATEMENT_KEYWORDS];
const FROM_CLAUSE_STOPS = ["WHERE", "OUTPUT", "OPTION", ...STATEMENT_KEYWORDS];
const WHERE_CLAUSE_STOPS = ["OUTPUT", "OPTION", ...STATEMENT_KEYWORDS];
const SELECT_LIST_STOPS = ["FROM", "WHERE", "GROUP", "ORDER", "UNION", "OPTION", ...STATEMENT_KEYWORDS];
const MERGE_SET_STOPS = ["WHEN", "OUTPUT", "OPTION", ...STATEMENT_KEYWORDS];
const NON_ALIAS_WORDS = new Set([
  "ON", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "APPLY", "WITH",
  "GROUP", "ORDER", "UNION", "PIVOT", "UNPIVOT", "OPTION", "OUTPUT",
]);

function clauseEnd(sql: string, start: number, stops: string[]): number {
  const end = scanTopLevel(sql, (i) => {
    if (sql[i] === ";") return true;
    if (!/[A-Za-z]/.test(sql[i]) || /\w/.test(sql[i - 1] ?? "")) return false;
    return stops.some((k) => isKeywordAt(sql, i, k));
  }, start);
  return end === -1 ? sql.length : end;
}

type FromSource = { table: string; alias?: string; topLevel: boolean };

function parseFromSources(fromClause: string): FromSource[] {
  const sources: FromSource[] = [];
  const sourceRegex = new RegExp(
    `(^|\\b(?:FROM|JOIN|APPLY)\\s+|,\\s*)(${QUALIFIED_IDENT})(\\s*\\()?(?:\\s+(?:AS\\s+)?(${IDENT}))?`,
    "gi",
  );
  const depth = parenDepthMap(fromClause);
  let ref: RegExpExecArray | null;
  while ((ref = sourceRegex.exec(fromClause)) !== null) {
    const topLevel = depth[ref.index] === 0;
    const afterName = ref.index + ref[1].length + ref[2].length;
    let alias = ref[4] ? normalizeName(ref[4]) : undefined;
    if (alias && NON_ALIAS_WORDS.has(alias.toUpperCase())) alias = undefined;
    if ((ref[1].startsWith(",") && !topLevel) || ref[3]) {
      sourceRegex.lastIndex = afterName;
      continue;
    }
    if (!alias) sourceRegex.lastIndex = afterName;
    const table = normalizeTable(ref[2]);
    if (!table || /^\d+$/.test(table) || /^select$/i.test(table)) continue;
    sources.push({ table, alias, topLevel });
  }
  return sources;
}

function subqueryTables(text: string): string[] {
  const tables: string[] = [];
  const refRegex = new RegExp(`\\b(?:FROM|JOIN)\\s+(${QUALIFIED_IDENT})(?![\\w\\]]|\\s*\\()`, "gi");
  let ref: RegExpExecArray | null;
  while ((ref = refRegex.exec(text)) !== null) {
    const table = normalizeTable(ref[1]);
    if (table && !/^select$/i.test(table)) tables.push(table);
  }
  return tables;
}

/**
 * Parse UPDATE <table> SET <col> = <expr>, … [FROM <tables>]
 */
function parseUpdateStatements(sql: string): StatementResult {
  const mappings: SpColumnMapping[] = [];
  const readTables: string[] = [];
  const writeTables: string[] = [];
  let parsed = 0;

  const updateRegex = new RegExp(
    `\\bUPDATE\\s+(?:TOP\\s*\\([^()]*\\)\\s*(?:PERCENT\\s+)?)?(${QUALIFIED_IDENT})(?:\\s+WITH\\s*\\([^()]*\\))?\\s+SET\\s+`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = updateRegex.exec(sql)) !== null) {
    const setStart = match.index + match[0].length;
    const setEnd = clauseEnd(sql, setStart, SET_CLAUSE_STOPS);
    const setClause = sql.slice(setStart, setEnd);

    let sources: FromSource[] = [];
    let cursor = setEnd;
    if (isKeywordAt(sql, cursor, "FROM")) {
      const fromStart = cursor + 4;
      cursor = clauseEnd(sql, fromStart, FROM_CLAUSE_STOPS);
      sources = parseFromSources(sql.slice(fromStart, cursor).trim());
    }
    let whereClause = "";
    if (isKeywordAt(sql, cursor, "WHERE")) {
      whereClause = sql.slice(cursor + 5, clauseEnd(sql, cursor + 5, WHERE_CLAUSE_STOPS));
    }
    for (const table of subqueryTables(`${setClause} ${whereClause}`)) {
      if (!sources.some((src) => src.table === table)) sources.push({ table, topLevel: false });
    }

    let targetTable = normalizeTable(match[1]);
    if (!targetTable.includes(".")) {
      const aliased = sources.find((src) => src.topLevel && src.alias?.toLowerCase() === targetTable.toLowerCase());
      if (aliased) targetTable = aliased.table;
    }

    writeTables.push(targetTable);
    parsed++;
    for (const src of sources) {
      if (src.table !== targetTable) readTables.push(src.table);
    }

    pushSetAssignments(mappings, setClause, targetTable, targetTable);
  }

  return { mappings, readTables, writeTables, parsed };
}

/**
 * Parse INSERT INTO <table> (<cols>) SELECT <cols> FROM <table>
 */
function parseInsertSelectStatements(sql: string): StatementResult {
  const mappings: SpColumnMapping[] = [];
  const readTables: string[] = [];
  const writeTables: string[] = [];
  let parsed = 0;

  const insertRegex = new RegExp(
    `\\bINSERT\\s+INTO\\s+(${QUALIFIED_IDENT})\\s*\\(\\s*([^()]*?)\\s*\\)\\s*SELECT\\s+`,
    "gi"
  );
  const fromTableRegex = new RegExp(`FROM\\s+(${QUALIFIED_IDENT})(?![\\w.\\]])`, "iy");

  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(sql)) !== null) {
    const selectStart = match.index + match[0].length;
    const selectEnd = clauseEnd(sql, selectStart, SELECT_LIST_STOPS);
    const statementEnd = clauseEnd(sql, selectEnd, WHERE_CLAUSE_STOPS);
    readTables.push(...subqueryTables(sql.slice(selectStart, statementEnd)));
    fromTableRegex.lastIndex = selectEnd;
    const from = isKeywordAt(sql, selectEnd, "FROM") ? fromTableRegex.exec(sql) : null;
    if (!from) continue;

    const targetTable = normalizeTable(match[1]);
    const sourceTable = normalizeTable(from[1]);

    writeTables.push(targetTable);
    readTables.push(sourceTable);
    parsed++;

    pushPositional(mappings, match[2], sql.slice(selectStart, selectEnd), sourceTable, targetTable);
  }

  const targetRegex = new RegExp(
    `\\bINSERT\\s+INTO\\s+(?!OPEN(?:QUERY|ROWSET|DATASOURCE|XML)\\b)(${QUALIFIED_IDENT})(?![\\w.\\]])`,
    "gi",
  );
  for (const target of sql.matchAll(targetRegex)) {
    if (target[1].split(".").length <= 3) writeTables.push(normalizeTable(target[1]));
  }

  return { mappings, readTables, writeTables, parsed };
}

/**
 * Parse MERGE <target> USING <source> ON …
 *   WHEN MATCHED THEN UPDATE SET …
 *   WHEN NOT MATCHED THEN INSERT (<cols>) VALUES (<vals>)
 */
function parseMergeStatements(sql: string): StatementResult {
  const mappings: SpColumnMapping[] = [];
  const readTables: string[] = [];
  const writeTables: string[] = [];
  let parsed = 0;

  const mergeRegex = new RegExp(
    `\\bMERGE\\s+(${QUALIFIED_IDENT})\\s+(?:AS\\s+\\w+\\s+)?USING\\s+(${QUALIFIED_IDENT})\\s+(?:AS\\s+\\w+\\s+)?ON\\s+([^;]*?)(?=\\bWHEN\\b)`,
    "gi"
  );

  let match: RegExpExecArray | null;
  while ((match = mergeRegex.exec(sql)) !== null) {
    const targetTable = normalizeTable(match[1]);
    const sourceTable = normalizeTable(match[2]);

    writeTables.push(targetTable);
    readTables.push(sourceTable);
    parsed++;

    const bodyStart = match.index + match[0].length;
    const restOfMerge = sql.slice(bodyStart, clauseEnd(sql, bodyStart, ["MERGE"]));

    // Parse WHEN MATCHED THEN UPDATE SET assignments
    const whenMatchedRegex = /\bWHEN\s+MATCHED\s+THEN\s+UPDATE\s+SET\s+/gi;
    let whenMatch: RegExpExecArray | null;
    while ((whenMatch = whenMatchedRegex.exec(restOfMerge)) !== null) {
      const setStart = whenMatch.index + whenMatch[0].length;
      const setClause = restOfMerge.slice(setStart, clauseEnd(restOfMerge, setStart, MERGE_SET_STOPS));
      pushSetAssignments(mappings, setClause, sourceTable, targetTable);
    }

    // Parse WHEN NOT MATCHED THEN INSERT (cols) VALUES (vals)
    const whenNotMatchedRegex =
      /\bWHEN\s+NOT\s+MATCHED\s+(?:BY\s+TARGET\s+)?THEN\s+INSERT\s*\(\s*([\s\S]*?)\s*\)\s*VALUES\s*\(\s*([\s\S]*?)\s*\)/gi;
    let notMatch: RegExpExecArray | null;
    while ((notMatch = whenNotMatchedRegex.exec(restOfMerge)) !== null) {
      pushPositional(mappings, notMatch[1], notMatch[2], sourceTable, targetTable);
    }
  }

  return { mappings, readTables, writeTables, parsed };
}

function collectCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /(?:\bWITH|\)\s*,)\s*(?:\[([^\]]+)\]|(\w+))\s*(?:\([^()]*\)\s*)?AS\s*\(/gi;
  for (const m of sql.matchAll(re)) names.add((m[1] ?? m[2]).toLowerCase());
  return names;
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
  const standaloneUpdateCount = [
    ...cleaned.replace(/\[[^\]]*\]/g, "[]").matchAll(/(\bTHEN\s+)?\bUPDATE\b(?!\s*\(|\s+STATISTICS\b)/gi),
  ].filter((m) => m[1] === undefined).length;
  const insertIntoCount = (cleaned.match(/\bINSERT\s+INTO\b/gi) ?? []).length;
  const mergeCount = (cleaned.match(/\bMERGE\b/gi) ?? []).length;
  totalStatements = standaloneUpdateCount + insertIntoCount + mergeCount;

  for (const result of [
    parseUpdateStatements(cleaned),
    parseInsertSelectStatements(cleaned),
    parseMergeStatements(cleaned),
  ]) {
    for (const mapping of result.mappings) allMappings.push(mapping);
    result.readTables.forEach((t) => readTables.add(t));
    result.writeTables.forEach((t) => writeTables.add(t));
    parsedStatements += result.parsed;
  }

  const cteNames = collectCteNames(cleaned);
  const notCte = (t: string) => !cteNames.has(t.toLowerCase());

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
    readTables: [...readTables].filter(notCte),
    writeTables: [...writeTables].filter(notCte),
    warnings,
    confidence,
  };
}
