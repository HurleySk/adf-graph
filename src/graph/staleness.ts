import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** Directories to watch for changes (relative to rootPath). */
const WATCHED_DIRS = ["pipeline", "dataset", "linkedService", "SQL DB"];

/**
 * Recursively find the maximum mtime (in milliseconds) under a directory.
 * Returns 0 if the directory doesn't exist or is empty.
 */
function maxMtimeMs(dir: string): number {
  if (!existsSync(dir)) return 0;

  let max = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
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
      const sub = maxMtimeMs(fullPath);
      if (sub > max) max = sub;
    } else {
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    }
  }
  return max;
}

/**
 * Mtime-based staleness checker for the graph builder.
 *
 * Watches `pipeline/`, `dataset/`, `linkedService/`, and `SQL DB/` under
 * the given root. Reports stale when any file in those directories has a
 * mtime newer than the last recorded build time.
 */
export class StalenessChecker {
  private rootPath: string;
  /** Wall-clock timestamp (ms since epoch) when markBuilt() was last called, or null. */
  private builtAt: number | null = null;
  /** Max file mtime (ms) observed at the time of the last markBuilt() call. */
  private builtMaxMtime: number | null = null;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Returns true if the graph needs to be rebuilt:
   * - Never built
   * - Root path does not exist
   * - Any watched file has mtime > the mtime snapshot at last build
   */
  isStale(): boolean {
    if (this.builtAt === null || this.builtMaxMtime === null) return true;
    if (!existsSync(this.rootPath)) return true;

    const currentMax = this.currentMaxMtime();
    return currentMax > this.builtMaxMtime;
  }

  /**
   * Records the current maximum mtime across all watched files and the
   * wall-clock time of the build.
   */
  markBuilt(): void {
    this.builtMaxMtime = this.currentMaxMtime();
    this.builtAt = Date.now();
  }

  /**
   * Returns the wall-clock time when markBuilt() was last called,
   * or null if it has never been called.
   */
  lastBuildTime(): Date | null {
    if (this.builtAt === null) return null;
    return new Date(this.builtAt);
  }

  private currentMaxMtime(): number {
    let max = 0;
    for (const dir of WATCHED_DIRS) {
      const fullDir = join(this.rootPath, dir);
      const m = maxMtimeMs(fullDir);
      if (m > max) max = m;
    }
    return max;
  }
}
