/**
 * gateway_trace generation - must be in Input I/O Layer per DESIGN-DOC §1 F2
 * DO NOT use performance.now() in tight loop (V8 clock freeze trap §0.4b)
 */
export function generateGatewayTrace(): string {
  return crypto.randomUUID();
}
