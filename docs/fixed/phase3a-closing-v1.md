# Phase 3A Closing v1 - Queues Low-Priority Happy Path

* **目标：** 低优入队 + 批内合并分片 + 逐条 ack，P0 去重与车道不含重试/冷路径
* **达成：**
  - `src/queues/producer.ts` 写时路由 per-adapter，实验命名 `Q_SLACK_EXP/Q_EMAIL_EXP/Q_WEBHOOK_EXP`
  - `src/queues/chunk.ts` 双阈值 50条/24KB/Email10，`estimatedSize` via TextEncoder，单件超阈单独成片，index/total
  - `src/queues/consumer.ts` Happy Path：`Map<PushMessage,Message[]>` 溯源、`acquire->to_send_ids->render(subset)->transmit->release(true)->ack`，全重复空集跳过
  - `src/index.ts` 增加 `queue` 导出 `export default {fetch, queue}`，低优 `enqueue` 返回 202/207，高优仍走 DO
  - `wrangler.toml` 启用 3 队列实验命名，DO 保留，KV 仍注释（Phase3A 最小），`dry-run 38.12 KiB` 3 Queue + DO
* **验证：** `tsc` / `vitest` chunk 5 + consumer-happy 2 / `dry-run`，本地 51 passed
* **平台冒烟：** `POST /webhook/monitor info` -> `enqueued:["email-mailchannels"] 202`，`GET /debug has_Q_SLACK:true`，高优 `lane:high_exclusive` 仍通
* **偏差：** 无
* **是否可关：** 是，可进 3B
* **遗留：** 重试与冷路径归入 3B
