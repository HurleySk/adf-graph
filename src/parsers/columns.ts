import { GraphEdge, EdgeType } from "../graph/model.js";

/**
 * Extract column mapping edges from a Copy activity's translator.mappings[].
 * Each mapping produces a self-edge (from === to === activityId) with metadata
 * describing the source→sink column renaming.
 */
export function extractColumnMappings(
  activityId: string,
  activity: Record<string, unknown>
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;
  if (!typeProperties) return edges;

  const translator = typeProperties.translator as Record<string, unknown> | undefined;
  if (!translator) return edges;

  const mappings = translator.mappings as unknown[] | undefined;
  if (!Array.isArray(mappings)) return edges;

  for (const m of mappings) {
    const mapping = m as Record<string, unknown>;
    const source = mapping.source as Record<string, unknown> | undefined;
    const sink = mapping.sink as Record<string, unknown> | undefined;

    edges.push({
      from: activityId,
      to: activityId,
      type: EdgeType.MapsColumn,
      metadata: {
        sourceColumn: source?.name ?? null,
        sourceType: source?.type ?? null,
        sinkColumn: sink?.name ?? null,
        sinkType: sink?.type ?? null,
      },
    });
  }

  return edges;
}
