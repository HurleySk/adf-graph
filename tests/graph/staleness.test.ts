import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { StalenessChecker } from "../../src/graph/staleness.js";

const tmpDir = join(import.meta.dirname, "../.tmp-staleness");

function setup(): void {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  mkdirSync(tmpDir, { recursive: true });
}

beforeEach(() => {
  setup();
});

describe("StalenessChecker", () => {
  it("reports stale on first check (never built)", () => {
    const checker = new StalenessChecker(tmpDir);
    expect(checker.isStale()).toBe(true);
  });

  it("reports not stale after markBuilt", () => {
    const checker = new StalenessChecker(tmpDir);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);
  });

  it("reports stale after a file is written post-markBuilt", async () => {
    // Create a pipeline sub-directory with a file
    const pipelineDir = join(tmpDir, "pipeline");
    mkdirSync(pipelineDir, { recursive: true });
    writeFileSync(join(pipelineDir, "existing.json"), "{}");

    const checker = new StalenessChecker(tmpDir);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);

    // Wait 50ms to ensure new mtime is strictly later than markBuilt timestamp
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Write a new file after markBuilt
    writeFileSync(join(pipelineDir, "new-pipeline.json"), "{}");

    expect(checker.isStale()).toBe(true);
  });

  it("reports stale when root path does not exist", () => {
    const checker = new StalenessChecker("/nonexistent/path/that/does/not/exist");
    expect(checker.isStale()).toBe(true);
  });

  it("returns null for lastBuildTime before markBuilt, Date after", () => {
    const checker = new StalenessChecker(tmpDir);
    expect(checker.lastBuildTime()).toBeNull();

    checker.markBuilt();
    const t = checker.lastBuildTime();
    expect(t).toBeInstanceOf(Date);
    // Should be very recent
    expect(Date.now() - t!.getTime()).toBeLessThan(2000);
  });
});
