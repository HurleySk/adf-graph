export interface TableDdlParseResult {
  columns: string[];
  warnings: string[];
}

const SKIP_KEYWORDS = /^\s*(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|INDEX|CHECK|FOREIGN\s+KEY)\b/i;

export function parseTableDdl(ddlSql: string): TableDdlParseResult {
  const columns: string[] = [];
  const warnings: string[] = [];

  let sql = ddlSql.replace(/^﻿/, "");

  const createIdx = sql.toUpperCase().indexOf("CREATE TABLE");
  if (createIdx === -1) {
    warnings.push("No CREATE TABLE statement found");
    return { columns, warnings };
  }

  const openParen = sql.indexOf("(", createIdx);
  if (openParen === -1) {
    warnings.push("No opening parenthesis found after CREATE TABLE");
    return { columns, warnings };
  }

  // Find the matching closing paren
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    if (sql[i] === ")") {
      depth--;
      if (depth === 0) { closeParen = i; break; }
    }
  }

  const body = sql.substring(openParen + 1, closeParen === -1 ? sql.length : closeParen);

  // Split by top-level commas
  const parts: string[] = [];
  depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth--; current += ch; continue; }
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || SKIP_KEYWORDS.test(trimmed)) continue;

    // Extract column name: [Name] or bare identifier
    const bracketMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (bracketMatch) {
      columns.push(bracketMatch[1].toLowerCase());
      continue;
    }

    const bareMatch = trimmed.match(/^(\w+)\s/);
    if (bareMatch) {
      columns.push(bareMatch[1].toLowerCase());
    }
  }

  return { columns, warnings };
}
