import { scanOverlayPath } from './dist/graph/overlay.js';

const overlayPath = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo-staging";

const result = scanOverlayPath(overlayPath);

console.log("Nodes scanned from overlay:", result.nodes.length);
console.log("Edges scanned from overlay:", result.edges.length);
console.log("Warnings:", result.warnings);

// Check if New_Security_Model_Updates_Incl_Inactives is in the overlay
const targetNode = result.nodes.find(n => n.name === "New_Security_Model_Updates_Incl_Inactives");
if (targetNode) {
  console.log("\nTarget pipeline found in overlay!");
  console.log("  ID:", targetNode.id);
  console.log("  Type:", targetNode.type);
  console.log("  Metadata:", targetNode.metadata);
} else {
  console.log("\nTarget pipeline NOT found in overlay");
}

// Check all pipeline nodes
const pipelineNodes = result.nodes.filter(n => n.type === "pipeline");
console.log(`\nTotal pipelines in overlay: ${pipelineNodes.length}`);
pipelineNodes.forEach(p => console.log("  -", p.name));
