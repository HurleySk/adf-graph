import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { makeNodeId, makeEntityId, makePipelineId, parseActivityId } from "../utils/nodeId.js";
import { asNonDynamic } from "../utils/expressionValue.js";
import { loadEntityDetail, type EntityDetail } from "../parsers/dataverseSchema.js";
import { getParameterDefs, getActivityMetadata, getEntityMetadata, getLinkedServiceMetadata } from "../graph/nodeMetadata.js";
import { collectPipelineActivities } from "../graph/traversalUtils.js";
import { resolveChildParameters } from "../utils/parameterResolver.js";

export interface PipelineLookupSuccess {
  node: GraphNode;
  id: string;
  error: undefined;
}

export interface PipelineLookupFailure {
  node: undefined;
  id: string;
  error: string;
}

export type PipelineLookupResult = PipelineLookupSuccess | PipelineLookupFailure;

export function lookupPipelineNode(graph: Graph, pipeline: string): PipelineLookupResult {
  const id = makePipelineId(pipeline);
  const node = graph.getNode(id);
  if (!node) {
    return { node: undefined, id, error: `Pipeline '${pipeline}' not found` };
  }
  return { node, id, error: undefined };
}

export const DATAVERSE_SINK_TYPES = new Set([
  "CommonDataServiceForAppsSink",
  "DynamicsSink",
  "DynamicsCrmSink",
]);

/**
 * The SQL text that shapes the rows an activity writes to Dataverse.
 *
 * Two shapes carry it:
 *   - ExecutePipeline activities driving a generic loader pass it as the
 *     `dest_query` pipeline parameter.
 *   - Plain Copy activities with a Dataverse sink carry it inline as the
 *     source `sqlReaderQuery`; its column aliases are the target attribute
 *     names, exactly like a dest_query.
 *
 * Copy activities with an explicit TabularTranslator column mapping are
 * excluded: there the sink columns are declared outright, so the source
 * aliases carry no attribute-name contract.
 */
export function getActivityDestQuery(graph: Graph, activityNode: GraphNode): string | null {
  const meta = getActivityMetadata(activityNode);

  const destQuery = meta.pipelineParameters
    ? asNonDynamic(meta.pipelineParameters.dest_query)
    : undefined;
  if (destQuery) return destQuery;

  if (meta.activityType !== "Copy") return null;
  if (!meta.sinkType || !DATAVERSE_SINK_TYPES.has(meta.sinkType)) return null;
  if (!meta.sqlQuery) return null;

  const hasExplicitMappings = graph
    .getOutgoing(activityNode.id)
    .some((e) => e.type === EdgeType.MapsColumn);
  if (hasExplicitMappings) return null;

  return meta.sqlQuery;
}

export function resolveEntityName(
  graph: Graph,
  activityNode: GraphNode,
): string | null {
  const params = activityNode.metadata.pipelineParameters as Record<string, unknown> | undefined;
  if (params) {
    const entityName = asNonDynamic(params.dataverse_entity_name);
    if (entityName) {
      return entityName;
    }
  }

  // Copy activities write the entity directly -- no child pipeline to follow
  const written = getWrittenEntity(graph, activityNode.id);
  if (written) return written;

  const { executedPipeline } = getActivityMetadata(activityNode);
  if (executedPipeline) {
    for (const childActivity of collectPipelineActivities(graph, makePipelineId(executedPipeline))) {
      const childWritten = getWrittenEntity(graph, childActivity.id);
      if (childWritten) return childWritten;
    }
  }

  return null;
}

export function getEntityAttributes(
  graph: Graph,
  entityName: string,
  schemaPath?: string,
): Set<string> | null {
  const entityNodeId = makeEntityId(entityName);
  const entityNode = graph.getNode(entityNodeId);
  if (!entityNode) return null;

  const attrs = new Set<string>();

  for (const edge of graph.getOutgoing(entityNodeId, EdgeType.HasAttribute)) {
    const attrNode = graph.getNode(edge.to);
    if (attrNode) {
      const name = attrNode.name.includes(".") ? attrNode.name.split(".").pop()! : attrNode.name;
      attrs.add(name.toLowerCase());
    }
  }

  const detail = getEntityDetail(graph, entityName, schemaPath);
  for (const attr of detail?.attributes ?? []) {
    attrs.add(attr.logicalName.toLowerCase());
  }

  return attrs;
}

export function getEntityDetail(graph: Graph, entityName: string, schemaPath?: string): EntityDetail | null {
  if (!schemaPath) return null;
  const entityNode = graph.getNode(makeEntityId(entityName));
  const schemaFile = entityNode ? getEntityMetadata(entityNode).schemaFile : undefined;
  return schemaFile ? loadEntityDetail(schemaPath, schemaFile) : null;
}

export function getWrittenEntity(graph: Graph, activityId: string): string | null {
  for (const edge of graph.getOutgoing(activityId)) {
    if (edge.type === EdgeType.WritesTo && edge.to.startsWith("dataverse_entity:")) {
      return edge.to.replace(`${NodeType.DataverseEntity}:`, "");
    }
  }
  return null;
}

export interface DestQueryDefaults {
  destQuery: string;
  entityName: string;
  pipelineName: string;
  pipelineId: string;
}

export function resolveDestQueryDefaults(
  pipelineNode: GraphNode,
): DestQueryDefaults | null {
  const paramDefs = getParameterDefs(pipelineNode);
  const destQueryParam = paramDefs.find((p) => p.name === "dest_query");
  const destQueryDefault = asNonDynamic(destQueryParam?.defaultValue);
  if (!destQueryDefault) return null;

  const entityParam = paramDefs.find((p) => p.name === "dataverse_entity_name");
  const entityDefault = asNonDynamic(entityParam?.defaultValue);
  if (!entityDefault) return null;

  return {
    destQuery: destQueryDefault,
    entityName: entityDefault,
    pipelineName: pipelineNode.name,
    pipelineId: pipelineNode.id,
  };
}

const SCHEMA_QUALIFIED_TYPES = new Set<string>([NodeType.Table, NodeType.StoredProcedure]);

export function resolveNode(graph: Graph, type: string, name: string): string | null {
  const qualified = SCHEMA_QUALIFIED_TYPES.has(type);
  if (qualified && !name.includes(".")) {
    const dboId = makeNodeId(type, `dbo.${name}`);
    if (graph.getNode(dboId)) return dboId;
  }

  const exactId = makeNodeId(type, name);
  if (graph.getNode(exactId)) return exactId;

  const lower = name.toLowerCase();
  const match = graph.getNodesByType(type as NodeType).find((n) => {
    const suffix = n.id.slice(type.length + 1).toLowerCase();
    if (suffix === lower) return true;
    const dotIdx = suffix.indexOf(".");
    return qualified && dotIdx >= 0 && suffix.slice(dotIdx + 1) === lower;
  });
  return match?.id ?? null;
}

export function splitQualifiedName(qualified: string): [schema: string, name: string] {
  const dotIdx = qualified.indexOf(".");
  return dotIdx === -1 ? ["dbo", qualified] : [qualified.slice(0, dotIdx), qualified.slice(dotIdx + 1)];
}

export interface DestQueryTarget {
  id: string;
  name: string;
  entityName: string | null;
  destQuery: string;
  isDefault: boolean;
}

export function* iterDestQueryTargets(graph: Graph, pipelineNode: GraphNode): Generator<DestQueryTarget> {
  for (const actNode of collectPipelineActivities(graph, pipelineNode.id)) {
    const destQuery = getActivityDestQuery(graph, actNode);
    if (!destQuery) continue;
    yield {
      id: actNode.id,
      name: actNode.name,
      entityName: resolveEntityName(graph, actNode),
      destQuery,
      isDefault: false,
    };
  }

  const defaults = resolveDestQueryDefaults(pipelineNode);
  if (defaults) {
    yield {
      id: defaults.pipelineId,
      name: `${defaults.pipelineName} (parameter default)`,
      entityName: defaults.entityName,
      destQuery: defaults.destQuery,
      isDefault: true,
    };
  }
}

export function resolveEntityOrTableNode(graph: Graph, entity: string): string | null {
  const entityId = makeEntityId(entity);
  if (graph.getNode(entityId)) return entityId;
  return resolveNode(graph, NodeType.Table, entity);
}

export function resolveActivityParams(graph: Graph, activityNode: GraphNode): Record<string, unknown> {
  const meta = getActivityMetadata(activityNode);
  if (meta.activityType !== "ExecutePipeline") return {};

  const resolved = resolveChildParameters(graph, activityNode);
  return resolved
    ? Object.fromEntries(resolved.resolvedParameters.map((p) => [p.name, p.resolvedValue]))
    : (meta.pipelineParameters ?? {});
}

export interface DatasetLinkedService {
  datasetId: string;
  datasetName: string;
  lsId: string;
  lsName: string;
  lsType: string;
  connectionProperties: Record<string, string>;
}

export function resolveDatasetLinkedServices(
  graph: Graph,
  datasetIds: string[],
): DatasetLinkedService[] {
  const results: DatasetLinkedService[] = [];
  for (const dsId of datasetIds) {
    const dsNode = graph.getNode(dsId);
    if (!dsNode) continue;
    for (const edge of graph.getOutgoing(dsId, EdgeType.UsesLinkedService)) {
      const lsNode = graph.getNode(edge.to);
      if (!lsNode) continue;
      const lsMeta = getLinkedServiceMetadata(lsNode);
      results.push({
        datasetId: dsId,
        datasetName: dsNode.name,
        lsId: lsNode.id,
        lsName: lsNode.name,
        lsType: lsMeta.linkedServiceType,
        connectionProperties: lsMeta.connectionProperties,
      });
    }
  }
  return results;
}

export const TRUNCATE_PATTERN = /TRUNCATE\s+TABLE/i;

export interface TableEdgeInfo {
  pipeline: string;
  activity: string;
  edgeType: EdgeType;
  hasTruncate: boolean;
  fromNodeType: NodeType;
  fromNodeName: string;
  activityType: string | null;
}

export function getTableEdges(graph: Graph, tableName: string): TableEdgeInfo[] {
  const tableId = resolveNode(graph, NodeType.Table, tableName);
  if (!tableId) return [];

  const results: TableEdgeInfo[] = [];
  const incoming = graph.getIncoming(tableId);

  for (const edge of incoming) {
    if (edge.type !== EdgeType.WritesTo && edge.type !== EdgeType.ReadsFrom) continue;
    const fromNode = graph.getNode(edge.from);
    if (!fromNode) continue;

    let pipeline = "";
    let activity = "";

    if (fromNode.type === NodeType.Activity) {
      const parsed = parseActivityId(edge.from);
      pipeline = parsed.pipeline;
      activity = parsed.activity;
    } else {
      pipeline = "(stored procedure)";
      activity = fromNode.name;
    }

    const meta = fromNode.type === NodeType.Activity ? getActivityMetadata(fromNode) : null;
    const hasTruncate = !!(meta?.sqlQuery && TRUNCATE_PATTERN.test(meta.sqlQuery));

    results.push({
      pipeline,
      activity,
      edgeType: edge.type,
      hasTruncate,
      fromNodeType: fromNode.type,
      fromNodeName: fromNode.name,
      activityType: meta?.activityType ?? null,
    });
  }

  return results;
}
