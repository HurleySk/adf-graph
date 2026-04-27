import { NodeType } from "../graph/model.js";

export function makeNodeId(type: string, name: string): string {
  return `${type}:${name}`;
}

export function makeActivityId(pipeline: string, activity: string): string {
  return `activity:${pipeline}/${activity}`;
}

export function parseNodeId(id: string): { type: string; name: string } {
  const colonIdx = id.indexOf(":");
  if (colonIdx < 0) return { type: "", name: id };
  return { type: id.slice(0, colonIdx), name: id.slice(colonIdx + 1) };
}

export function parseActivityId(id: string): { pipeline: string; activity: string } {
  const prefix = "activity:";
  const body = id.startsWith(prefix) ? id.slice(prefix.length) : id;
  const slashIdx = body.indexOf("/");
  if (slashIdx < 0) return { pipeline: body, activity: body };
  return { pipeline: body.slice(0, slashIdx), activity: body.slice(slashIdx + 1) };
}

export function inferNodeType(id: string): NodeType | null {
  const { type: prefix } = parseNodeId(id);
  switch (prefix) {
    case "pipeline": return NodeType.Pipeline;
    case "activity": return NodeType.Activity;
    case "dataset": return NodeType.Dataset;
    case "stored_procedure": return NodeType.StoredProcedure;
    case "table": return NodeType.Table;
    case "dataverse_entity": return NodeType.DataverseEntity;
    case "linked_service": return NodeType.LinkedService;
    case "key_vault_secret": return NodeType.KeyVaultSecret;
    default: return null;
  }
}
