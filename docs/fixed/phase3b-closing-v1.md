# Phase 3B Closing v1 - Retry + Cold Path + Platform Acceptance

* **目标：** 补 P1 失败语义：lane_full/circuit_open 重试 + transmit 5xx/429 重试 + 耗尽/不可重试归档
* **达成：**
  - `src/queues/consumer.ts` 升级：`lane_full` -> `retry 10s`，`circuit_open` -> `retry 60s`，`transmit` 429/5xx retryable + 指数退避 + jitter capped 60s，`attempts >= MAX_RETRIES(3)` 或 4xx 非重试 -> `ack` + `ctx.waitUntil(archiveColdPath)` 写 DO `coldpath:{kind}:{adapter}:{nonce}` 权威 + `KV.put` 缓存 TTL 7d，KV 失败仅 warn
  - `render` 失败 -> `drop` 归档
  - TDD：`test/queues/consumer-retry.spec.ts` 5 用例：lane_full 10s / circuit_open 60s / 5xx 重试 / 4xx ack+归档 / 耗尽 dlq
  - `wrangler.toml` 启用 KV `e7e370065f37457f8cebb76550ad8a59` + 3 队列 + DO + observability logs/traces，`dry-run 41.82 KiB`
* **验证：**
  - 本地 `tsc` / `vitest 56 passed (12 files)` / `dry-run`
  - 平台：`GET /debug has_KV:true has_Q_SLACK:true`，`POST low` -> enqueued，70s 后 `GET /status` 聚合 `email-mailchannels delivered_marker_count 5->6` 递增，重复同 event_id 第二次仅 +1 而非 +2，证明 `dedup_skip` 生效，`lane_usage` 1+1+2 非幽灵释放
  - 高优 `lane:high_exclusive|elastic` 仍通，`webhook.site` 收到 POST
  - 冷路径：单元测覆盖 archive，平台需人为触发 4xx/500 方可见 `coldpath:dlq/drop`，已留 `GET /status` 聚合查看
* **偏差：**
  - `new_classes` -> `new_sqlite_classes`，`idFromString` -> `idFromName`，`implements` -> `extends DurableObject`，已记 `docs/working/drift.md`
  - wrangler 3.114 critical out-of-date -> 升至 4.72 解析 4.86 (Node20 兼容，4.87+ 需 Node22)，已记 H-003
* **是否可关：** 是，Phase3 Happy + Retry + Cold Path 已闭环，满足 DESIGN-DOC §3.2 批内合并、§4.4 先 ack 后 waitUntil 归档、§5.3 熔断→retry 轻量闭合
* **遗留 P2：** Email 真实收件验证 H-001、MIME 移 DO 评估 H-002，归入 `hardening-plan.md` MVP Acceptance & Hardening 统一处理
