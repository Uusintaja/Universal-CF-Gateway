# MVP Hardening Register

> 本文档登记跨 Phase 发现、但不一定阻塞当前主线的硬化事项。
> 它不是实现 changelog；每条已解决记录必须带有验证证据。

## Priority Rules

- **P0**：影响数据正确性、安全性或核心不变量；立即阻塞并修复。
- **P1**：当前 Phase 验收前应处理；延期必须有明确理由和批准。
- **P2**：允许延期到 MVP Acceptance & Hardening 阶段。

## Status Values

`open` · `planned` · `deferred` · `resolved` · `accepted-risk`

## Register

| ID | 发现阶段 | 优先级 | 类别 | 问题 | 决策 / 处理 | 状态 | 证据 |
|---|---|---:|---|---|---|---|---|
| H-001 | Phase 1 | P0 | Payload integrity | 测试 Adapter 曾发送 InternalPushMessage 包装，而非原始 body | 改为 raw bytes 透传，并做字节级平台验证 | resolved | `7e899e5`; webhook request `848a9ec8-3605-484b-9dd2-b84152ea870c` |
| H-002 | Phase 2 | P0 | Idempotency | event_id 需要对语义等价 JSON 稳定 | I/O-owned canonicalization helper；Decoder 单次解析后调用 | resolved | `7e899e5`; 29-test regression |
| H-003 | Phase 2 | P0 | Concurrency | 相同 event_id 并发请求可能重复发送 | `inflight` + lease + delivered；DO 单对象协调 | resolved | `da24798`; 34-test suite; platform concurrent smoke |
| H-004 | Phase 2 | P2 | Circuit | 真实平台 5xx、open、half-open 尚未完成 | 使用受控失败下游专项验证 | deferred | 本地 DO circuit tests；候选 httpbin `/status/500` |
| H-005 | Phase 2 | P2 | Storage hygiene | delivered marker 使用应用层 TTL，尚无后台 Alarm 清理 | MVP 硬化阶段评估 Alarm / 批量清理 | deferred | 当前逻辑会忽略过期 marker |
| H-006 | Phase 2 | P2 | CPU budget | 大而复杂 JSON 的 canonicalization 尚未完成真实 cpuTimeMs 压测 | MVP 硬化阶段使用分级 Payload 做平台测量 | deferred | 已有深度、key 数和大小保护 |
| H-007 | Phase 3 preparation | P1 | Observability | 需要 invocation logs 和 traces 支持平台排查 | 写入 wrangler 配置并通过 dry-run | resolved | `wrangler.toml`; dry-run |

## Scope Notes

- `archiveColdPath()` 和 `queryColdPath()` 是 Phase 3 计划项，不是本登记中的硬化缺陷。
- P2 项不能自动把当前 Phase 扩大；统一硬化阶段再集中决策。
