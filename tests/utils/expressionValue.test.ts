import { describe, it, expect } from "vitest";
import { asString } from "../../src/utils/expressionValue.js";

describe("asString", () => {
  it("returns a plain string as-is", () => {
    expect(asString("hello")).toBe("hello");
  });

  it("extracts value from an Expression object", () => {
    expect(asString({ value: "@pipeline().parameters.X", type: "Expression" })).toBe("@pipeline().parameters.X");
  });

  it("returns undefined for a non-Expression object", () => {
    expect(asString({ foo: "bar" })).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(asString(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(asString(undefined)).toBeUndefined();
  });

  it("returns undefined for a number", () => {
    expect(asString(42)).toBeUndefined();
  });

  it("returns undefined when Expression value is not a string", () => {
    expect(asString({ value: 123, type: "Expression" })).toBeUndefined();
  });
});
