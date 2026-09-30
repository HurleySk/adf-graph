import { Graph, GraphEdge, NodeType, EdgeType } from "./model.js";
import { asString } from "../utils/expressionValue.js";
import { makeEntityId, parseActivityId } from "../utils/nodeId.js";

type Direction = EdgeType.ReadsFrom | EdgeType.WritesTo;

const DATASET_PARAM_RE = /^@dataset\(\)\.(\w+)$/;
const PIPELINE_PARAM_RE = /^@pipeline\(\)\.parameters\.(\w+)$/;
const FETCHXML_ENTITY_RE = /<entity\s+name\s*=\s*["']([^"']+)["']/i;

function addEntityEdge(graph: Graph, from: string, entity: string, type: Direction): void {
  const to = makeEntityId(entity);
  if (!graph.getOutgoing(from, type).some((e) => e.to === to)) {
    graph.addEdge({ from, to, type, metadata: {} });
  }
}

function resolveDatasetEntity(
  raw: unknown,
  activityParams: Record<string, unknown>,
  datasetParams: Record<string, unknown>,
): string | undefined {
  const s = asString(raw)?.trim();
  if (!s) return undefined;
  const m = DATASET_PARAM_RE.exec(s);
  if (!m) return s;
  const p = m[1];
  const value = Object.prototype.hasOwnProperty.call(activityParams, p)
    ? asString(activityParams[p])
    : asString((datasetParams[p] as Record<string, unknown> | undefined)?.defaultValue);
  return value?.trim() || undefined;
}

/**
 * Derive activity -> Dataverse entity reads_from / writes_to edges from the dataset
 * each activity uses: literal or hard-coded entityName, `@dataset().p` resolved from
 * the activity's parameters or the dataset default, FetchXML root entity for reads,
 * and `@pipeline().parameters.p` resolved from ExecutePipeline callers. Idempotent.
 */
export function resolveEntityReferences(graph: Graph): void {
  const paramUsage = new Map<string, Map<string, Set<Direction>>>();
  const recordUsage = (pipeline: string, param: string, dir: Direction): boolean => {
    let byParam = paramUsage.get(pipeline);
    if (!byParam) paramUsage.set(pipeline, (byParam = new Map()));
    let dirs = byParam.get(param);
    if (!dirs) byParam.set(param, (dirs = new Set()));
    if (dirs.has(dir)) return false;
    dirs.add(dir);
    return true;
  };

  const activities = graph.getNodesByType(NodeType.Activity);

  for (const act of activities) {
    const { pipeline } = parseActivityId(act.id);
    const fetchXml = act.metadata.fetchXmlQuery as string | undefined;

    for (const edge of graph.getOutgoing(act.id, EdgeType.UsesDataset)) {
      const direction = edge.metadata.direction;
      if (direction !== "input" && direction !== "output") continue;
      const dir: Direction = direction === "input" ? EdgeType.ReadsFrom : EdgeType.WritesTo;
      const ds = graph.getNode(edge.to);
      if (!ds || ds.metadata.entityName === undefined) continue;

      const fetchEntity = dir === EdgeType.ReadsFrom && fetchXml ? FETCHXML_ENTITY_RE.exec(fetchXml)?.[1] : undefined;
      if (fetchEntity) {
        addEntityEdge(graph, act.id, fetchEntity, dir);
        continue;
      }

      const value = resolveDatasetEntity(
        ds.metadata.entityName,
        (edge.metadata.parameters as Record<string, unknown> | undefined) ?? {},
        (ds.metadata.parameters as Record<string, unknown> | undefined) ?? {},
      );
      if (!value) continue;
      if (!value.startsWith("@")) {
        addEntityEdge(graph, act.id, value, dir);
        continue;
      }
      const pm = PIPELINE_PARAM_RE.exec(value);
      if (pm) recordUsage(pipeline, pm[1], dir);
    }
  }

  const callers = activities.filter((a) => a.metadata.activityType === "ExecutePipeline");
  const pending: Array<{ from: string; entity: string; dir: Direction }> = [];
  let changed = true;
  while (changed) {
    changed = false;
    pending.length = 0;
    for (const act of callers) {
      const child = act.metadata.executedPipeline as string | undefined;
      const usage = child ? paramUsage.get(child) : undefined;
      if (!usage) continue;
      const params = (act.metadata.pipelineParameters as Record<string, unknown> | undefined) ?? {};
      const { pipeline } = parseActivityId(act.id);
      for (const [param, dirs] of usage) {
        const value = asString(params[param])?.trim();
        if (!value) continue;
        const pm = PIPELINE_PARAM_RE.exec(value);
        for (const dir of dirs) {
          if (!value.startsWith("@")) pending.push({ from: act.id, entity: value, dir });
          else if (pm && recordUsage(pipeline, pm[1], dir)) changed = true;
        }
      }
    }
  }
  for (const p of pending) addEntityEdge(graph, p.from, p.entity, p.dir);

  for (const act of callers) {
    const child = act.metadata.executedPipeline as string | undefined;
    const dirs = child ? paramUsage.get(child)?.get("dataverse_entity_name") : undefined;
    if (!dirs || dirs.has(EdgeType.WritesTo)) continue;
    const guesses: GraphEdge[] = graph
      .getOutgoing(act.id, EdgeType.WritesTo)
      .filter((e) => e.metadata.inferredFromParameter === "dataverse_entity_name");
    for (const e of guesses) graph.removeEdge(e);
  }
}
