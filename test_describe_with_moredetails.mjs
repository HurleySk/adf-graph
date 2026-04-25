import { buildGraph } from './dist/graph/builder.js';
import { handleDescribePipeline } from './dist/tools/describe.js';

const BOOMERANG_WORK_REPO = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo";

const { graph } = buildGraph(BOOMERANG_WORK_REPO);
const pipelineId = "pipeline:New_Security_Model_Updates_Incl_Inactives";

// Manually trace what describe does
console.log("=== MANUAL TRACE ===");
const outgoing = graph.getOutgoing(pipelineId);
console.log("Total outgoing edges from pipeline:", outgoing.length);

const containsEdges = outgoing.filter(e => e.type === "contains");
console.log("Contains edges (should become activities):", containsEdges.length);

console.log("\nChecking each contains edge:");
let validCount = 0;
for (let i = 0; i < containsEdges.length; i++) {
  const edge = containsEdges[i];
  const actNode = graph.getNode(edge.to);
  if (actNode) {
    validCount++;
    if (i < 3) console.log(`  ${i+1}. ${edge.to} -> ${actNode.name}`);
  } else {
    console.log(`  ${i+1}. ${edge.to} -> NOT FOUND!`);
  }
}
console.log(`\nValid activity nodes found: ${validCount}`);

// Now call the actual function
console.log("\n=== DESCRIBE OUTPUT ===");
const result = handleDescribePipeline(graph, "New_Security_Model_Updates_Incl_Inactives", "activities");
console.log("Activities returned:", result.activities?.length ?? 0);
