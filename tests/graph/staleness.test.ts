import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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

    // Use cooldownMs=0 so every isStale() does a full walk
    const checker = new StalenessChecker(tmpDir, 0);
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

  describe("multi-path support", () => {
    it("accepts an array of root paths", () => {
      const dir1 = join(tmpDir, "root1");
      const dir2 = join(tmpDir, "root2");
      mkdirSync(join(dir1, "pipeline"), { recursive: true });
      mkdirSync(join(dir2, "pipeline"), { recursive: true });

      const checker = new StalenessChecker([dir1, dir2]);
      checker.markBuilt();
      expect(checker.isStale()).toBe(false);
    });

    it("detects staleness from any watched path", async () => {
      const dir1 = join(tmpDir, "root1");
      const dir2 = join(tmpDir, "root2");
      mkdirSync(join(dir1, "pipeline"), { recursive: true });
      mkdirSync(join(dir2, "pipeline"), { recursive: true });
      writeFileSync(join(dir1, "pipeline", "a.json"), "{}");

      // Use cooldownMs=0 so every isStale() does a full walk
      const checker = new StalenessChecker([dir1, dir2], 0);
      checker.markBuilt();
      expect(checker.isStale()).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 50));

      writeFileSync(join(dir2, "pipeline", "b.json"), "{}");
      expect(checker.isStale()).toBe(true);
    });

    it("single string constructor still works (backward compat)", () => {
      const checker = new StalenessChecker(tmpDir);
      checker.markBuilt();
      expect(checker.isStale()).toBe(false);
    });

    it("addPath registers a new path and forces staleness", () => {
      const dir1 = join(tmpDir, "root1");
      mkdirSync(join(dir1, "pipeline"), { recursive: true });

      const checker = new StalenessChecker(dir1);
      checker.markBuilt();
      expect(checker.isStale()).toBe(false);

      const dir2 = join(tmpDir, "root2");
      mkdirSync(join(dir2, "pipeline"), { recursive: true });
      checker.addPath(dir2);
      expect(checker.isStale()).toBe(true);
    });

    it("removePath unregisters a path and forces staleness", () => {
      const dir1 = join(tmpDir, "root1");
      const dir2 = join(tmpDir, "root2");
      mkdirSync(join(dir1, "pipeline"), { recursive: true });
      mkdirSync(join(dir2, "pipeline"), { recursive: true });

      const checker = new StalenessChecker([dir1, dir2]);
      checker.markBuilt();
      expect(checker.isStale()).toBe(false);

      checker.removePath(dir2);
      expect(checker.isStale()).toBe(true);
    });
  });

  describe("cooldown", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("second isStale() within cooldown returns cached result without re-walking", () => {
      const pipelineDir = join(tmpDir, "pipeline");
      mkdirSync(pipelineDir, { recursive: true });
      writeFileSync(join(pipelineDir, "a.json"), "{}");

      // Use a long cooldown so the second call is definitely within the window
      const checker = new StalenessChecker(tmpDir, 60_000);
      checker.markBuilt();

      // Spy on the private currentMaxMtime via the prototype
      const spy = vi.spyOn(
        StalenessChecker.prototype as any,
        "currentMaxMtime"
      );

      // First call: should perform a full walk
      expect(checker.isStale()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);

      // Second call: should return cached result, no additional walk
      expect(checker.isStale()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("isStale() re-evaluates after cooldown expires", async () => {
      const pipelineDir = join(tmpDir, "pipeline");
      mkdirSync(pipelineDir, { recursive: true });
      writeFileSync(join(pipelineDir, "a.json"), "{}");

      // Use a very short cooldown (50ms)
      const checker = new StalenessChecker(tmpDir, 50);
      checker.markBuilt();

      const spy = vi.spyOn(
        StalenessChecker.prototype as any,
        "currentMaxMtime"
      );

      // First call: full walk
      expect(checker.isStale()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Second call after cooldown: should re-walk
      expect(checker.isStale()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("markBuilt() resets cooldown so next isStale() re-walks", () => {
      const pipelineDir = join(tmpDir, "pipeline");
      mkdirSync(pipelineDir, { recursive: true });
      writeFileSync(join(pipelineDir, "a.json"), "{}");

      const checker = new StalenessChecker(tmpDir, 60_000);
      checker.markBuilt();

      const spy = vi.spyOn(
        StalenessChecker.prototype as any,
        "currentMaxMtime"
      );

      // First isStale: full walk
      expect(checker.isStale()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);

      // markBuilt resets cooldown (also calls currentMaxMtime internally)
      checker.markBuilt();
      expect(spy).toHaveBeenCalledTimes(2);

      // Next isStale after markBuilt: should do a full walk again, not use cache
      expect(checker.isStale()).toBe(false);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it("addPath/removePath (invalidate) resets cooldown so next isStale() re-evaluates", () => {
      const dir1 = join(tmpDir, "root1");
      const dir2 = join(tmpDir, "root2");
      mkdirSync(join(dir1, "pipeline"), { recursive: true });
      mkdirSync(join(dir2, "pipeline"), { recursive: true });

      const checker = new StalenessChecker(dir1, 60_000);
      checker.markBuilt();

      // isStale: not stale, sets cooldown
      expect(checker.isStale()).toBe(false);

      // addPath invalidates — builtAt becomes null, so isStale returns true
      // without even reaching the cooldown check
      checker.addPath(dir2);
      expect(checker.isStale()).toBe(true);

      // Rebuild and verify fresh state
      checker.markBuilt();
      expect(checker.isStale()).toBe(false);

      // removePath also invalidates
      checker.removePath(dir2);
      expect(checker.isStale()).toBe(true);
    });
  });
});
