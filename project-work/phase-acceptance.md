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

## Current MVP Gate

Phase 0, Phase 1 and Phase 2 core acceptance passed.
Phase 3 is not started. Final MVP acceptance must include the consolidated
hardening review before release sign-off.
