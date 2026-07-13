# Review Tracking

## Active Review Items

- Phase 3B 本地 retry/backoff、cold path、KV export 和 merge/chunk 已完成。
- Phase 2/3 的真实 5xx、Circuit、retry exhausted 和 Cold Path 平台专项已按决策延期到最终 MVP 硬化。
- Phase 2 的 P2 硬化项保留在 `hardening-register.md`，不阻塞主线推进。

## Approved for Next Execution

- 下一轮讨论确认 Phase 4 的范围和验收标准。

## Phase 3 Closure

Phase 3A 的本地测试和平台冒烟均已通过。Phase 3B 的本地失败路径、Cold Path、KV mock、Retry 和 Batch merge/chunk 均已通过；成功平台路径已验证。

## Deferred

- 真实 5xx / Circuit / retry exhausted / Cold Path 平台专项测试。
- delivered marker 的后台清理机制。
- 大 Payload canonicalization 的真实 CPU 测量。

## Resolved

- Raw Payload 与 canonical event_id 分离。
- Phase 1 原始 body 透传。
- Phase 2 Durable Object 去重和并发协调。
- Phase 1、Phase 2 平台冒烟主路径。

## Process Rule

讨论阶段结束时，将明确批准的事项放入 `Approved for Next Execution`。
执行阶段结束时，更新实际结果、测试证据和未完成事项。
