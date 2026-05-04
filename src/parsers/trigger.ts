import { GraphNode, GraphEdge, NodeType, EdgeType } from "../graph/model.js";
import { ParseResult } from "./parseResult.js";
import { makeTriggerId, makePipelineId } from "../utils/nodeId.js";

export interface TriggerSchedule {
  frequency: string;
  interval: number;
  startTime: string;
  timeZone: string;
  hours?: number[];
  minutes?: number[];
  daysOfWeek?: string[];
  humanReadable: string;
}

export interface TriggerPipelineRef {
  name: string;
  parameters?: Record<string, unknown>;
}

function buildHumanReadable(recurrence: Record<string, unknown>): string {
  const frequency = recurrence.frequency as string | undefined;
  const interval = recurrence.interval as number | undefined ?? 1;
  const timeZone = recurrence.timeZone as string | undefined;
  const schedule = recurrence.schedule as Record<string, unknown> | undefined;

  const parts: string[] = [];

  if (frequency === "Day" && interval === 1) {
    parts.push("Daily");
  } else if (frequency === "Day") {
    parts.push(`Every ${interval} days`);
  } else if (frequency === "Hour") {
    parts.push(`Every ${interval} hour${interval > 1 ? "s" : ""}`);
  } else if (frequency === "Minute") {
    parts.push(`Every ${interval} minute${interval > 1 ? "s" : ""}`);
  } else if (frequency === "Week") {
    parts.push(`Weekly`);
  } else if (frequency === "Month") {
    parts.push(`Monthly`);
  } else {
    parts.push(`Every ${interval} ${frequency ?? "unknown"}`);
  }

  if (schedule) {
    const hours = schedule.hours as number[] | undefined;
    const minutes = schedule.minutes as number[] | undefined;
    if (hours && hours.length > 0) {
      const timeStr = hours.map(h => {
        const m = minutes?.[0] ?? 0;
        const period = h >= 12 ? "PM" : "AM";
        const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${displayHour}:${String(m).padStart(2, "0")} ${period}`;
      }).join(", ");
      parts.push(`at ${timeStr}`);
    }

    const days = schedule.daysOfWeek as string[] | undefined;
    if (days && days.length > 0) {
      parts.push(`on ${days.join(", ")}`);
    }
  }

  if (timeZone) {
    const short = timeZone.replace(" Standard Time", "").replace(" Daylight Time", "");
    parts.push(short);
  }

  return parts.join(" ");
}

export function parseTriggerFile(json: unknown): ParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object") {
    warnings.push("Invalid trigger JSON: not an object");
    return { nodes, edges, warnings };
  }

  const root = json as Record<string, unknown>;
  const name = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;

  if (!name || !properties) {
    warnings.push("Trigger missing name or properties");
    return { nodes, edges, warnings };
  }

  const triggerType = properties.type as string | undefined;
  const runtimeState = properties.runtimeState as string | undefined;
  const typeProperties = properties.typeProperties as Record<string, unknown> | undefined;
  const pipelinesRaw = properties.pipelines as unknown[] | undefined;

  const pipelines: TriggerPipelineRef[] = [];
  if (pipelinesRaw) {
    for (const p of pipelinesRaw) {
      const pObj = p as Record<string, unknown>;
      const pRef = pObj.pipelineReference as Record<string, unknown> | undefined;
      const pName = pRef?.referenceName as string | undefined;
      const params = pObj.parameters as Record<string, unknown> | undefined;
      if (pName) {
        pipelines.push({ name: pName, ...(params ? { parameters: params } : {}) });
      }
    }
  }

  let schedule: TriggerSchedule | undefined;
  if (typeProperties?.recurrence) {
    const rec = typeProperties.recurrence as Record<string, unknown>;
    const sched = rec.schedule as Record<string, unknown> | undefined;
    schedule = {
      frequency: rec.frequency as string ?? "Unknown",
      interval: rec.interval as number ?? 1,
      startTime: rec.startTime as string ?? "",
      timeZone: rec.timeZone as string ?? "",
      ...(sched?.hours ? { hours: sched.hours as number[] } : {}),
      ...(sched?.minutes ? { minutes: sched.minutes as number[] } : {}),
      ...(sched?.daysOfWeek ? { daysOfWeek: sched.daysOfWeek as string[] } : {}),
      humanReadable: buildHumanReadable(rec),
    };
  }

  const triggerId = makeTriggerId(name);
  nodes.push({
    id: triggerId,
    type: NodeType.Trigger,
    name,
    metadata: {
      triggerType: triggerType ?? null,
      runtimeState: runtimeState ?? null,
      pipelines,
      ...(schedule ? { schedule } : {}),
    },
  });

  for (const pRef of pipelines) {
    edges.push({
      from: triggerId,
      to: makePipelineId(pRef.name),
      type: EdgeType.Triggers,
      metadata: pRef.parameters ? { parameters: pRef.parameters } : {},
    });
  }

  return { nodes, edges, warnings };
}
