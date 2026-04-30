export const CONNECTION_PROPERTY_KEYS = [
  "serviceUri",
  "url",
  "baseUrl",
  "servicePrincipalId",
  "tenant",
  "authenticationType",
  "connectionString",
  "connectVia",
] as const;

export function normalizeUri(uri: string): string {
  return uri.toLowerCase().replace(/\/+$/, "");
}

export function extractDvOrg(serviceUri: string): string | null {
  try {
    const host = new URL(serviceUri).hostname.toLowerCase();
    const dot = host.indexOf(".");
    return dot > 0 ? host.substring(0, dot) : host;
  } catch {
    return null;
  }
}
