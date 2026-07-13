# Drift Tracking - 文档与源码不一致记录

> 按 COLLABORATION_PROTOCOL.md §8 真理层级：源码 > 配置 > README > 架构 > 发布校验 > 历史
> 发现不一致：读源码第一，记条目，讨论轮提议决议，执行轮才改范围外文件

| 日期 | 文件 | 设计侧 | 源码侧 | 决议 |
|---|---|---|---|---|
| 2026-07-11 | wrangler.toml migrations | DESIGN-DOC v2.1 写 `new_classes` | Cloudflare 现策略要求 `new_sqlite_classes`，部署报 policy conflict | 源码赢，改为 `new_sqlite_classes`，DESIGN-DOC 视为历史，记录 drift，固定基线不改 |
| 2026-07-11 | src/index.ts DO ID | DESIGN-DOC 写 `idFromString(adapter_id)` | Cloudflare `idFromString` 要求 64 hex，`idFromName` 才哈希任意串，线上报 Invalid ID | 源码赢，改为 `idFromName`，DESIGN-DOC 为固定基线，记录 drift |
| 2026-07-11 | src/coordinator/coordinator.ts | DESIGN-DOC 示例 `implements DurableObject` | Cloudflare RPC 要求 `extends DurableObject from cloudflare:workers`，否则报 does not support RPC | 源码赢，改为 extends，DESIGN-DOC 为固定基线 |
| 2026-07-11 | wrangler.toml max_batch_timeout | DESIGN-DOC 目标 900s | Miniflare cap 60s，本地方案用 60 注释 | 接受 drift，生产 900，本地 60，已注释说明 |
| 2026-07-11 | Lane counters memory only | DESIGN-DOC 提及内存态需恢复 | 实现改为持久化到 DO storage，clamp 防幽灵释放 | 源码增强，符合 §4.2 不变量，无需改设计 |

