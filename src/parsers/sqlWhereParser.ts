import { extractTablesFromSql } from "./parseResult.js";

export interface FilterCondition {
  column: string;
  operator: string;
  value: string;
  isSubquery: boolean;
  subqueryTable?: string;
  connector: string;
}

export interface WhereClause {
  raw: string;
  conditions: FilterCondition[];
}

export function extractWhereClause(sql: string): WhereClause | null {
  const upper = sql.toUpperCase();

  // Pre-compute parenthesis depth at each character position
  const depth = new Int8Array(sql.length);
  let d = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") d++;
    depth[i] = d;
    if (sql[i] === ")") d--;
  }

  // Find WHERE at depth 0
  let whereStart = -1;
  for (let i = 0; i < sql.length; i++) {
    if (depth[i] !== 0) continue;
    const remaining = upper.substring(i);
    if (remaining.startsWith("WHERE") && (i === 0 || /\s/.test(sql[i - 1]))) {
      const after = sql[i + 5];
      if (!after || /\s/.test(after)) {
        whereStart = i + 5;
        break;
      }
    }
  }

  if (whereStart === -1) return null;

  // Collect until GROUP BY / ORDER BY / HAVING / ; / end at depth 0
  const terminators = ["GROUP BY", "ORDER BY", "HAVING"];
  let whereEnd = sql.length;
  for (let i = whereStart; i < sql.length; i++) {
    if (depth[i] !== 0) continue;
    if (sql[i] === ";") {
      whereEnd = i;
      break;
    }
    const remaining = upper.substring(i);
    for (const term of terminators) {
      if (remaining.startsWith(term)) {
        const before = i === 0 || /\s/.test(sql[i - 1]);
        const after = sql[i + term.length];
        if (before && (!after || /\s/.test(after))) {
          whereEnd = i;
          break;
        }
      }
    }
    if (whereEnd !== sql.length) break;
  }

  const raw = sql.substring(whereStart, whereEnd).trim();
  if (!raw) return null;

  const conditions = parseConditions(raw, depth.slice(whereStart, whereEnd));
  return { raw, conditions };
}

function parseConditions(whereText: string, depthMap: Int8Array): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  const upper = whereText.toUpperCase();

  // Split on top-level AND/OR, but skip AND inside BETWEEN...AND
  const segments: Array<{ text: string; connector: string }> = [];
  let current = "";
  let pendingConnector = "";
  let inBetween = false;
  let i = 0;

  while (i < whereText.length) {
    if (depthMap[i] !== 0) {
      current += whereText[i];
      i++;
      continue;
    }

    const remaining = upper.substring(i);

    // Track BETWEEN to skip its AND
    if (!inBetween && remaining.startsWith("BETWEEN") && (i === 0 || /\s/.test(whereText[i - 1]))) {
      const after = whereText[i + 7];
      if (!after || /\s/.test(after)) {
        inBetween = true;
      }
    }

    if (remaining.startsWith("AND") && (i === 0 || /\s/.test(whereText[i - 1]))) {
      const after = whereText[i + 3];
      if (!after || /\s/.test(after)) {
        if (inBetween) {
          // This AND is part of BETWEEN...AND, keep it in current segment
          inBetween = false;
          current += whereText.substring(i, i + 3);
          i += 3;
          continue;
        }
        if (current.trim()) {
          segments.push({ text: current.trim(), connector: pendingConnector });
          current = "";
        }
        pendingConnector = "AND";
        i += 3;
        continue;
      }
    }
    if (remaining.startsWith("OR") && (i === 0 || /\s/.test(whereText[i - 1]))) {
      const after = whereText[i + 2];
      if (!after || /\s/.test(after)) {
        if (current.trim()) {
          segments.push({ text: current.trim(), connector: pendingConnector });
          current = "";
        }
        pendingConnector = "OR";
        i += 2;
        continue;
      }
    }

    current += whereText[i];
    i++;
  }
  if (current.trim()) {
    segments.push({ text: current.trim(), connector: pendingConnector });
  }

  for (const seg of segments) {
    conditions.push(parseOneCondition(seg.text, seg.connector));
  }

  return conditions;
}

function parseOneCondition(text: string, connector: string): FilterCondition {
  const upper = text.toUpperCase().trim();

  // Try common patterns: col OP value
  const patterns: Array<{ regex: RegExp; opName: string }> = [
    { regex: /^(.+?)\s+(NOT\s+IN)\s*(\([\s\S]*\))$/i, opName: "NOT IN" },
    { regex: /^(.+?)\s+(IN)\s*(\([\s\S]*\))$/i, opName: "IN" },
    { regex: /^(.+?)\s+(NOT\s+LIKE)\s+(.+)$/i, opName: "NOT LIKE" },
    { regex: /^(.+?)\s+(LIKE)\s+(.+)$/i, opName: "LIKE" },
    { regex: /^(.+?)\s+(IS\s+NOT\s+NULL)$/i, opName: "IS NOT NULL" },
    { regex: /^(.+?)\s+(IS\s+NULL)$/i, opName: "IS NULL" },
    { regex: /^(.+?)\s+(NOT\s+BETWEEN)\s+(.+)$/i, opName: "NOT BETWEEN" },
    { regex: /^(.+?)\s+(BETWEEN)\s+(.+)$/i, opName: "BETWEEN" },
    { regex: /^(.+?)\s*(<>|!=|>=|<=|>|<|=)\s*(.+)$/i, opName: "" },
    { regex: /^(NOT\s+EXISTS)\s*(\([\s\S]*\))$/i, opName: "NOT EXISTS" },
    { regex: /^(EXISTS)\s*(\([\s\S]*\))$/i, opName: "EXISTS" },
  ];

  for (const { regex, opName } of patterns) {
    const match = text.match(regex);
    if (!match) continue;

    if (opName === "EXISTS" || opName === "NOT EXISTS") {
      const subqueryText = match[2];
      const tables = extractTablesFromSql(subqueryText);
      return {
        column: "",
        operator: opName,
        value: subqueryText.trim(),
        isSubquery: true,
        subqueryTable: tables[0],
        connector,
      };
    }

    const column = match[1].trim();
    const operator = opName || match[2].trim().toUpperCase();
    const value = match[3]?.trim() ?? "";

    if (opName === "IS NULL" || opName === "IS NOT NULL") {
      return { column, operator, value: "", isSubquery: false, connector };
    }

    const isSubquery = /\(\s*SELECT\b/i.test(value);
    let subqueryTable: string | undefined;
    if (isSubquery) {
      // Extract table from subquery — try schema.table first, then unqualified
      const schemaMatch = value.match(/FROM\s+\[?(\w+)\]?\.\[?(\w+)\]?/i);
      if (schemaMatch) {
        subqueryTable = `${schemaMatch[1]}.${schemaMatch[2]}`;
      } else {
        const unqualified = value.match(/FROM\s+\[?(\w+)\]?/i);
        if (unqualified) subqueryTable = unqualified[1];
      }
    }

    return { column, operator, value, isSubquery, subqueryTable, connector };
  }

  // Fallback: unparseable condition
  return {
    column: text,
    operator: "UNKNOWN",
    value: "",
    isSubquery: false,
    connector,
  };
}
