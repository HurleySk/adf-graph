import {
  stripSqlComments,
  findTopLevelKeyword,
  splitTopLevelCommas,
  splitTrailingAlias,
  unquoteIdent,
  isKeywordAt,
  scanTopLevel,
} from "./sqlLex.js";
import { extractSelectClause, findOuterSelectIndex } from "./destQueryParser.js";

export interface ColumnRef {
  qualifier: string | null;
  column: string;
  table: string | null;
  derived: boolean;
}

export interface SelectSource {
  alias: string;
  table: string | null;
  derivedSql?: string;
  joinCondition?: string;
}

export interface SelectItem {
  alias: string;
  expression: string;
  refs: ColumnRef[];
  isCase: boolean;
}

export interface ResolvedSelect {
  items: SelectItem[];
  sources: SelectSource[];
  star: boolean;
  warnings: string[];
}

const IDENT = String.raw`(?:\[[^\]]+\]|[A-Za-z_][\w$#@]*)`;
const END = String.raw`(?![\w$#@])`;
const QUALIFIED_NAME = new RegExp(String.raw`^${IDENT}(?:\s*\.\s*${IDENT}){0,3}`);
const ALIAS = new RegExp(String.raw`^(?:AS\s+)?(${IDENT})${END}`, "i");
const QUALIFIED_REF = new RegExp(String.raw`(?<![\w$#@.\]])(${IDENT})\s*\.\s*(${IDENT})${END}(?!\s*[.(])`, "g");
const BARE_REF = new RegExp(String.raw`(?<![\w$#@.\]])(${IDENT})${END}(?!\s*[.(])`, "g");
const JOIN = /^(?:(?:LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+JOIN|INNER\s+JOIN|CROSS\s+JOIN|JOIN|(?:CROSS|OUTER)\s+APPLY)\b/i;
const CLAUSE_END = ["WHERE", "GROUP", "ORDER", "HAVING", "UNION", "EXCEPT", "INTERSECT", "OPTION"];
const NOT_ALIAS = new Set(["ON", "LEFT", "RIGHT", "INNER", "FULL", "CROSS", "OUTER", "JOIN", "APPLY", "WITH", ...CLAUSE_END]);
const NOT_COLUMN = new Set([
  "CASE", "WHEN", "THEN", "ELSE", "END", "AND", "OR", "NOT", "NULL", "IS", "IN", "AS", "LIKE", "BETWEEN", "EXISTS",
  "DATE", "DATETIME", "DATETIME2", "DATETIMEOFFSET", "SMALLDATETIME", "TIME", "INT", "BIGINT", "SMALLINT", "TINYINT",
  "BIT", "DECIMAL", "NUMERIC", "FLOAT", "REAL", "MONEY", "VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "TEXT", "NTEXT",
  "UNIQUEIDENTIFIER", "MAX", "AT", "ZONE", "OVER", "PARTITION", "BY", "ORDER", "ASC", "DESC", "DISTINCT", "TOP",
  "COLLATE", "YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "MILLISECOND", "WEEK", "QUARTER", "DAYOFYEAR",
  "WEEKDAY", "TRUE", "FALSE",
]);
const STAR = new RegExp(String.raw`^(?:${IDENT}\s*\.\s*)?\*$`);
const MAX_DEPTH = 4;

function normalizeTable(raw: string): string {
  return raw.split(".").map((p) => unquoteIdent(p.trim())).join(".");
}

function stripStrings(text: string): string {
  return text.replace(/(?<![\w$#@])N?'(?:[^']|'')*'/g, "''");
}

function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return text.length;
}

function nextSourceStart(from: string, start: number): number {
  const at = scanTopLevel(
    from,
    (i) => from[i] === "," || (!/[\w$#@]/.test(from[i - 1] ?? "") && JOIN.test(from.slice(i, i + 24))),
    start,
  );
  return at === -1 ? from.length : at;
}

function cteBodies(sql: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const re = /(?:\bWITH|\)\s*,)\s*(?:\[([^\]]+)\]|(\w+))\s*(?:\([^()]*\)\s*)?AS\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    const open = m.index! + m[0].length - 1;
    bodies.set((m[1] ?? m[2]).toLowerCase(), sql.slice(open + 1, matchParen(sql, open)).trim());
  }
  return bodies;
}

function fromClauseOf(sql: string, selectIdx: number): string {
  const fromIdx = findTopLevelKeyword(sql, "FROM", selectIdx + 6);
  if (fromIdx === -1) return "";
  const start = fromIdx + 4;
  const end = scanTopLevel(
    sql,
    (i) => !/[\w$#@]/.test(sql[i - 1] ?? "") && CLAUSE_END.some((k) => isKeywordAt(sql, i, k)),
    start,
  );
  return sql.slice(start, end === -1 ? sql.length : end);
}

export function parseFromClause(from: string, ctes: Map<string, string> = new Map()): SelectSource[] {
  const sources: SelectSource[] = [];
  let i = 0;
  const rest = () => from.slice(i);
  const skipWs = () => {
    while (i < from.length && /\s/.test(from[i])) i++;
  };
  const skipHint = () => {
    const hint = /^WITH\s*\(/i.exec(rest());
    if (hint) {
      i = matchParen(from, i + hint[0].length - 1) + 1;
      skipWs();
    }
  };
  while (i < from.length) {
    skipWs();
    let table: string | null = null;
    let derivedSql: string | undefined;
    let defaultAlias = "";
    if (from[i] === "(") {
      const close = matchParen(from, i);
      derivedSql = from.slice(i + 1, close).trim();
      i = close + 1;
    } else {
      const m = QUALIFIED_NAME.exec(rest());
      if (!m) break;
      const name = normalizeTable(m[0]);
      i += m[0].length;
      defaultAlias = name.split(".").pop()!;
      const cte = name.includes(".") ? undefined : ctes.get(name.toLowerCase());
      if (cte !== undefined) derivedSql = cte;
      else table = name;
    }
    skipWs();
    skipHint();
    let alias = defaultAlias;
    const am = ALIAS.exec(rest());
    if (am && !NOT_ALIAS.has(unquoteIdent(am[1]).toUpperCase())) {
      alias = unquoteIdent(am[1]);
      i += am[0].length;
      skipWs();
      skipHint();
    }
    let joinCondition: string | undefined;
    if (isKeywordAt(from, i, "ON")) {
      const end = nextSourceStart(from, i + 2);
      joinCondition = from.slice(i + 2, end).trim().replace(/\s+/g, " ");
      i = end;
    }
    sources.push({
      alias,
      table,
      ...(derivedSql !== undefined ? { derivedSql } : {}),
      ...(joinCondition ? { joinCondition } : {}),
    });
    skipWs();
    if (from[i] === ",") {
      i++;
      continue;
    }
    const jm = JOIN.exec(rest());
    if (!jm) break;
    i += jm[0].length;
  }
  return sources;
}

function throughSource(src: SelectSource, column: string, depth: number, ctes: Map<string, string>): ColumnRef[] {
  const qualifier = src.alias || null;
  if (src.derivedSql === undefined) return [{ qualifier, column, table: src.table, derived: false }];
  if (depth >= MAX_DEPTH) return [{ qualifier, column, table: null, derived: true }];
  const inner = resolveSelect(src.derivedSql, depth + 1, ctes);
  const item = inner.items.find((it) => it.alias.toLowerCase() === column.toLowerCase());
  if (!item) return [{ qualifier, column, table: null, derived: true }];
  return item.refs.map((r) => ({ ...r, qualifier, derived: true }));
}

function ownerOf(column: string, sources: SelectSource[], depth: number, ctes: Map<string, string>): SelectSource | undefined {
  if (sources.length === 1) return sources[0];
  if (depth >= MAX_DEPTH) return undefined;
  const owners = sources.filter(
    (s) =>
      s.derivedSql !== undefined &&
      resolveSelect(s.derivedSql, depth + 1, ctes).items.some((it) => it.alias.toLowerCase() === column.toLowerCase()),
  );
  return owners.length === 1 ? owners[0] : undefined;
}

export function resolveRefs(
  expression: string,
  sources: SelectSource[],
  depth = 0,
  ctes: Map<string, string> = new Map(),
): ColumnRef[] {
  const text = stripStrings(expression);
  const refs: ColumnRef[] = [];
  const seen = new Set<string>();
  const add = (r: ColumnRef) => {
    const key = `${r.qualifier}|${r.column}|${r.table}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(r);
    }
  };
  for (const m of text.matchAll(QUALIFIED_REF)) {
    const qualifier = unquoteIdent(m[1]);
    const column = unquoteIdent(m[2]);
    const src = sources.find((s) => s.alias.toLowerCase() === qualifier.toLowerCase());
    if (!src) add({ qualifier, column, table: null, derived: false });
    else for (const r of throughSource(src, column, depth, ctes)) add(r);
  }
  for (const m of text.replace(QUALIFIED_REF, " ").matchAll(BARE_REF)) {
    const column = unquoteIdent(m[1]);
    if (NOT_COLUMN.has(column.toUpperCase())) continue;
    const owner = ownerOf(column, sources, depth, ctes);
    if (owner) for (const r of throughSource(owner, column, depth, ctes)) add(r);
    else add({ qualifier: null, column, table: null, derived: false });
  }
  return refs;
}

function splitItem(part: string): { alias: string; expression: string } | null {
  const text = part.trim();
  const withAs = splitTrailingAlias(text);
  if (withAs) return withAs;
  const assigned = /^(\[[^\]]+\]|[A-Za-z_]\w*)\s*=(?![=<>])\s*([\s\S]+)$/.exec(text);
  if (assigned && !NOT_COLUMN.has(assigned[1].toUpperCase())) {
    return { alias: unquoteIdent(assigned[1]), expression: assigned[2].trim() };
  }
  const implicit = /^([\s\S]*[\w\])'])\s+(\[[^\]]+\]|[A-Za-z_]\w*)$/.exec(text);
  if (implicit && !NOT_COLUMN.has(unquoteIdent(implicit[2]).toUpperCase())) {
    return { alias: unquoteIdent(implicit[2]), expression: implicit[1].trim() };
  }
  if (new RegExp(String.raw`^${IDENT}(?:\s*\.\s*${IDENT})*$`).test(text)) {
    return { alias: unquoteIdent(text.split(".").pop()!.trim()), expression: text };
  }
  return null;
}

export function resolveSelect(sql: string, depth = 0, outerCtes: Map<string, string> = new Map()): ResolvedSelect {
  const warnings: string[] = [];
  const cleaned = stripSqlComments(sql);
  const selectIdx = findOuterSelectIndex(cleaned);
  if (selectIdx === -1) return { items: [], sources: [], star: false, warnings: ["no SELECT found"] };
  const list = (extractSelectClause(cleaned) ?? "").replace(/^\s*DISTINCT\s+/i, "");
  const ctes = new Map([...outerCtes, ...cteBodies(cleaned)]);
  const sources = parseFromClause(fromClauseOf(cleaned, selectIdx), ctes);
  const items: SelectItem[] = [];
  let star = false;
  for (const part of splitTopLevelCommas(list)) {
    if (STAR.test(part.trim())) {
      star = true;
      continue;
    }
    const split = splitItem(part);
    if (!split) {
      warnings.push(`no column name for: ${part.trim().slice(0, 80)}`);
      continue;
    }
    items.push({
      alias: split.alias,
      expression: split.expression,
      refs: resolveRefs(split.expression, sources, depth, ctes),
      isCase: /^CASE\b/i.test(split.expression),
    });
  }
  return { items, sources, star, warnings };
}
