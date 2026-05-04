import { NodeType } from "../graph/model.js";

export function makeNodeId(type: string, name: string): string {
  return `${type}:${name}`;
}

export function makeTableId(schema: string, table: string): string {
  return makeNodeId(NodeType.Table, `${schema}.${table}`);
}

export function makeEntityId(name: string): string {
  return makeNodeId(NodeType.DataverseEntity, name);
}

export function makePipelineId(name: string): string {
  return makeNodeId(NodeType.Pipeline, name);
}

export function makeActivityId(pipelineName: string, prefix: string, activityName: string): string {
  return makeNodeId(NodeType.Activity, `${pipelineName}/${prefix}${activityName}`);
}

export function makeSpId(schema: string, name: string): string {
  return makeNodeId(NodeType.StoredProcedure, `${schema}.${name}`);
}

export function makeDatasetId(name: string): string {
  return makeNodeId(NodeType.Dataset, name);
}

export function makeLinkedServiceId(name: string): string {
  return makeNodeId(NodeType.LinkedService, name);
}

export function makeKeyVaultSecretId(name: string): string {
  return makeNodeId(NodeType.KeyVaultSecret, name);
}

export function makeTriggerId(name: string): string {
  return makeNodeId(NodeType.Trigger, name);
}

export function makeIntegrationRuntimeId(name: string): string {
  return makeNodeId(NodeType.IntegrationRuntime, name);
}

export function makeAttributeId(entityName: string, attributeName: string): string {
  return makeNodeId(NodeType.DataverseAttribute, `${entityName}.${attributeName}`);
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
    case "dataverse_attribute": return NodeType.DataverseAttribute;
    case "linked_service": return NodeType.LinkedService;
    case "key_vault_secret": return NodeType.KeyVaultSecret;
    case "trigger": return NodeType.Trigger;
    case "integration_runtime": return NodeType.IntegrationRuntime;
    default: return null;
  }
}
