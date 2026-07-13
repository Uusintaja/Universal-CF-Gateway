# Phase 2 Closing v1 - DO 协调核心（去重/车道/熔断）

* **目标：** 引入强一致协调中枢，修复无状态缺陷，per-channel 分片，RPC 模式，紧急车道语义
* **达成：**
  - `src/coordinator/constants.ts` LANE 1+1+4=6, LANE_ALLOCATION, DEDUP_TTL 1000s
  - `src/coordinator/storage.ts` lane 计数持久化防 Hibernation 幽灵释放（inc/dec clamp），delivered 惰性过期 + list limit 50/100 防 10ms CPU 拖垮，circuit 持久化
  - `src/coordinator/coordinator.ts` 实现 `acquire` 只读查不写 P0、`release(true)` 才写 delivered、`to_send_ids` 子集回溯、`lane_full`/`circuit_open` fail-fast、`release(false)` 已 open 跳过重写避 95 次雪崩，`extends DurableObject` + `idFromName` 修复 RPC 与 Invalid ID
  - `src/index.ts` 高优路径接入 DO：`acquire -> to_send_ids -> render(subset) -> transmit -> release`，fallback 直连保可用，`GET /debug` / `GET /status` 供 Dashboard 审计
  - TDD：`test/coordinator/storage.spec.ts` 7 + `coordinator.spec.ts` 7 = 14，覆盖 P0/P1 不变量：只读/只写时机、子集、空集跳过、lane_full、circuit_open、重写跳过、幽灵释放
  - 平台冒烟：`GET /debug has_COORDINATOR:true`，`GET /status` 返回 `lane_usage`，`POST high` 返回 `lane:high_exclusive`，重复 `event_id` 第二次 `skipped:already_delivered`
* **验证：** `tsc` / `vitest 44` / `dry-run 30.16 KiB DO only` / CI `9251bc1` + `bbf1542` + `e71c423` 全绿，线上 `...-experimental` 冒烟通过
* **偏差与修复：**
  - `wrangler.toml` `new_classes` → `new_sqlite_classes`，Cloudflare 现策略 SQLite DO 必须新字段，已改
  - `idFromString` → `idFromName`，`idFromString` 要求 64 hex，`idFromName` 哈希任意串，修复 Invalid ID
  - `implements DurableObject` → `extends DurableObject from cloudflare:workers`，修复 does not support RPC
  - `wrangler 3.114 critical out-of-date` → 升至 `^4.72` 解析 4.86，仍兼容 Node20，4.87+ 需 Node22，已在 `package.json` 锁定
  - Queues/KV 预置导致 `Queue does not exist` / `KV namespace invalid`，Phase1/2 最小化已移除，仅保留 DO，Queue/KV 为 Phase3 占位
  - `.git/config` 被平台快照剥离，需按需重建，已在执行脚本中处理
* **是否可关：** 是，可进入 Phase3 Queues 低优路径
* **遗留：**
  - P0 无
  - P1：Zod 静态校验缺（待 Phase0 补）、Rate Limiting N+1 文档化（已在 free-tier-facts 记）
  - P2：Email 真实收件验证 `H-001`、MIME 移 DO 评估 `H-002`、wrangler 4.110 需 Node22 `H-003`，已入 `docs/working/hardening-plan.md`
