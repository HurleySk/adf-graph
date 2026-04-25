import { buildGraph } from './dist/graph/builder.js';
import { scanOverlayPath, mergeOverlayInto } from './dist/graph/overlay.js';
import { Graph } from './dist/graph/model.js';

const BOOMERANG_WORK_REPO = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo";
const overlayPath = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo-staging";

// Build base graph
console.log("=== BUILDING BASE GRAPH ===");
const baseResult = buildGraph(BOOMERANG_WORK_REPO);
const baseGraph = baseResult.graph;

// Check pipeline before merge
const pipelineId = "pipeline:New_Security_Model_Updates_Incl_Inactives";
const beforeOutgoing = baseGraph.getOutgoing(pipelineId);
const beforeContains = beforeOutgoing.filter(e => e.type === "contains");
console.log("Before merge - contains edges:", beforeContains.length);
console.log("Before merge - total outgoing:", beforeOutgoing.length);

// Scan overlay
console.log("\n=== SCANNING OVERLAY ===");
const scan = scanOverlayPath(overlayPath);
console.log("Overlay nodes:", scan.nodes.length);
console.log("Overlay edges:", scan.edges.length);

// Check if target node is in overlay
const targetInOverlay = scan.nodes.find(n => n.id === pipelineId);
console.log("Target pipeline in overlay:", !!targetInOverlay);
if (targetInOverlay) {
  console.log("  Metadata:", targetInOverlay.metadata);
}

// Create overlay graph and merge
console.log("\n=== MERGING OVERLAY ===");
const overlayGraph = new Graph();
for (const node of scan.nodes) overlayGraph.addNode(node);
for (const edge of scan.edges) overlayGraph.addEdge(edge);

console.log("Before merge - pipeline node:", !!baseGraph.getNode(pipelineId));
console.log("Before merge - outgoing count:", baseGraph.getOutgoing(pipelineId).length);

mergeOverlayInto(baseGraph, overlayGraph);

console.log("\nAfter merge - pipeline node:", !!baseGraph.getNode(pipelineId));
const afterNode = baseGraph.getNode(pipelineId);
if (afterNode) {
  console.log("  Metadata:", afterNode.metadata);
}
console.log("After merge - outgoing count:", baseGraph.getOutgoing(pipelineId).length);
