import { GraphManager } from "../graph/manager.js";

export interface RemoveEnvironmentResult {
  removed: boolean;
  name: string;
  error?: string;
}

export function handleRemoveEnvironment(
  manager: GraphManager,
  name: string,
): RemoveEnvironmentResult {
  const { removed, isConfigEnv } = manager.removeEnvironment(name);
  if (isConfigEnv) {
    return {
      removed: false, name,
      error: `Cannot remove config-based environment '${name}'. Edit adf-graph.json to remove it.`,
    };
  }
  return { removed, name };
}
