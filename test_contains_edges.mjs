import { buildGraph } from './dist/graph/builder.js';

const BOOMERANG_WORK_REPO = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo";

const { graph } = buildGraph(BOOMERANG_WORK_REPO);
const pipelineId = "pipeline:New_Security_Model_Updates_Incl_Inactives";
const pipelineNode = graph.getNode(pipelineId);

console.log("Pipeline node found:", !!pipelineNode);

const outgoing = graph.getOutgoing(pipelineId);
console.log("Total outgoing edges:", outgoing.length);

const containsEdges = outgoing.filter(e => e.type === "contains");
console.log("Contains edges:", containsEdges.length);

const executesEdges = outgoing.filter(e => e.type === "executes");
console.log("Executes edges:", executesEdges.length);

const dependsEdges = outgoing.filter(e => e.type === "depends_on");
console.log("DependsOn edges:", dependsEdges.length);

console.log("\nEdge types found:", [...new Set(outgoing.map(e => e.type))]);
