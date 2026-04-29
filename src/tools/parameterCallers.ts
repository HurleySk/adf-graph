import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getParameterDefs, getActivityMetadata } from "../graph/nodeMetadata.js";
import { findExecutePipelineActivities } from "../graph/traversalUtils.js";
import { parseActivityId } from "../utils/nodeId.js";
import { lookupPipelineNode } from "./toolUtils.js";

export interface CallerSupply {
  callerPipeline: string;
  callerActivity: string;
  callerActivityId: string;
  suppliedValue: unknown;
  isExpression: boolean;
}

export interface ParameterCallerInfo {
  parameter: string;
  type: string;
  defaultValue: unknown;
  callers: CallerSupply[];
  hasDeadEnd: boolean;
}

export interface ParameterCallersResult {
  pipeline: string;
  parameters: ParameterCallerInfo[];
  totalCallers: number;
  warnings: string[];
  error?: string;
}

function isExpression(value: unknown): boolean {
  if (typeof value === "string" && value.startsWith("@")) return true;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "Expression") return true;
  }
  return false;
}

export function handleParameterCallers(
  graph: Graph,
  pipeline: string,
  parameterFilter?: string,
): ParameterCallersResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error) {
    return {
      pipeline,
      parameters: [],
      totalCallers: 0,
      warnings: [],
      error: lookup.error,
    };
  }

  const warnings: string[] = [];
  const paramDefs = getParameterDefs(lookup.node!);

  const incoming = graph.getIncoming(lookup.id);
  const parentPipelineIds = incoming
    .filter((e) => e.type === EdgeType.Executes)
    .map((e) => e.from);

  const callerMap = new Map<string, CallerSupply[]>();

  for (const parentId of parentPipelineIds) {
    const parentNode = graph.getNode(parentId);
    if (!parentNode || parentNode.type !== NodeType.Pipeline) continue;

    const execActivities = findExecutePipelineActivities(graph, parentId);
    for (const execAct of execActivities) {
      const meta = getActivityMetadata(execAct);
      if (meta.executedPipeline !== pipeline) continue;

      const supplied = meta.pipelineParameters ?? {};
      const { pipeline: callerPipeline, activity: callerActivity } = parseActivityId(execAct.id);

      for (const [paramName, paramValue] of Object.entries(supplied)) {
        if (!callerMap.has(paramName)) callerMap.set(paramName, []);
        callerMap.get(paramName)!.push({
          callerPipeline,
          callerActivity,
          callerActivityId: execAct.id,
          suppliedValue: paramValue,
          isExpression: isExpression(paramValue),
        });
      }
    }
  }

  const parameters: ParameterCallerInfo[] = [];

  for (const param of paramDefs) {
    if (parameterFilter && param.name.toLowerCase() !== parameterFilter.toLowerCase()) continue;

    const callers = callerMap.get(param.name) ?? [];
    const hasEmptyDefault =
      param.defaultValue === "" || param.defaultValue === null || param.defaultValue === undefined;
    const hasConcreteSupplier = callers.some((c) => !c.isExpression);

    parameters.push({
      parameter: param.name,
      type: param.type ?? "String",
      defaultValue: param.defaultValue,
      callers,
      hasDeadEnd: hasEmptyDefault && !hasConcreteSupplier,
    });
  }

  const totalCallers = new Set(
    parentPipelineIds.map((id) => graph.getNode(id)?.name).filter(Boolean)
  ).size;

  return {
    pipeline,
    parameters,
    totalCallers,
    warnings,
  };
}
