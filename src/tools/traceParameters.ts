import { Graph, NodeType, EdgeType } from "../graph/model.js";

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
  const pipelineId = `${NodeType.Pipeline}:${pipeline}`;
  const pipelineNode = graph.getNode(pipelineId);

  if (!pipelineNode) {
    return {
      pipeline,
      parameterFlows: [],
      deadEnds: [],
      warnings: [],
      error: `Pipeline '${pipeline}' not found`,
    };
  }

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

  const paramDefs = node.metadata.parameters as Array<{ name: string; type: string; defaultValue: unknown }> | undefined;
  if (!paramDefs || !Array.isArray(paramDefs) || paramDefs.length === 0) {
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
  pipelineName: string,
  flows: ParameterFlow[],
  deadEnds: DeadEndParameter[],
  warnings: string[],
  visited: Set<string>,
): void {
  const containsEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Contains);
  const executesEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Executes);

  // Build a list of ExecutePipeline activities with their params
  const execActivities = containsEdges
    .map((ce) => graph.getNode(ce.to))
    .filter((n): n is NonNullable<typeof n> => n !== undefined && n.metadata.activityType === "ExecutePipeline");

  // Match each Executes edge to its activity by position (both ordered from pipeline JSON)
  for (let i = 0; i < executesEdges.length; i++) {
    const childPipelineId = executesEdges[i].to;
    const actNode = i < execActivities.length ? execActivities[i] : undefined;
    const childSupplied = actNode?.metadata.pipelineParameters as Record<string, unknown> | undefined;
    const actName = actNode?.name ?? "ExecutePipeline";

    tracePipeline(graph, childPipelineId, pipelineName, actName, childSupplied ?? null, flows, deadEnds, warnings, visited);
  }
}
