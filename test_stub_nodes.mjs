import { scanOverlayPath } from './dist/graph/overlay.js';

const overlayPath = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo-staging";
const scan = scanOverlayPath(overlayPath);

// Count stub nodes
const stubNodes = scan.nodes.filter(n => n.metadata.stub === true);
console.log("Total nodes in overlay scan:", scan.nodes.length);
console.log("Stub nodes (referenced but not defined):", stubNodes.length);

// Show some examples
console.log("\nExample stubs:");
stubNodes.slice(0, 10).forEach(n => {
  console.log(`  ${n.id}`);
});

// Check if any overlays have edges pointing to/from stub nodes
const stubEdges = scan.edges.filter(e => {
  const isFromStub = scan.nodes.find(n => n.id === e.from && n.metadata.stub);
  const isToStub = scan.nodes.find(n => n.id === e.to && n.metadata.stub);
  return isFromStub || isToStub;
});

console.log("\nEdges involving stub nodes:", stubEdges.length);

// Check the specific pipeline
const pipelineId = "pipeline:New_Security_Model_Updates_Incl_Inactives";
const edgesWithPipeline = scan.edges.filter(e => e.from === pipelineId || e.to === pipelineId);
console.log(`\nEdges involving ${pipelineId}:`, edgesWithPipeline.length);
