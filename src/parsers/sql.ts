import { readdirSync, statSync, existsSync } from "fs";
import { join, basename, extname } from "path";
import { GraphNode, NodeType } from "../graph/model.js";
import { ParseResult } from "./pipeline.js";

export { ParseResult };

/**
 * Recursively walk a directory tree and collect all files under
 * directories named exactly `dirName`. Returns a flat list of
 * { schema, filePath } pairs where schema is the parent of the
 * matched directory (e.g., dbo/Stored Procedures → schema = "dbo").
 */
function collectFromNamedDirs(
  root: string,
  dirName: string
): Array<{ schema: string; filePath: string }> {
  const results: Array<{ schema: string; filePath: string }> = [];

  if (!existsSync(root)) return results;

  function walk(dir: string, schemaHint: string | null): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (entry === dirName) {
          // The parent dir name becomes the schema
          const schema = basename(dir);
          // Collect all .sql files in this directory (non-recursive)
          let files: string[];
          try {
            files = readdirSync(fullPath);
          } catch {
            files = [];
          }
          for (const f of files) {
            if (extname(f).toLowerCase() === ".sql") {
              results.push({ schema, filePath: join(fullPath, f) });
            }
          }
        } else {
          // Keep walking; pass current dir name as schemaHint for nested search
          walk(fullPath, schemaHint);
        }
      }
    }
  }

  walk(root, null);
  return results;
}

/**
 * Scan a SQL directory tree for stored procedures and tables.
 * Looks for directories named "Stored Procedures" and "Tables".
 * Schema is inferred from the parent directory (e.g., dbo/).
 */
export function scanSqlDirectory(sqlRoot: string): ParseResult {
  const nodes: GraphNode[] = [];
  const edges = [];
  const warnings: string[] = [];

  if (!existsSync(sqlRoot)) {
    return { nodes, edges, warnings };
  }

  // Stored Procedures
  const spFiles = collectFromNamedDirs(sqlRoot, "Stored Procedures");
  for (const { schema, filePath } of spFiles) {
    const name = basename(filePath, extname(filePath));
    const id = `${NodeType.StoredProcedure}:${schema}.${name}`;
    nodes.push({
      id,
      type: NodeType.StoredProcedure,
      name,
      metadata: { schema, filePath },
    });
  }

  // Tables
  const tableFiles = collectFromNamedDirs(sqlRoot, "Tables");
  for (const { schema, filePath } of tableFiles) {
    const name = basename(filePath, extname(filePath));
    const id = `${NodeType.Table}:${schema}.${name}`;
    nodes.push({
      id,
      type: NodeType.Table,
      name,
      metadata: { schema, filePath },
    });
  }

  return { nodes, edges, warnings };
}
