import { GraphNode, GraphEdge, NodeType, EdgeType } from "../graph/model.js";
import { ParseResult } from "./parseResult.js";
import { CONNECTION_PROPERTY_KEYS } from "../utils/connectionProperties.js";
import { makeLinkedServiceId, makeKeyVaultSecretId } from "../utils/nodeId.js";

export function parseLinkedServiceFile(json: unknown): ParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object") {
    warnings.push("Invalid linked service JSON: not an object");
    return { nodes, edges, warnings };
  }

  const root = json as Record<string, unknown>;
  const name = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;

  if (!name || !properties) {
    warnings.push("Linked service missing name or properties");
    return { nodes, edges, warnings };
  }

  const lsType = properties.type as string | undefined;
  const typeProperties = properties.typeProperties as Record<string, unknown> | undefined;
  const lsId = makeLinkedServiceId(name);

  const connectionProperties = typeProperties
    ? extractConnectionProperties(typeProperties)
    : {};

  const connectVia = properties.connectVia as Record<string, unknown> | undefined;
  const irName = connectVia?.referenceName as string | undefined;
  if (irName) {
    connectionProperties.connectVia = irName;
  }

  nodes.push({
    id: lsId,
    type: NodeType.LinkedService,
    name,
    metadata: {
      linkedServiceType: lsType ?? null,
      ...(Object.keys(connectionProperties).length > 0 ? { connectionProperties } : {}),
    },
  });

  if (typeProperties) {
    extractKeyVaultRefs(lsId, typeProperties, nodes, edges);
  }

  return { nodes, edges, warnings };
}

function extractConnectionProperties(
  typeProperties: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of CONNECTION_PROPERTY_KEYS) {
    if (key === "connectionString" || key === "connectVia") continue;
    const val = typeProperties[key];
    if (typeof val === "string") {
      result[key] = val;
    }
  }
  const cs = typeProperties.connectionString;
  if (typeof cs === "string") {
    result.connectionString = cs;
  }
  return result;
}

function extractKeyVaultRefs(
  lsId: string,
  obj: Record<string, unknown>,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  for (const value of Object.values(obj)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;

    if (v.type === "AzureKeyVaultSecret") {
      const secretName = v.secretName as string | undefined;
      const store = v.store as Record<string, unknown> | undefined;
      const vaultLsName = store?.referenceName as string | undefined;

      if (secretName) {
        const secretId = makeKeyVaultSecretId(secretName);
        nodes.push({
          id: secretId,
          type: NodeType.KeyVaultSecret,
          name: secretName,
          metadata: { vaultLinkedService: vaultLsName ?? null },
        });
        edges.push({
          from: lsId,
          to: secretId,
          type: EdgeType.ReferencesSecret,
          metadata: {},
        });
      }

      if (vaultLsName) {
        edges.push({
          from: lsId,
          to: makeLinkedServiceId(vaultLsName),
          type: EdgeType.UsesLinkedService,
          metadata: {},
        });
      }
    } else {
      extractKeyVaultRefs(lsId, v as Record<string, unknown>, nodes, edges);
    }
  }
}
