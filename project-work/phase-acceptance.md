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

## Current MVP Gate

Phase 0, Phase 1, Phase 2 core, and Phase 3A acceptance passed.
Phase 3B and final MVP hardening remain. Final MVP acceptance must include the
consolidated hardening review before release sign-off.
