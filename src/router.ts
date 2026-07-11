import type { InternalEvent, RouteResult, Router, Severity } from "./types";

interface RoutingRule {
  match: Partial<Pick<InternalEvent, "source_id" | "event_type" | "severity">>;
  adapters: string[];
  dispatch?: RouteResult["dispatch"];
  strategy?: RouteResult["strategy"];
}

export const ROUTING_TABLE: { version: "1.0"; rules: RoutingRule[] } = {
  version: "1.0",
  rules: [
    {
      match: { source_id: "github-ci", event_type: "build.failed", severity: "high" },
      adapters: ["slack-webhook", "email-mailchannels"],
      dispatch: "immediate",
      strategy: "all",
    },
    {
      match: { source_id: "monitor", severity: "info" },
      adapters: ["email-mailchannels"],
    },
    {
      match: { source_id: "monitor", severity: "high" },
      adapters: ["slack-webhook", "email-mailchannels"],
      dispatch: "immediate",
      strategy: "first_success",
    },
  ],
};

function matches(event: InternalEvent, key: keyof RoutingRule["match"], value: string | Severity | undefined): boolean {
  return value === undefined || event[key] === value;
}

export const router: Router = {
  route(event) {
    const rule = ROUTING_TABLE.rules.find((candidate) =>
      matches(event, "source_id", candidate.match.source_id) &&
      matches(event, "event_type", candidate.match.event_type) &&
      matches(event, "severity", candidate.match.severity));

    if (!rule) return null;
    return {
      adapter_ids: [...rule.adapters],
      dispatch: rule.dispatch ?? "enqueue",
      strategy: rule.strategy ?? "all",
    };
  },
};
