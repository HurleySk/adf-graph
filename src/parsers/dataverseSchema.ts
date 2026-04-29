import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { GraphNode, GraphEdge, NodeType, EdgeType } from "../graph/model.js";
import { makeEntityId, makeAttributeId } from "../utils/nodeId.js";

export interface SchemaParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
  entityCount: number;
}

export interface OptionSetValue {
  value: number;
  label: string;
}

export interface AttributeDetail {
  logicalName: string;
  attributeType: string;
  requiredLevel: string;
  isValidForCreate: boolean;
  isValidForUpdate: boolean;
  displayName: string;
  isCustomAttribute: boolean;
  optionSet?: OptionSetValue[];
}

export interface EntityDetail {
  logicalName: string;
  attributes: AttributeDetail[];
}

// In-memory cache for lazy-loaded per-entity detail files
const entityDetailCache = new Map<string, EntityDetail>();

export function clearEntityDetailCache(): void {
  entityDetailCache.clear();
}

interface IndexEntry {
  logicalName: string;
  displayName: string;
  entitySetName: string;
  primaryId: string;
  primaryName: string;
  attributeCount: number;
  file: string;
  attributes: string;
}

interface SchemaIndex {
  entities: IndexEntry[];
}

export function parseSchemaIndex(schemaPath: string): SchemaParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const indexPath = join(dirname(schemaPath), "_index.json");

  if (!existsSync(indexPath)) {
    warnings.push(`_index.json not found at: ${indexPath}`);
    return { nodes, edges, warnings, entityCount: 0 };
  }

  let index: SchemaIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf-8")) as SchemaIndex;
  } catch (err) {
    warnings.push(`Failed to parse _index.json: ${String(err)}`);
    return { nodes, edges, warnings, entityCount: 0 };
  }

  let entityCount = 0;

  for (const entry of index.entities ?? []) {
    if (!entry.file || !entry.logicalName) {
      warnings.push(`Skipping index entry with missing file or logicalName: ${JSON.stringify(entry)}`);
      continue;
    }

    const entityFilePath = join(schemaPath, entry.file);
    if (!existsSync(entityFilePath)) {
      // Entity is in the index but has no file in this environment directory — skip it
      continue;
    }

    entityCount++;
    const entityId = makeEntityId(entry.logicalName);

    nodes.push({
      id: entityId,
      type: NodeType.DataverseEntity,
      name: entry.logicalName,
      metadata: {
        displayName: entry.displayName,
        entitySetName: entry.entitySetName,
        primaryId: entry.primaryId,
        primaryName: entry.primaryName,
        attributeCount: entry.attributeCount,
        schemaFile: entry.file,
      },
    });

    // Split comma-separated attribute names
    const attrStr = typeof entry.attributes === "string" ? entry.attributes : "";
    const attributeNames = attrStr
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    for (const attrName of attributeNames) {
      const attrId = makeAttributeId(entry.logicalName, attrName);

      nodes.push({
        id: attrId,
        type: NodeType.DataverseAttribute,
        name: attrName,
        metadata: {
          entityLogicalName: entry.logicalName,
        },
      });

      edges.push({
        from: entityId,
        to: attrId,
        type: EdgeType.HasAttribute,
        metadata: {},
      });
    }
  }

  return { nodes, edges, warnings, entityCount };
}

export function loadEntityDetail(
  schemaPath: string,
  schemaFile: string
): EntityDetail | null {
  const cacheKey = `${schemaPath}::${schemaFile}`;

  if (entityDetailCache.has(cacheKey)) {
    return entityDetailCache.get(cacheKey)!;
  }

  const filePath = join(schemaPath, schemaFile);
  if (!existsSync(filePath)) {
    return null;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const logicalName = (raw.LogicalName as string) ?? "";
  const rawAttributes = (raw.Attributes as unknown[]) ?? [];

  const attributes: AttributeDetail[] = rawAttributes.map((a) => {
    const attr = a as Record<string, unknown>;
    const requiredLevelObj = attr.RequiredLevel as Record<string, unknown> | undefined;
    const displayNameObj = attr.DisplayName as Record<string, unknown> | undefined;
    const userLocalizedLabel = displayNameObj?.UserLocalizedLabel as
      | Record<string, unknown>
      | undefined;

    const optionSetObj = attr.OptionSet as Record<string, unknown> | undefined;
    let optionSet: OptionSetValue[] | undefined;
    if (optionSetObj) {
      const options = (optionSetObj.Options as unknown[]) ?? [];
      optionSet = options.map((o) => {
        const opt = o as Record<string, unknown>;
        const labelObj = opt.Label as Record<string, unknown> | undefined;
        const userLabel = labelObj?.UserLocalizedLabel as Record<string, unknown> | undefined;
        return {
          value: (opt.Value as number) ?? 0,
          label: (userLabel?.Label as string) ?? "",
        };
      });
    }

    return {
      logicalName: (attr.LogicalName as string) ?? "",
      attributeType: (attr.AttributeType as string) ?? "",
      requiredLevel: (requiredLevelObj?.Value as string) ?? "",
      isValidForCreate: (attr.IsValidForCreate as boolean) ?? false,
      isValidForUpdate: (attr.IsValidForUpdate as boolean) ?? false,
      displayName: (userLocalizedLabel?.Label as string) ?? "",
      isCustomAttribute: (attr.IsCustomAttribute as boolean) ?? false,
      optionSet,
    };
  });

  const detail: EntityDetail = { logicalName, attributes };
  entityDetailCache.set(cacheKey, detail);
  return detail;
}
