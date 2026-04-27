import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getParameterDefs, getActivityMetadata } from "../graph/nodeMetadata.js";
import { findExecutePipelineActivities } from "../graph/traversalUtils.js";
import { parseNodeId } from "../utils/nodeId.js";
import { lookupPipelineNode } from "./toolUtils.js";

interface ParameterSupplier {
  fromPipeline: string;
  activity: string;
  value: unknown;
}

interface ParameterFlow {
  parameter: string;
  definedIn: string;
  type?: string;
  defaultValue?: unknown;
  suppliers: ParameterSupplier[];
}

interface DeadEndParameter {
  pipeline: string;
  parameter: string;
  type?: string;
  defaultValue?: unknown;
  reason: "empty_default_no_supplier" | "null_default_no_supplier" | "no_default_no_supplier";
}

export interface ParameterTraceResult {
  pipeline: string;
  parameterFlows: ParameterFlow[];
  deadEnds: DeadEndParameter[];
  warnings: string[];
  error?: string;
}

export function handleTraceParameters(graph: Graph, pipeline: string): ParameterTraceResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
    return {
      pipeline,
      parameterFlows: [],
      deadEnds: [],
      warnings: [],
      error: lookup.error,
    };
  }
  const pipelineId = lookup.id;

  const flows: ParameterFlow[] = [];
  const deadEnds: DeadEndParameter[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();

  tracePipeline(graph, pipelineId, null, null, null, flows, deadEnds, warnings, visited);

  return { pipeline, parameterFlows: flows, deadEnds, warnings };
}

function tracePipeline(
  graph: Graph,
  pipelineId: string,
  callerPipeline: string | null,
  callerActivity: string | null,
  suppliedParams: Record<string, unknown> | null,
  flows: ParameterFlow[],
  deadEnds: DeadEndParameter[],
  warnings: string[],
  visited: Set<string>,
): void {
  if (visited.has(pipelineId)) return;
  visited.add(pipelineId);

  const node = graph.getNode(pipelineId);
  if (!node) return;

  const paramDefs = getParameterDefs(node);
  if (paramDefs.length === 0) {
    // No parameters — still recurse into children
    recurseIntoChildren(graph, pipelineId, node.name, flows, deadEnds, warnings, visited);
    return;
  }

  for (const param of paramDefs) {
    const flow: ParameterFlow = {
      parameter: param.name,
      definedIn: node.name,
      type: param.type,
      defaultValue: param.defaultValue,
      suppliers: [],
    };

    if (suppliedParams && param.name in suppliedParams) {
      flow.suppliers.push({
        fromPipeline: callerPipeline ?? "external",
        activity: callerActivity ?? "ExecutePipeline",
        value: suppliedParams[param.name],
      });
    }

    flows.push(flow);

    const hasEmptyDefault = param.defaultValue === "" || param.defaultValue === null || param.defaultValue === undefined;
    if (hasEmptyDefault && flow.suppliers.length === 0) {
      const reason: DeadEndParameter["reason"] =
        param.defaultValue === "" ? "empty_default_no_supplier" :
        param.defaultValue === null ? "null_default_no_supplier" :
        "no_default_no_supplier";
      deadEnds.push({
        pipeline: node.name,
        parameter: param.name,
        type: param.type,
        defaultValue: param.defaultValue,
        reason,
      });
    }
  }

  recurseIntoChildren(graph, pipelineId, node.name, flows, deadEnds, warnings, visited);
}

function recurseIntoChildren(
  graph: Graph,
  pipelineId: string,
  parentName: string,
  flows: ParameterFlow[],
  deadEnds: DeadEndParameter[],
  warnings: string[],
  visited: Set<string>,
): void {
  const executesEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Executes);
  const execActivities = findExecutePipelineActivities(graph, pipelineId);

  for (const execEdge of executesEdges) {
    const childPipelineId = execEdge.to;
    const childPipelineName = parseNodeId(childPipelineId).name;
    const actNode = execActivities.find((a) => getActivityMetadata(a).executedPipeline === childPipelineName);
    const childSupplied = actNode ? getActivityMetadata(actNode).pipelineParameters : undefined;
    const actName = actNode?.name ?? "ExecutePipeline";

    tracePipeline(graph, childPipelineId, parentName, actName, childSupplied ?? null, flows, deadEnds, warnings, visited);
  }
}
