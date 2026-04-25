import { GraphManager } from "../graph/manager.js";

export interface ListOverlaysResult {
  environment: string;
  overlays: Array<{ path: string; source: "config" | "runtime" }>;
}

export function handleListOverlays(
  manager: GraphManager,
  environment: string,
): ListOverlaysResult {
  return { environment, overlays: manager.listOverlays(environment) };
}
