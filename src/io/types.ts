export interface RawInput {
  body: Uint8Array;
  headers: Record<string, string>;
  source_meta: {
    transport: 'http' | 'email';
    method?: string;
    path?: string;
    email?: { from: string; to: string; subject: string };
  };
  trace_id: string; // gateway_trace generated here per DESIGN-DOC §1 F2
}

export const INPUT_IO_LIMITS = {
  MAX_BODY_BYTES: 512 * 1024,
  READ_TIMEOUT_MS: 2000
} as const;
