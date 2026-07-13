# Phase Acceptance Matrix

## Phase 0 — Input Pipeline

| Gate | Status | Evidence |
|---|---|---|
| I/O materialization | passed | unit tests |
| Generic JSON Decoder | passed | unit tests |
| Router | passed | unit tests |
| Adapter render | passed | unit tests |
| Type check | passed | `npm run typecheck` |
| Wrangler dry-run | passed | CI/local check |

## Phase 1 — Immediate HTTP Webhook

| Gate | Status | Evidence |
|---|---|---|
| Output I/O | passed | retry, timeout and response-body tests |
| Single-channel route | passed | Worker integration tests |
| Raw Payload compatibility | passed | byte-exact webhook verification |
| Real Worker response | passed | HTTP 200, upstream 200 |
| Real downstream receive | passed | webhook.site request records |

## Phase 2 — Coordinator Durable Object

| Gate | Status | Evidence |
|---|---|---|
| Coordinator binding and migration | passed | Wrangler dry-run |
| acquire/release | passed | DO tests |
| delivered deduplication | passed | DO tests + sequential platform smoke |
| inflight concurrency | passed | 10-request local test + 8-request platform smoke |
| lane capacity | passed locally | CoordinatorDO test suite |
| circuit open behavior | passed locally | CoordinatorDO test suite |
| real platform deduplication | passed | webhook.site received each event once |
| real platform 5xx/half-open | deferred | hardening register H-004 |
| marker cleanup | deferred | hardening register H-005 |
| large-payload CPU envelope | deferred | hardening register H-006 |

## Phase 3A — Queue Happy Path

| Gate | Status | Evidence |
|---|---|---|
| Queue producer binding | passed locally | Wrangler dry-run shows `HTTP_WEBHOOK_QUEUE` |
| Low-priority enqueue route | passed locally | `phase3-test` returns 202 in tests |
| QueueEnvelope | passed locally | Base64 raw payload test |
| Queue consumer | passed locally | Queue batch test |
| Consumer send + ack | passed locally | `createMessageBatch` / `getQueueResult` test |
| Pass-through message preservation | passed locally | One Queue envelope → one raw-payload PushMessage |
| Cross-message merge/chunk | deferred | Requires an Adapter-specific batch format |
| Queue platform smoke | passed | Worker returned 202; Consumer delivered to webhook.site |
| Raw Payload through Queue | passed | 342 original bytes = 342 received bytes |
| Duplicate Queue delivery | passed | Duplicate enqueue returned 202; downstream received one copy |
| Alpha resource naming | passed | `universal-cf-gateway-alpha-http-webhook` |
| Retry and cold path | deferred | Phase 3B |

### Phase 3A Platform Evidence

- Queue resource: `universal-cf-gateway-alpha-http-webhook`.
- Queue latency was approximately 60 seconds, matching `max_batch_timeout = 60`.
- First enqueue returned `202 queued` and downstream delivery succeeded.
- Re-enqueuing the same event also returned `202 queued`, but Coordinator DO prevented a second downstream delivery.
- Webhook request UUID: `3095a689-3c63-41c5-aeca-dd3f9144cdbd`.

## Phase 3B — Local Failure and Cold Path

| Gate | Status | Evidence |
|---|---|---|
| Retry/backoff | passed locally | bounded 5/15/45 second schedule test |
| Retry exhausted | passed locally | ack + `dlq` archive test |
| Non-retryable 4xx | passed locally | ack + `drop` archive test |
| DO cold-path archive/query | passed locally | CoordinatorDO tests |
| KV export success | passed locally | mocked KV binding test |
| KV export failure | passed locally | DO remains authoritative; warning logged |
| Merge/chunk boundary | passed locally | 51-item split test |
| Real 5xx platform smoke | deferred | requires explicit failure test endpoint/resource |

## Phase 3 Summary

Phase 3A and Phase 3B local acceptance passed. Phase 3A Queue and Batch platform
happy paths passed. Phase 3B real failure platform smoke is intentionally deferred
to final MVP hardening according to the approved scope decision.

## Phase 4A — Source Contract and Rate Limiting

| Gate | Status | Evidence |
|---|---|---|
| Source Registry | passed locally | `SOURCE_REGISTRY` and route consistency test |
| Path/header extraction | passed locally | source contract tests |
| Path/header conflict | passed locally | `SOURCE_CONFLICT` test |
| Source allowlist | passed locally | unknown/invalid source tests |
| Official Rate Limiting bindings | configured locally | `ALPHA_SOURCE_LIMITER` and `ALPHA_GLOBAL_LIMITER` in dry-run |
| 429 before decode | passed locally | denied limiter test |
| Required binding fail-closed | passed locally | missing limiter returns 503 |
| Rate limit platform smoke | passed | protected serial probe: 61 allowed, 9 limited out of 70 |

### Phase 4A Platform Evidence

- The official `ALPHA_SOURCE_LIMITER` binding responded successfully.
- The existing production binding was used; no dedicated smoke binding was created.
- `limit = 60`, `period = 60` produced 61 allowed calls followed by rate limiting, matching the documented N+1 boundary.
- The probe endpoint was token-protected and the temporary token was deleted after testing.
- Source whitelist, path/header conflict handling, global fallback and 429 behavior are covered by local tests.

## Current MVP Gate

Phase 0, Phase 1, Phase 2 core, all Phase 3 acceptance gates, and Phase 4A acceptance passed.
Phase 4B and final MVP hardening remain. Final MVP acceptance must include the consolidated hardening review before release sign-off.
