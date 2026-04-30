import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { isStub, getParameterDefs } from "../graph/nodeMetadata.js";
import { normalizeUri, extractDvOrg } from "../utils/connectionProperties.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  category: string;
  message: string;
  nodeId?: string;
  relatedNodeId?: string;
}

export interface GraphValidationResult {
  environment: string;
  issueCount: { errors: number; warnings: number };
  issues: ValidationIssue[];
}

export function handleValidate(
  graph: Graph,
  environment: string,
  severity: "all" | "error" | "warning",
  schemaPath?: string,
): GraphValidationResult {
  const issues: ValidationIssue[] = [];

  // ── Error checks ─────────────────────────────────────────────────────────

  for (const edge of graph.allEdges()) {
    const targetNode = graph.getNode(edge.to);
    const targetMissing = !targetNode;
    const targetStub = targetNode ? isStub(targetNode) : false;

    if (!targetMissing && !targetStub) continue;

    const label = targetMissing ? "missing" : "stub";

    switch (edge.type) {
      case EdgeType.Executes:
        if (targetNode?.type === NodeType.Pipeline || (!targetNode && edge.to.startsWith("pipeline:"))) {
          issues.push({
            severity: "error",
            category: "missing_child_pipeline",
            message: `ExecutePipeline edge points to ${label} pipeline '${edge.to}'`,
            nodeId: edge.from,
            relatedNodeId: edge.to,
          });
        }
        break;

      case EdgeType.CallsSp:
        issues.push({
          severity: "error",
          category: "broken_sp_reference",
          message: `calls_sp edge points to ${label} stored procedure '${edge.to}'`,
          nodeId: edge.from,
          relatedNodeId: edge.to,
        });
        break;

      case EdgeType.ReadsFrom:
      case EdgeType.WritesTo:
        if (targetNode?.type === NodeType.Table || (!targetNode && edge.to.startsWith("table:"))) {
          issues.push({
            severity: "error",
            category: "broken_table_reference",
            message: `${edge.type} edge points to ${label} table '${edge.to}'`,
            nodeId: edge.from,
            relatedNodeId: edge.to,
          });
        }
        break;

      case EdgeType.UsesDataset:
        issues.push({
          severity: "error",
          category: "broken_dataset_reference",
          message: `uses_dataset edge points to ${label} dataset '${edge.to}'`,
          nodeId: edge.from,
          relatedNodeId: edge.to,
        });
        break;

      case EdgeType.UsesLinkedService:
        issues.push({
          severity: "error",
          category: "broken_linked_service_reference",
          message: `uses_linked_service edge points to ${label} linked service '${edge.to}'`,
          nodeId: edge.from,
          relatedNodeId: edge.to,
        });
        break;
    }
  }

  // ── Warning checks ───────────────────────────────────────────────────────

  for (const node of graph.allNodes()) {
    // 1. empty_param_default: Pipeline params with empty/null/undefined defaults
    if (node.type === NodeType.Pipeline) {
      const params = getParameterDefs(node);
      for (const param of params) {
        if (param.defaultValue === "" || param.defaultValue === null || param.defaultValue === undefined) {
          issues.push({
            severity: "warning",
            category: "empty_param_default",
            message: `Pipeline '${node.name}' parameter '${param.name}' has empty/null default`,
            nodeId: node.id,
          });
        }
      }
    }

    // 2. unused_dataset: Dataset nodes with no incoming edges
    if (node.type === NodeType.Dataset) {
      const incoming = graph.getIncoming(node.id);
      if (incoming.length === 0) {
        issues.push({
          severity: "warning",
          category: "unused_dataset",
          message: `Dataset '${node.name}' has no incoming edges (not referenced by any activity)`,
          nodeId: node.id,
        });
      }
    }

    // 3. missing_linked_service: Dataset nodes with no uses_linked_service outgoing edge
    if (node.type === NodeType.Dataset) {
      const outgoing = graph.getOutgoing(node.id);
      const hasLsEdge = outgoing.some((e) => e.type === EdgeType.UsesLinkedService);
      if (!hasLsEdge) {
        issues.push({
          severity: "warning",
          category: "missing_linked_service",
          message: `Dataset '${node.name}' has no uses_linked_service edge`,
          nodeId: node.id,
        });
      }
    }

    // 4. orphan_node: Nodes with zero edges in either direction (skip stubs)
    if (!isStub(node)) {
      const incoming = graph.getIncoming(node.id);
      const outgoing = graph.getOutgoing(node.id);
      if (incoming.length === 0 && outgoing.length === 0) {
        issues.push({
          severity: "warning",
          category: "orphan_node",
          message: `Node '${node.name}' (${node.type}) has no edges`,
          nodeId: node.id,
        });
      }
    }
  }

  // ── Cross-org URI mismatch check ────────────────────────────────────────

  for (const node of graph.allNodes()) {
    if (node.type !== NodeType.Activity) continue;
    const outgoing = graph.getOutgoing(node.id);
    const dsEdges = outgoing.filter((e) => e.type === EdgeType.UsesDataset);

    const inputDs = dsEdges.filter((e) => e.metadata.direction === "input");
    const outputDs = dsEdges.filter((e) => e.metadata.direction === "output");
    if (inputDs.length === 0 || outputDs.length === 0) continue;

    const sourceUris = resolveLinkedServiceUris(graph, inputDs.map((e) => e.to));
    const sinkUris = resolveLinkedServiceUris(graph, outputDs.map((e) => e.to));
    if (sourceUris.length === 0 || sinkUris.length === 0) continue;

    for (const src of sourceUris) {
      for (const snk of sinkUris) {
        if (normalizeUri(src.uri) === normalizeUri(snk.uri)) continue;
        const srcOrg = extractDvOrg(src.uri) ?? src.uri;
        const snkOrg = extractDvOrg(snk.uri) ?? snk.uri;
        issues.push({
          severity: "warning",
          category: "cross_org_uri_mismatch",
          message: `Copy activity '${node.name}' reads from '${srcOrg}' (${src.uri}) but writes to '${snkOrg}' (${snk.uri}) — cross-org GUIDs will not match`,
          nodeId: node.id,
          relatedNodeId: snk.lsId,
        });
      }
    }
  }

  // ── Dataverse schema validation ─────────────────────────────────────────
  if (schemaPath) {
    const dvEntities = graph.getNodesByType(NodeType.DataverseEntity);
    for (const entity of dvEntities) {
      if (isStub(entity)) {
        issues.push({
          severity: "warning",
          category: "stub_dataverse_entity",
          message: `Dataverse entity '${entity.name}' is referenced but has no schema definition`,
          nodeId: entity.id,
        });
      }
    }

    for (const node of graph.allNodes()) {
      if (node.type !== NodeType.Activity) continue;
      const outgoing = graph.getOutgoing(node.id);
      const writesToEntities = outgoing
        .filter((e) => e.type === EdgeType.WritesTo && e.to.startsWith("dataverse_entity:"))
        .map((e) => e.to.replace("dataverse_entity:", ""));
      if (writesToEntities.length === 0) continue;

      const mapColumnEdges = outgoing.filter((e) => e.type === EdgeType.MapsColumn);
      for (const edge of mapColumnEdges) {
        const sinkCol = edge.metadata.sinkColumn as string | undefined;
        if (!sinkCol) continue;
        for (const entityName of writesToEntities) {
          const attrNodeId = `dataverse_attribute:${entityName}.${sinkCol}`;
          if (!graph.getNode(attrNodeId)) {
            issues.push({
              severity: "error",
              category: "missing_dataverse_attribute",
              message: `Activity '${node.name}' maps to attribute '${sinkCol}' on entity '${entityName}', but that attribute does not exist in the schema`,
              nodeId: node.id,
              relatedNodeId: `dataverse_entity:${entityName}`,
            });
          }
        }
      }
    }
  }

  // ── Filter by severity ───────────────────────────────────────────────────

  const filtered = severity === "all"
    ? issues
    : issues.filter((i) => i.severity === severity);

  const errors = filtered.filter((i) => i.severity === "error").length;
  const warnings = filtered.filter((i) => i.severity === "warning").length;

  return {
    environment,
    issueCount: { errors, warnings },
    issues: filtered,
  };
}

interface LinkedServiceUri {
  lsId: string;
  uri: string;
}

function resolveLinkedServiceUris(graph: Graph, datasetIds: string[]): LinkedServiceUri[] {
  const results: LinkedServiceUri[] = [];
  for (const dsId of datasetIds) {
    const dsNode = graph.getNode(dsId);
    if (!dsNode) continue;
    for (const edge of graph.getOutgoing(dsId)) {
      if (edge.type !== EdgeType.UsesLinkedService) continue;
      const lsNode = graph.getNode(edge.to);
      if (!lsNode) continue;
      const lsType = lsNode.metadata.linkedServiceType as string | undefined;
      if (lsType !== "CommonDataServiceForApps") continue;
      const cp = lsNode.metadata.connectionProperties as Record<string, string> | undefined;
      const uri = cp?.serviceUri;
      if (uri) results.push({ lsId: lsNode.id, uri });
    }
  }
  return results;
}
