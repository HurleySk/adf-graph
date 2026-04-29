export function asString(val: unknown): string | undefined {
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && (val as Record<string, unknown>).type === "Expression") {
    const v = (val as Record<string, unknown>).value;
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

export function asNonDynamic(val: unknown): string | undefined {
  const s = asString(val);
  return s && !s.startsWith("@") ? s : undefined;
}
