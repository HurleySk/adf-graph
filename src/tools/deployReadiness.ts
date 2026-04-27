import { Graph, NodeType, EdgeType } from "../graph/model.js";

interface DependencyStatus {
  name: string;
  status: "present" | "stub" | "missing";
  referencedBy: string;
}

interface ParameterIssue {
  pipeline: string;
  parameter: string;
  issue: "empty_default" | "no_supplier";
  defaultValue?: unknown;
}

export interface DeployReadinessResult {
  pipeline: string;
  ready: boolean;
  dependencies: {
    pipelines: DependencyStatus[];
    datasets: DependencyStatus[];
    linkedServices: DependencyStatus[];
    tables: DependencyStatus[];
    storedProcedures: DependencyStatus[];
    dataverseEntities: DependencyStatus[];
  };
  parameterIssues: ParameterIssue[];
  warnings: string[];
  error?: string;
}

export function handleDeployReadiness(graph: Graph, pipeline: string): DeployReadinessResult {
  const pipelineId = `${NodeType.Pipeline}:${pipeline}`;
  const pipelineNode = graph.getNode(pipelineId);

  if (!pipelineNode) {
    return {
      pipeline,
      ready: false,
      dependencies: { pipelines: [], datasets: [], linkedServices: [], tables: [], storedProcedures: [], dataverseEntities: [] },
      parameterIssues: [],
      warnings: [],
      error: `Pipeline '${pipeline}' not found`,
    };
  }

  const deps: Map<string, { referencedBy: string }> = new Map();
  const parameterIssues: ParameterIssue[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>([pipelineId]);

  walkDependencies(graph, pipelineId, pipeline, deps, visited);
  checkParameters(graph, pipelineId, null, parameterIssues, new Set<string>());

  const dependencies = categorizeDeps(graph, deps);
  const hasStubOrMissing = Object.values(dependencies).some((list) =>
    list.some((d) => d.status !== "present"),
  );

  return {
    pipeline,
    ready: !hasStubOrMissing && parameterIssues.length === 0,
    dependencies,
    parameterIssues,
    warnings,
  };
}

function walkDependencies(
  graph: Graph,
  nodeId: string,
  referencedBy: string,
  deps: Map<string, { referencedBy: string }>,
  visited: Set<string>,
): void {
  const edges = graph.getOutgoing(nodeId);
  const node = graph.getNode(nodeId);

  for (const edge of edges) {
    if (edge.type === EdgeType.MapsColumn || edge.type === EdgeType.DependsOn) continue;

    const targetId = edge.to;
    if (visited.has(targetId)) continue;

    const refLabel = node?.name ?? nodeId;

    if (edge.type === EdgeType.Contains) {
      // Activities are internal — traverse through them but don't add as deps
      visited.add(targetId);
      walkDependencies(graph, targetId, refLabel, deps, visited);
    } else {
      // External dependency — add it and recurse
      deps.set(targetId, { referencedBy: refLabel });
      visited.add(targetId);
      walkDependencies(graph, targetId, graph.getNode(targetId)?.name ?? targetId, deps, visited);
    }
  }
}

function checkParameters(
  graph: Graph,
  pipelineId: string,
  suppliedParams: Record<string, unknown> | null,
  issues: ParameterIssue[],
  visited: Set<string>,
): void {
  if (visited.has(pipelineId)) return;
  visited.add(pipelineId);

  const node = graph.getNode(pipelineId);
  if (!node) return;

  const paramDefs = node.metadata.parameters as Array<{ name: string; type: string; defaultValue: unknown }> | undefined;
  if (!paramDefs || !Array.isArray(paramDefs)) return;

  for (const param of paramDefs) {
    const isSupplied = suppliedParams !== null && param.name in suppliedParams;
    const hasEmptyDefault = param.defaultValue === "" || param.defaultValue === null || param.defaultValue === undefined;

    if (hasEmptyDefault && !isSupplied) {
      issues.push({
        pipeline: node.name,
        parameter: param.name,
        issue: param.defaultValue === "" ? "empty_default" : "no_supplier",
        defaultValue: param.defaultValue,
      });
    }
  }

  // Find ExecutePipeline activities and recurse into child pipelines
  const containsEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Contains);
  const executesEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Executes);

  const execActivities = containsEdges
    .map((ce) => graph.getNode(ce.to))
    .filter((n): n is NonNullable<typeof n> => n !== undefined && n.metadata.activityType === "ExecutePipeline");

  for (const execEdge of executesEdges) {
    const childPipelineName = execEdge.to.split(":")[1];
    const actNode = execActivities.find((a) => a.metadata.executedPipeline === childPipelineName);
    const childParams = actNode?.metadata.pipelineParameters as Record<string, unknown> | undefined;
    checkParameters(graph, execEdge.to, childParams ?? null, issues, visited);
  }
}

function categorizeDeps(
  graph: Graph,
  deps: Map<string, { referencedBy: string }>,
): DeployReadinessResult["dependencies"] {
  const result: DeployReadinessResult["dependencies"] = {
    pipelines: [],
    datasets: [],
    linkedServices: [],
    tables: [],
    storedProcedures: [],
    dataverseEntities: [],
  };

  for (const [id, { referencedBy }] of deps) {
    const node = graph.getNode(id);
    const name = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
    const status: DependencyStatus["status"] = node
      ? node.metadata.stub ? "stub" : "present"
      : "missing";
    const entry: DependencyStatus = { name, status, referencedBy };

    const prefix = id.split(":")[0];
    switch (prefix) {
      case "pipeline": result.pipelines.push(entry); break;
      case "dataset": result.datasets.push(entry); break;
      case "linked_service": result.linkedServices.push(entry); break;
      case "table": result.tables.push(entry); break;
      case "stored_procedure": result.storedProcedures.push(entry); break;
      case "dataverse_entity": result.dataverseEntities.push(entry); break;
    }
  }

  return result;
}
