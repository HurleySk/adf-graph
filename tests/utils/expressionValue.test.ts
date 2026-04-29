import { describe, it, expect } from "vitest";
import { asString, asNonDynamic } from "../../src/utils/expressionValue.js";

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

describe("asNonDynamic", () => {
  it("returns string for plain value", () => {
    expect(asNonDynamic("hello")).toBe("hello");
  });

  it("returns undefined for @-expression", () => {
    expect(asNonDynamic("@pipeline().parameters.x")).toBeUndefined();
  });

  it("unwraps Expression object with non-dynamic value", () => {
    expect(asNonDynamic({ value: "SELECT 1", type: "Expression" })).toBe("SELECT 1");
  });

  it("returns undefined for Expression object with @-value", () => {
    expect(asNonDynamic({ value: "@pipeline().parameters.x", type: "Expression" })).toBeUndefined();
  });

  it("returns undefined for null/undefined", () => {
    expect(asNonDynamic(null)).toBeUndefined();
    expect(asNonDynamic(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(asNonDynamic("")).toBeUndefined();
  });
});
