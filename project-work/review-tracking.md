# Review Tracking

## Active Review Items

- Phase 3B 本地 retry/backoff、cold path、KV export 和 merge/chunk 已完成。
- 真实 5xx / Circuit / retry exhausted 平台专项尚未执行；是否需要专用失败 Adapter、Queue 和 Secret 已进入第七轮讨论。
- Phase 2 的 P2 硬化项保留在 `hardening-register.md`，不阻塞主线推进。

## Approved for Next Execution

- 根据第七轮讨论决定是否创建失败测试资源。

## Phase 3A Closure

Phase 3A 的本地测试和平台冒烟均已通过。Queue Producer、Consumer、Raw Payload 恢复、DO 去重和 alpha Queue 资源命名均已验证。

## Deferred

- Phase 2 Circuit 的真实 5xx / half-open 平台专项测试。
- delivered marker 的后台清理机制。
- 大 Payload canonicalization 的真实 CPU 测量。
- Phase 3 的 Queues、冷路径归档和批处理实现，等待新的讨论节明确范围。

## Resolved

- Raw Payload 与 canonical event_id 分离。
- Phase 1 原始 body 透传。
- Phase 2 Durable Object 去重和并发协调。
- Phase 1、Phase 2 平台冒烟主路径。

## Process Rule

讨论阶段结束时，将明确批准的事项放入 `Approved for Next Execution`。
执行阶段结束时，更新实际结果、测试证据和未完成事项。
