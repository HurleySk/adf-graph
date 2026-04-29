import { Graph, NodeType, EdgeType } from "../graph/model.js";
import type { GraphNode } from "../graph/model.js";
import { getParameterDefs, getActivityMetadata } from "../graph/nodeMetadata.js";
import { asString, asNonDynamic } from "./expressionValue.js";
import { makePipelineId } from "./nodeId.js";
import { detectCdcPattern, type CdcPipelineInfo } from "./cdcPatterns.js";

export interface ResolvedParameter {
  name: string;
  type: string;
  resolvedValue: unknown;
  source: "caller" | "default";
  isExpression: boolean;
}

export interface ResolvedChildPipeline {
  childPipeline: string;
  callerActivity: string;
  resolvedParameters: ResolvedParameter[];
  cdcInfo: CdcPipelineInfo | null;
}

export function resolveChildParameters(
  graph: Graph,
  activityNode: GraphNode,
): ResolvedChildPipeline | null {
  const meta = getActivityMetadata(activityNode);
  if (meta.activityType !== "ExecutePipeline" || !meta.executedPipeline) return null;

  const childPipelineId = makePipelineId(meta.executedPipeline);
  const childNode = graph.getNode(childPipelineId);
  const childParams = childNode ? getParameterDefs(childNode) : [];

  const suppliedValues = meta.pipelineParameters ?? {};

  const resolvedParams = new Map<string, ResolvedParameter>();

  // Start with child's declared parameters
  for (const param of childParams) {
    const supplied = suppliedValues[param.name];
    const suppliedStr = asString(supplied);
    const isExpression = suppliedStr !== undefined && suppliedStr.startsWith("@");
    const concreteSupplied = asNonDynamic(supplied);

    if (supplied !== undefined) {
      resolvedParams.set(param.name, {
        name: param.name,
        type: param.type,
        resolvedValue: concreteSupplied ?? supplied,
        source: "caller",
        isExpression,
      });
    } else {
      resolvedParams.set(param.name, {
        name: param.name,
        type: param.type,
        resolvedValue: param.defaultValue,
        source: "default",
        isExpression: false,
      });
    }
  }

  // Include any supplied params not declared by the child (e.g. runtime params)
  for (const [key, val] of Object.entries(suppliedValues)) {
    if (resolvedParams.has(key)) continue;
    const valStr = asString(val);
    resolvedParams.set(key, {
      name: key,
      type: "String",
      resolvedValue: asNonDynamic(val) ?? val,
      source: "caller",
      isExpression: valStr !== undefined && valStr.startsWith("@"),
    });
  }

  // Build a flat record of resolved concrete values for CDC detection
  const concreteValues: Record<string, unknown> = {};
  for (const [key, rp] of resolvedParams) {
    concreteValues[key] = rp.resolvedValue;
  }

  const cdcInfo = detectCdcPattern(concreteValues);

  return {
    childPipeline: meta.executedPipeline,
    callerActivity: activityNode.name,
    resolvedParameters: Array.from(resolvedParams.values()),
    cdcInfo: cdcInfo.isCdc ? cdcInfo : null,
  };
}
