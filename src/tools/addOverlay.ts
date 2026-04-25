import { GraphManager } from "../graph/manager.js";

export interface AddOverlayResult {
  added: boolean;
  environment: string;
  path: string;
  overlays: Array<{ path: string; source: "config" | "runtime" }>;
}

export function handleAddOverlay(
  manager: GraphManager,
  environment: string,
  path: string,
): AddOverlayResult {
  manager.addOverlay(environment, path);
  const overlays = manager.listOverlays(environment);
  return { added: true, environment, path, overlays };
}
