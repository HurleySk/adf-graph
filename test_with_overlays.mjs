import { GraphManager } from './dist/graph/manager.js';
import { loadConfig } from './dist/config.js';

const config = loadConfig();
const manager = new GraphManager(config);

// Get the default environment
const defaultEnv = manager.getDefaultEnvironment();
console.log("Default environment:", defaultEnv);

// Build the graph for the default environment
const { graph } = manager.ensureGraph(defaultEnv);

// Now try to describe the pipeline
const pipelineId = "pipeline:New_Security_Model_Updates_Incl_Inactives";
const outgoing = graph.getOutgoing(pipelineId);
const containsEdges = outgoing.filter(e => e.type === "contains");

console.log("Contains edges:", containsEdges.length);
console.log("Total outgoing:", outgoing.length);

// Manual describe
const containedEdges = outgoing.filter((e) => e.type === "contains");
const activities = [];

for (const containsEdge of containedEdges) {
  const activityNode = graph.getNode(containsEdge.to);
  if (!activityNode) continue;

  const activityType = (activityNode.metadata.activityType);
  activities.push({
    name: activityNode.name,
    activityType,
  });
}

console.log("Activities built:", activities.length);
