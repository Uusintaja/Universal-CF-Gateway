import { INPUT_IO_LIMITS, type RawInput } from './types.js';
import { generateGatewayTrace } from '../shared/trace.js';

function normalizeHeaders(h: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('READ_TIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

/**
 * Materialize HTTP Request -> RawInput
 * Contract per DESIGN-DOC §2.2
 */
export async function materializeHttp(req: Request): Promise<RawInput> {
  const trace_id = generateGatewayTrace();

  // Size check via Content-Length if present (fast path)
  const len = req.headers.get('content-length');
  if (len && Number(len) > INPUT_IO_LIMITS.MAX_BODY_BYTES) {
    throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
  }

  const buf = await withTimeout(req.clone().arrayBuffer(), INPUT_IO_LIMITS.READ_TIMEOUT_MS).catch((e) => {
    throw Object.assign(new Error('READ_TIMEOUT'), { cause: e, status: 408 });
  });

  if (buf.byteLength > INPUT_IO_LIMITS.MAX_BODY_BYTES) {
    throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
  }

  return {
    body: new Uint8Array(buf),
    headers: normalizeHeaders(req.headers),
    source_meta: {
      transport: 'http',
      method: req.method,
      path: new URL(req.url).pathname
    },
    trace_id
  };
}

/**
 * Materialize Email - per DESIGN-DOC Email rawSize guard
 * msg type is Cloudflare ForwardableEmailMessage (mocked in tests)
 */
export async function materializeEmail(msg: {
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  headers: Headers;
  from: string;
  to: string;
  setReject: (s: string) => void;
}): Promise<RawInput> {
  const trace_id = generateGatewayTrace();

  if (msg.rawSize > INPUT_IO_LIMITS.MAX_BODY_BYTES) {
    msg.setReject('552 Message too large');
    throw Object.assign(new Error('OVERSIZE_EMAIL'), {
      status: 413,
      kind: 'oversize_email'
    });
  }

  const buf = await withTimeout(new Response(msg.raw).arrayBuffer(), INPUT_IO_LIMITS.READ_TIMEOUT_MS);

  return {
    body: new Uint8Array(buf),
    headers: normalizeHeaders(msg.headers),
    source_meta: {
      transport: 'email',
      email: { from: msg.from, to: msg.to, subject: msg.headers.get('subject') ?? '' }
    },
    trace_id
  };
}
