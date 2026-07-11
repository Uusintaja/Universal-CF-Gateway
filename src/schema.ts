import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);

export const TraceRefSchema = z.object({
  source_trace: z.string().optional(),
  gateway_trace: z.string().min(1),
});

export const AuthContextSchema = z.object({
  source_id: z.string().min(1),
  verified: z.boolean(),
  principal: z.string().optional(),
}).passthrough();

export const InternalEventSchema = z.object({
  schema_version: z.literal("1.0"),
  event_id: z.string().uuid(),
  source_id: z.string().min(1),
  event_type: z.string().min(1),
  severity: SeveritySchema,
  timestamp: z.string().datetime(),
  title: z.string(),
  body: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
  ]),
  trace: TraceRefSchema,
  auth_context: AuthContextSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export type ParsedInternalEvent = z.infer<typeof InternalEventSchema>;
