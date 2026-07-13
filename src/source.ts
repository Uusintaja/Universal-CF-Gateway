export interface SourceConfig {
  id: string;
  decoder_id: string;
  enabled: boolean;
  rate_limit_class: "source" | "global";
  auth_policy?: string;
}

export const SOURCE_REGISTRY: Record<string, SourceConfig> = {
  "github-ci": { id: "github-ci", decoder_id: "generic-json-webhook", enabled: true, rate_limit_class: "source" },
  monitor: { id: "monitor", decoder_id: "generic-json-webhook", enabled: true, rate_limit_class: "source" },
  "phase1-test": { id: "phase1-test", decoder_id: "generic-json-webhook", enabled: true, rate_limit_class: "source" },
  "phase3-test": { id: "phase3-test", decoder_id: "generic-json-webhook", enabled: true, rate_limit_class: "source" },
  "phase3-batch-test": { id: "phase3-batch-test", decoder_id: "generic-json-webhook", enabled: true, rate_limit_class: "source" },
};

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type SourceResolution =
  | { ok: true; source: SourceConfig; key: string; keyStrategy: "source_id" }
  | { ok: false; code: "SOURCE_REQUIRED" | "SOURCE_INVALID" | "SOURCE_CONFLICT" | "SOURCE_UNKNOWN" | "SOURCE_DISABLED"; status: 400 | 403 | 404; key: string; keyStrategy: "global" };

function pathSource(request: Request): string | undefined {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[0] === "hooks" && segments[1] ? segments[1].trim() : undefined;
}

function headerSource(request: Request): string | undefined {
  const value = request.headers.get("x-gateway-source");
  return value?.trim() || undefined;
}

export function resolveSource(request: Request): SourceResolution {
  const url = new URL(request.url);
  const fromPath = pathSource(request);
  const fromHeader = headerSource(request);
  const candidate = fromPath ?? fromHeader;
  const globalKey = `missing-source:${url.pathname}`;

  if (fromPath && fromHeader && fromPath !== fromHeader) {
    return { ok: false, code: "SOURCE_CONFLICT", status: 400, key: globalKey, keyStrategy: "global" };
  }
  if (!candidate) {
    return { ok: false, code: "SOURCE_REQUIRED", status: 400, key: globalKey, keyStrategy: "global" };
  }
  if (!SOURCE_ID_PATTERN.test(candidate)) {
    return { ok: false, code: "SOURCE_INVALID", status: 400, key: globalKey, keyStrategy: "global" };
  }

  const source = SOURCE_REGISTRY[candidate];
  if (!source) {
    return { ok: false, code: "SOURCE_UNKNOWN", status: 404, key: globalKey, keyStrategy: "global" };
  }
  if (!source.enabled) {
    return { ok: false, code: "SOURCE_DISABLED", status: 403, key: globalKey, keyStrategy: "global" };
  }

  return { ok: true, source, key: `source:${source.id}`, keyStrategy: "source_id" };
}
