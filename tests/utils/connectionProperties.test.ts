import { describe, it, expect } from "vitest";
import { normalizeUri, extractDvOrg } from "../../src/utils/connectionProperties.js";

describe("normalizeUri", () => {
  it("lowercases and strips trailing slashes", () => {
    expect(normalizeUri("https://ALMDataDev.crm9.dynamics.com/")).toBe(
      "https://almdatadev.crm9.dynamics.com",
    );
  });

  it("handles URIs without trailing slashes", () => {
    expect(normalizeUri("https://almdatadev.crm9.dynamics.com")).toBe(
      "https://almdatadev.crm9.dynamics.com",
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeUri("https://org.crm.dynamics.com///")).toBe(
      "https://org.crm.dynamics.com",
    );
  });
});

describe("extractDvOrg", () => {
  it("extracts org name from Dataverse serviceUri", () => {
    expect(extractDvOrg("https://almdatadev.crm9.dynamics.com")).toBe("almdatadev");
  });

  it("extracts org name from commercial cloud URI", () => {
    expect(extractDvOrg("https://contoso.crm.dynamics.com/")).toBe("contoso");
  });

  it("returns null for invalid URI", () => {
    expect(extractDvOrg("not-a-url")).toBeNull();
  });

  it("lowercases the org name", () => {
    expect(extractDvOrg("https://ALMTraining.crm9.dynamics.com")).toBe("almtraining");
  });
});
