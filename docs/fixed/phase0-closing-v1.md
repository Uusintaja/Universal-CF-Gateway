# Phase 0 Closing v1 - 输入侧管线

* **目标：** I/O Layer 物化 + Decoder + Router + render，无发送
* **达成：** `src/io/input.ts` gateway_trace 生成点 F2 / `decoder/generic` / `router` 硬编码表 / `adapter/email` 纯渲染 / `src/index.ts` 端到端 render
* **验证：** `tsc` / `vitest` / `dry-run` 全绿，e2e POST /webhook/:source -> InternalEvent + TransportRequest
* **偏差：** `max_batch_timeout` 生产 900s vs Miniflare cap 60s，已注释；`[limits] cpu_ms` Free 不可配已移除
* **是否可关：** 是，已推远程 `e3b5dab`，CI 绿
* **遗留 P1：** Zod 静态校验缺
* **遗留 P2：** 更完整 trace 字段
