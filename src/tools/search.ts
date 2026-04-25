import { Graph, NodeType } from "../graph/model.js";

export interface SearchMatch {
  pipeline: string;
  activity: string;
  activityType: string;
  field: "sqlQuery" | "fetchXmlQuery" | "storedProcedureName" | "storedProcedureParameters" | "pipelineParameters";
  snippet: string;
}

export interface SearchQueriesResult {
  query: string;
  matches: SearchMatch[];
}

export function handleSearchQueries(
  graph: Graph,
  query: string,
): SearchQueriesResult {
  const matches: SearchMatch[] = [];
  const activities = graph.getNodesByType(NodeType.Activity);
  const lowerQuery = query.toLowerCase();

  for (const activity of activities) {
    const slashIdx = activity.id.indexOf("/");
    const pipeline = activity.id.slice("activity:".length, slashIdx);

    for (const field of ["sqlQuery", "fetchXmlQuery", "storedProcedureName"] as const) {
      const text = activity.metadata[field];
      if (typeof text !== "string") continue;
      if (text.toLowerCase().includes(lowerQuery)) {
        matches.push({
          pipeline,
          activity: activity.name,
          activityType: (activity.metadata.activityType as string) ?? "Unknown",
          field,
          snippet: text,
        });
      }
    }

    for (const field of ["storedProcedureParameters", "pipelineParameters"] as const) {
      const obj = activity.metadata[field];
      if (!obj || typeof obj !== "object") continue;
      const text = JSON.stringify(obj);
      if (text.toLowerCase().includes(lowerQuery)) {
        matches.push({
          pipeline,
          activity: activity.name,
          activityType: (activity.metadata.activityType as string) ?? "Unknown",
          field,
          snippet: text,
        });
      }
    }
  }

  return { query, matches };
}
