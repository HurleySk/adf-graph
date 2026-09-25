const QUOTE_CLOSE: Record<string, string> = { "'": "'", '"': '"', "[": "]" };
const WORD_CHAR = /[\w$#@]/;

function skipQuoted(sql: string, i: number): number {
  const end = sql.indexOf(QUOTE_CLOSE[sql[i]], i + 1);
  return end === -1 ? sql.length : end;
}

function skipBlockComment(sql: string, start: number): number {
  let nesting = 0;
  let i = start;
  while (i < sql.length) {
    if (sql[i] === "/" && sql[i + 1] === "*") { nesting++; i += 2; continue; }
    if (sql[i] === "*" && sql[i + 1] === "/") {
      i += 2;
      if (--nesting === 0) return i;
      continue;
    }
    i++;
  }
  return sql.length;
}

export function isKeywordAt(sql: string, upper: string, i: number, keyword: string): boolean {
  if (!upper.startsWith(keyword, i)) return false;
  const before = sql[i - 1];
  const after = sql[i + keyword.length];
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (QUOTE_CLOSE[ch]) {
      const stop = skipQuoted(sql, i) + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
    } else if (ch === "/" && sql[i + 1] === "*") {
      out += " ";
      i = skipBlockComment(sql, i);
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export type SqlVisitor = (i: number, depth: number, inCase: boolean) => boolean | void;

export function scanSql(sql: string, visit: SqlVisitor, start = 0): number {
  const upper = sql.toUpperCase();
  let depth = 0;
  let caseDepth = 0;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (QUOTE_CLOSE[ch]) { i = skipQuoted(sql, i); continue; }
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth === 0) {
      if (isKeywordAt(sql, upper, i, "CASE")) { caseDepth++; i += 3; continue; }
      if (caseDepth > 0 && isKeywordAt(sql, upper, i, "END")) { caseDepth--; i += 2; continue; }
    }
    if (visit(i, depth, caseDepth > 0) === true) return i;
  }
  return -1;
}

export function scanTopLevel(sql: string, visit: (i: number) => boolean | void, start = 0): number {
  return scanSql(sql, (i, depth, inCase) => (depth === 0 && !inCase ? visit(i) : undefined), start);
}

export function findTopLevelKeyword(sql: string, keyword: string, start = 0): number {
  const upper = sql.toUpperCase();
  return scanTopLevel(sql, (i) => isKeywordAt(sql, upper, i, keyword), start);
}

export function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let last = 0;
  scanTopLevel(text, (i) => {
    if (text[i] !== ",") return;
    parts.push(text.slice(last, i).trim());
    last = i + 1;
  });
  const tail = text.slice(last).trim();
  if (tail) parts.push(tail);
  return parts;
}

export function unquoteIdent(name: string): string {
  if ((name.startsWith("[") && name.endsWith("]")) || (name.startsWith('"') && name.endsWith('"'))) {
    return name.substring(1, name.length - 1);
  }
  return name;
}

export function splitTrailingAlias(expr: string): { expression: string; alias: string } | null {
  const trimmed = expr.trim();
  const upper = trimmed.toUpperCase();
  let lastAs = -1;
  scanTopLevel(trimmed, (i) => {
    if (isKeywordAt(trimmed, upper, i, "AS")) lastAs = i;
  });
  if (lastAs === -1) return null;
  const alias = unquoteIdent(trimmed.substring(lastAs + 2).trim());
  return alias ? { expression: trimmed.substring(0, lastAs).trim(), alias } : null;
}

export function parenDepthMap(sql: string): Int16Array {
  const depth = new Int16Array(sql.length);
  let d = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") d++;
    depth[i] = d;
    if (sql[i] === ")") d--;
  }
  return depth;
}
