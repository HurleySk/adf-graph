import { buildGraph } from './dist/graph/builder.js';
import { handleDescribePipeline } from './dist/tools/describe.js';

const BOOMERANG_WORK_REPO = "C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo";

const { graph } = buildGraph(BOOMERANG_WORK_REPO);
const result = handleDescribePipeline(graph, "New_Security_Model_Updates_Incl_Inactives", "activities");

console.log("Pipeline Name:", result.pipeline);
console.log("Error:", result.error);
console.log("Number of activities:", result.activities?.length ?? 0);
console.log("\nActivity names:");
result.activities?.forEach((a, i) => {
  console.log(`  ${i+1}. ${a.name} (${a.activityType})`);
});
