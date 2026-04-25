import { parsePipelineFile } from './dist/parsers/pipeline.js';
import fs from 'fs';

const json = JSON.parse(fs.readFileSync("C:/Users/shurley/source/repos/HurleySk/boomerang-/work-repo/pipeline/New_Security_Model_Updates_Incl_Inactives.json"));
const result = parsePipelineFile(json);

console.log("Nodes created:", result.nodes.length);
console.log("Pipeline nodes:", result.nodes.filter(n => n.type === "pipeline").length);
console.log("Activity nodes:", result.nodes.filter(n => n.type === "activity").length);

console.log("\nEdges created:", result.edges.length);
console.log("Contains edges:", result.edges.filter(e => e.type === "contains").length);
console.log("Executes edges:", result.edges.filter(e => e.type === "executes").length);
console.log("DependsOn edges:", result.edges.filter(e => e.type === "depends_on").length);
console.log("Other edges:", result.edges.filter(e => !["contains", "executes", "depends_on"].includes(e.type)).length);

console.log("\nWarnings:", result.warnings);

// Check activities in raw JSON
const activities = json.properties.activities;
console.log("\nActivities in JSON:", activities.length);
