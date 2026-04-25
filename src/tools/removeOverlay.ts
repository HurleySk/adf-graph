import { GraphManager } from "../graph/manager.js";

export interface RemoveOverlayResult {
  removed: boolean;
  environment: string;
  path: string;
  error?: string;
  overlays: Array<{ path: string; source: "config" | "runtime" }>;
}

export function handleRemoveOverlay(
  manager: GraphManager,
  environment: string,
  path: string,
): RemoveOverlayResult {
  const { removed, isConfigOverlay } = manager.removeOverlay(environment, path);
  if (isConfigOverlay) {
    return {
      removed: false, environment, path,
      error: `Cannot remove config-based overlay '${path}'. Edit adf-graph.json to remove it.`,
      overlays: manager.listOverlays(environment),
    };
  }
  return { removed, environment, path, overlays: manager.listOverlays(environment) };
}
