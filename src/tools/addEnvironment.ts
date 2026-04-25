import { GraphManager } from "../graph/manager.js";

export interface AddEnvironmentResult {
  added: boolean;
  name: string;
  path: string;
}

export function handleAddEnvironment(
  manager: GraphManager,
  name: string,
  path: string,
  overlays?: string[],
): AddEnvironmentResult {
  manager.addEnvironment(name, path, overlays);
  return { added: true, name, path };
}
