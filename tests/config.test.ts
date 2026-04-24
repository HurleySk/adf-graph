import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { loadConfig } from "../src/config.js";

const tmpDir = join(import.meta.dirname, ".tmp-config");

function setup(): void {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  mkdirSync(tmpDir, { recursive: true });
}

function writeConfig(filename: string, content: unknown): string {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, JSON.stringify(content), "utf-8");
  return filePath;
}

// Save and restore env vars around each test
const savedEnv: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  // Clear tracking for next test
  for (const k of Object.keys(savedEnv)) {
    delete savedEnv[k];
  }
}

beforeEach(() => {
  setup();
  // Clear all three env vars before each test
  setEnv({ ADF_CONFIG: undefined, ADF_ROOT: undefined });
});

afterEach(() => {
  restoreEnv();
});

describe("loadConfig", () => {
  describe("ADF_CONFIG env var", () => {
    it("loads config from the path in ADF_CONFIG", () => {
      const cfgPath = writeConfig("my-config.json", {
        environments: {
          "work-repo": { path: "/some/path", default: true },
          dev1: { path: "/other/path" },
        },
      });
      setEnv({ ADF_CONFIG: cfgPath });

      const config = loadConfig();
      expect(Object.keys(config.environments)).toHaveLength(2);
      expect(config.environments["work-repo"].path).toBe("/some/path");
      expect(config.environments["work-repo"].default).toBe(true);
      expect(config.environments["dev1"].path).toBe("/other/path");
    });

    it("throws if ADF_CONFIG points to a non-existent file", () => {
      setEnv({ ADF_CONFIG: join(tmpDir, "does-not-exist.json") });
      expect(() => loadConfig()).toThrow(/config file not found/);
    });

    it("throws if ADF_CONFIG points to invalid JSON", () => {
      const badPath = join(tmpDir, "bad.json");
      writeFileSync(badPath, "{ not valid json", "utf-8");
      setEnv({ ADF_CONFIG: badPath });
      expect(() => loadConfig()).toThrow(/failed to parse config file/);
    });

    it("throws if config has no environments key", () => {
      const cfgPath = writeConfig("no-envs.json", { foo: "bar" });
      setEnv({ ADF_CONFIG: cfgPath });
      expect(() => loadConfig()).toThrow(/must have an "environments" object/);
    });

    it("throws if an environment is missing path", () => {
      const cfgPath = writeConfig("missing-path.json", {
        environments: { myenv: { default: true } },
      });
      setEnv({ ADF_CONFIG: cfgPath });
      expect(() => loadConfig()).toThrow(/must have a "path" string/);
    });

    it("throws if environments object is empty", () => {
      const cfgPath = writeConfig("empty-envs.json", { environments: {} });
      setEnv({ ADF_CONFIG: cfgPath });
      expect(() => loadConfig()).toThrow(/at least one environment/);
    });
  });

  describe("ADF_ROOT fallback", () => {
    it("returns single default environment from ADF_ROOT when no config file", () => {
      setEnv({ ADF_ROOT: "/my/adf/root" });

      const config = loadConfig();
      expect(Object.keys(config.environments)).toHaveLength(1);
      expect(config.environments["default"]).toBeDefined();
      expect(config.environments["default"].path).toBe("/my/adf/root");
      expect(config.environments["default"].default).toBe(true);
    });
  });

  describe("error when nothing configured", () => {
    it("throws a helpful error when no env vars and no config file", () => {
      // Both ADF_CONFIG and ADF_ROOT are cleared in beforeEach
      // The sidecar file (adf-graph.json next to dist/) won't exist in test env
      expect(() => loadConfig()).toThrow(/no configuration found/);
    });
  });
});
