# Review Tracking

## Active Review Items

- Phase 3A 已完成本地实现，等待 Queue 创建和新版本部署后的平台冒烟。
- Phase 3B 尚未开始：retry/backoff、cold path、KV 查询缓存。
- 跨消息 merge/chunk 尚未实现；测试 Adapter 当前采用一条 Queue envelope 对应一条 raw-payload PushMessage，避免未定义的批量 Payload 格式。
- Phase 2 的 P2 硬化项保留在 `hardening-register.md`，不阻塞主线推进。

## Approved for Next Execution

- Phase 3B：retry/backoff 与 cold path 的详细讨论和执行范围确认。
- Phase 3A 平台冒烟：低优请求入队、Consumer 发送和下游接收。

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
