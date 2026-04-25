import { GraphManager } from './dist/graph/manager.js';
import { loadConfig } from './dist/config.js';

const config = loadConfig();
const manager = new GraphManager(config);

// Test base environment
console.log("=== BASE ENVIRONMENT ===");
const { graph: baseGraph } = manager.ensureGraph("default");
const basePipelineNode = baseGraph.getNode("pipeline:New_Security_Model_Updates_Incl_Inactives");
console.log("Pipeline node exists:", !!basePipelineNode);
const baseOutgoing = baseGraph.getOutgoing("pipeline:New_Security_Model_Updates_Incl_Inactives");
const baseContains = baseOutgoing.filter(e => e.type === "contains");
console.log("Contains edges in base:", baseContains.length);

// Test merged environment
console.log("\n=== MERGED ENVIRONMENT ===");
const { graph: mergedGraph } = manager.ensureGraph("default+overlays");
const mergedPipelineNode = mergedGraph.getNode("pipeline:New_Security_Model_Updates_Incl_Inactives");
console.log("Pipeline node exists:", !!mergedPipelineNode);
const mergedOutgoing = mergedGraph.getOutgoing("pipeline:New_Security_Model_Updates_Incl_Inactives");
const mergedContains = mergedOutgoing.filter(e => e.type === "contains");
console.log("Contains edges in merged:", mergedContains.length);
console.log("Total outgoing in merged:", mergedOutgoing.length);
console.log("Outgoing edge types:", [...new Set(mergedOutgoing.map(e => e.type))]);

// Check if the pipeline node has data
if (mergedPipelineNode) {
  console.log("\nPipeline node details:");
  console.log("  ID:", mergedPipelineNode.id);
  console.log("  Name:", mergedPipelineNode.name);
  console.log("  Type:", mergedPipelineNode.type);
  console.log("  Metadata:", mergedPipelineNode.metadata);
}
