# Review Tracking

## Active Review Items

- Phase 3 尚未开始；当前工作重点为文档体系和观测配置。
- Phase 2 的 P2 硬化项保留在 `hardening-register.md`，不阻塞进入下一轮讨论。

## Approved for Next Execution

- 建立五类文档目录和工作文档索引。
- 启用 Wrangler observability logs、invocation logs 和 traces。

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
