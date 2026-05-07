export interface SeeAlsoEntry {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export function buildBoomerangEnrich(names: string[], environment: string): SeeAlsoEntry {
  return {
    server: "boomerang-graph",
    tool: "bg_enrich",
    args: { names, environment },
    reason: "Deep SQL/Dataverse detail for referenced objects",
  };
}
