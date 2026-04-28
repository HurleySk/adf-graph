import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLinkedServiceFile } from "../../src/parsers/linkedService.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/linkedService");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf-8"));
}

describe("parseLinkedServiceFile", () => {
  it("creates LinkedService node with type metadata", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_azure_sql.json"));
    const node = result.nodes.find((n) => n.id === "linked_service:ls_azure_sql");
    expect(node).toBeDefined();
    expect(node!.type).toBe("linked_service");
    expect(node!.metadata.linkedServiceType).toBe("AzureSqlDatabase");
  });

  it("creates KeyVaultSecret node from AzureKeyVaultSecret reference", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_azure_sql.json"));
    const secret = result.nodes.find((n) => n.id === "key_vault_secret:ALM-ONPREM-SQL-CONNECTION-PROD");
    expect(secret).toBeDefined();
    expect(secret!.type).toBe("key_vault_secret");
    expect(secret!.metadata.vaultLinkedService).toBe("ls_key_vault");
  });

  it("creates ReferencesSecret edge from LS to secret", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_azure_sql.json"));
    const edge = result.edges.find((e) => e.type === "references_secret");
    expect(edge).toBeDefined();
    expect(edge!.from).toBe("linked_service:ls_azure_sql");
    expect(edge!.to).toBe("key_vault_secret:ALM-ONPREM-SQL-CONNECTION-PROD");
  });

  it("creates UsesLinkedService edge to vault LS from the referencing LS", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_azure_sql.json"));
    const edge = result.edges.find(
      (e) => e.type === "uses_linked_service" && e.to === "linked_service:ls_key_vault"
    );
    expect(edge).toBeDefined();
    expect(edge!.from).toBe("linked_service:ls_azure_sql");
  });

  it("handles key vault LS with no secret references", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_key_vault.json"));
    const node = result.nodes.find((n) => n.id === "linked_service:ls_key_vault");
    expect(node).toBeDefined();
    expect(node!.metadata.linkedServiceType).toBe("AzureKeyVault");
    expect(result.edges.filter((e) => e.type === "references_secret")).toHaveLength(0);
  });

  it("extracts connectionProperties from typeProperties", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_dataverse.json"));
    const node = result.nodes.find((n) => n.id === "linked_service:ls_dataverse_dev");
    expect(node).toBeDefined();
    expect(node!.metadata.connectionProperties).toEqual({
      serviceUri: "https://almdatadev.crm.dynamics.com",
      servicePrincipalId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      tenant: "contoso.onmicrosoft.com",
      authenticationType: "ServicePrincipal",
      connectVia: "ir-self-hosted",
    });
  });

  it("extracts baseUrl for Key Vault linked service", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_key_vault.json"));
    const node = result.nodes.find((n) => n.id === "linked_service:ls_key_vault");
    expect(node!.metadata.connectionProperties).toEqual({
      baseUrl: "https://alm-keyvault.vault.azure.net/",
    });
  });

  it("extracts connectVia integration runtime reference", () => {
    const result = parseLinkedServiceFile(loadFixture("ls_azure_sql.json"));
    const node = result.nodes.find((n) => n.id === "linked_service:ls_azure_sql");
    expect(node!.metadata.connectionProperties).toEqual({
      connectVia: "ir-self-hosted",
    });
  });

  it("omits connectionProperties when none are present", () => {
    const result = parseLinkedServiceFile({
      name: "ls_bare",
      properties: { type: "SomeType", typeProperties: {} },
    });
    const node = result.nodes.find((n) => n.id === "linked_service:ls_bare");
    expect(node!.metadata.connectionProperties).toBeUndefined();
  });

  it("returns warning for invalid JSON", () => {
    const result = parseLinkedServiceFile(null);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.nodes).toHaveLength(0);
  });
});
