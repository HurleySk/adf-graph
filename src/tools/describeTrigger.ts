import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { makeTriggerId } from "../utils/nodeId.js";
import type { TriggerSchedule, TriggerPipelineRef } from "../parsers/trigger.js";

interface TriggerInfo {
  name: string;
  type: string;
  runtimeState: string;
  pipelines: TriggerPipelineRef[];
  schedule?: TriggerSchedule;
}

export interface DescribeTriggerResult {
  triggers: TriggerInfo[];
  totalCount: number;
  activeCount: number;
  error?: string;
}

export function handleDescribeTrigger(
  graph: Graph,
  trigger?: string,
  pipeline?: string,
): DescribeTriggerResult {
  if (trigger) {
    const triggerId = makeTriggerId(trigger);
    const node = graph.getNode(triggerId);
    if (!node) {
      return { triggers: [], totalCount: 0, activeCount: 0, error: `Trigger '${trigger}' not found in graph` };
    }
    const info = nodeToTriggerInfo(node.name, node.metadata);
    return { triggers: [info], totalCount: 1, activeCount: info.runtimeState === "Started" ? 1 : 0 };
  }

  const allTriggers = graph.getNodesByType(NodeType.Trigger);
  let triggers = allTriggers.map(n => nodeToTriggerInfo(n.name, n.metadata));

  if (pipeline) {
    triggers = triggers.filter(t =>
      t.pipelines.some(p => p.name.toLowerCase() === pipeline.toLowerCase())
    );
  }

  const activeCount = triggers.filter(t => t.runtimeState === "Started").length;
  return { triggers, totalCount: triggers.length, activeCount };
}

function nodeToTriggerInfo(name: string, metadata: Record<string, unknown>): TriggerInfo {
  return {
    name,
    type: (metadata.triggerType as string) ?? "Unknown",
    runtimeState: (metadata.runtimeState as string) ?? "Unknown",
    pipelines: (metadata.pipelines as TriggerPipelineRef[]) ?? [],
    ...(metadata.schedule ? { schedule: metadata.schedule as TriggerSchedule } : {}),
  };
}
