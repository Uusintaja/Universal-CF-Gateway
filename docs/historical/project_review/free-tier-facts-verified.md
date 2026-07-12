# Cloudflare 免费层功能全景盘点（2026-07-10 官方核实 + Spike #1-#7 实测验证）

> **目的**：系统归纳 Cloudflare 免费层提供的各项功能及其额度/限制，为本项目及后续迭代提供选型基础。
> **核实来源**：官方文档逐字抓取 + **Spike #1-#7 实测验证**（标注 ✅实测）。
> **注意**：免费层额度会变动，迭代前应重新核对官方页。

---

## 一、计算与运行时

### 1. Workers（核心计算）
| 项 | Workers Free | 说明 |
|---|---|---|
| Requests | 100,000/天 | 含 HTTP + Cron + Queue consumer 调用 |
| CPU time（HTTP/Cron）| **10ms** | 仅 JS 执行；`fetch()`/KV/DB 等待**不计**。实测有 burst 容忍（偶尔可到 ~2s），但**一旦 exceededCpu 后续降至严格 10ms**（设计按 10ms）|
| CPU time（Queue consumer）| **10ms** | 同 HTTP；实测首次 burst ~2050ms 后 exceededCpu，**重试降至 ~50ms**（设计按 10ms）|
| CPU time（DO）| **✅ 实测 30,000ms（30 秒）** | **Free 层唯一能做重活的组件**（25.9s 安全 / 32.5s 被杀）。`[limits] cpu_ms` 在 Free **不可配**（部署报错），但 DO 默认 30s 已远超需求 |
| Memory | 128 MB/isolate（非 per-request）| isolate 服务多请求 |
| Wall time（HTTP）| 无限（client 连接期间）；`waitUntil()` +30s | 非"30s 硬杀" |
| Wall time（Cron/Queue/DO alarm）| 15 分钟 | ✅ 实测：Spike #5 wallTimeMs=4424 无问题 |
| Subrequests | 50 外部 / 1,000 内部 / 调用 | DO RPC、Service Binding 算 internal |
| 并发出站连接 | 6 / 调用 | 全局并发需 DO 协调 |
| Worker 数/账号 | 100 | |
| Worker size | 3 MB | |
| Env vars | 64/Worker，5 KB each | |
| Startup time | 1s | |

### 1b. V8 沙盒陷阱 + CPU 惩罚模式（✅ Spike #2/#5/#7 实测发现）

| 陷阱 | 表现 | 应对 |
|---|---|---|
| **V8 时钟冻结（Spectre 缓解）** | `performance.now()` 在同步循环中不推进 → `while (performance.now() - t0 < targetMs)` 会死循环 → CPU 被杀 | **不能用时间控制同步循环**；改用迭代次数（实测 1ms ≈ 20 万次 Math.sqrt）|
| **Self-Fetch Ingress 404** | Worker `fetch()` 自己 → 撞 Ingress 网关回环拦截 → 全盘 404 | 不用 self-fetch；直接在同一 isolate 内调 binding |
| **未读 Response body 死锁** | `fetch()` 不读 `response.text()` → TCP 连接不回收 → 撑爆连接池 → 防死锁强杀 | 任何 fetch 必须读 body 或 `body.cancel()` |
| **CPU burst/惩罚级联**（✅ Spike #7）| stateless Worker（fetch/queue/cron）首次超 CPU 时允许 burst 到 ~2s，但**一旦 exceededCpu，后续调用阈值骤降到 10-50ms**。Queue 堆积时尤其危险：一批 burst 被杀 → 重试被杀在 50ms → 雪崩 | **设计按 10ms**，绝不依赖 burst；batch 控制在 10ms CPU 内 |
| **DO 有 30s CPU（不是 10ms）**（✅ Spike #7）| DO 的 executionModel=durableObject，CPU 限制 30,000ms（25.9s 安全 / 32.5s 被杀）。是 Free 层**唯一能做重活**的组件。`[limits] cpu_ms` 在 Free 不可配，但 DO 默认 30s 已够 | 重活（如 MIME 渲染、复杂 JSON 序列化）可放 DO 内做 |
| **DO wall > CPU（调度延迟）**（✅ Spike #7）| DO 的 wallTimeMs 比 cpuTimeMs 多 ~11s（schedulingDelayMs），因 DO 排队等待执行 | 设计按 CPU 时间算预算，不按 wall time |

### 2. Cron Triggers
| 项 | Free | 说明 |
|---|---|---|
| Cron Triggers/账号 | **5** | 保守设计按 3 |
| 触发精度 | 分钟级（±30s）| |
| 失败重试 | **无**（失败即丢，下次 tick 再试）| |

---

## 二、消息与队列

### 3. Queues（消息队列，热路径候选）
| 项 | Free | 说明 |
|---|---|---|
| **Operations** | **10,000/天** | 读+写+删合计；1 op/64KB chunk |
| 消息保留 | **24h（不可配）** | 低优耐久性边界 |
| Consumer batch size | 最大 100 | |
| Batch wait | 0-60s（`max_batch_timeout`）| ✅ 实测：JIT 预热后 batch 性能优异（10 条 98ms，单条 36ms）|
| `msg.attempts` | **可读** | consumer 判"最后一次"，直接归档 |
| `env.QUEUE.metrics()` | **✅ 实测可用** | 百毫秒级实时刷新（backlogCount 动态可见）|
| 空拉取计费 | 通常不计 ops | |

### 4. Durable Objects（强一致协调）
| 项 | Workers Free | 说明 |
|---|---|---|
| Requests | **100,000/天**（独立于 Worker req）| ✅ 实测 RPC 往返 9ms 单次 / 1.5ms 平均 |
| **Duration** | **13,000 GB-s/天** | ✅ **实测：36h 仅 ~19 GB-s（0.15% 预算）**。RpcDO（无 WS）与 HibernationDO 几乎相同 → **RPC 模式就够经济，不需 WS Hibernation** |
| DO classes | 100/账号 | |
| **SQLite rows read** | **5,000,000/天** | ✅ 实测 DO storage get/put 正常 |
| **SQLite rows written** | **100,000/天** | |
| per-object 特性 | **单线程串行化 + 强一致** | ✅ **实测：并发 10 个 acquire 同一 eid，仅 1 个放行** |
| Hibernation | 支持 | ✅ 实测：有/无 Hibernation 的 duration 消耗几乎相同（idle DO 不计 duration 是 DO 天然行为，非 Hibernation 专属）|

> **重大实测修正**：之前文档说"必须 Hibernation，否则常驻即耗光 duration"。实测推翻——**DO 在"被唤醒 → 做几毫秒工作 → idle"模式下天然不计 duration，不需要 WS Hibernation**。RpcDO（纯 fetch RPC）就够经济。

---

## 三、存储

### 5. KV（键值存储）
| 项 | Free | 说明 |
|---|---|---|
| reads | 100,000/天 | |
| **writes** | **1,000/天** | 全局共享墙 |
| **deletes** | **1,000/天（独立）** | TTL 过期**不消耗** |
| **list** | **1,000/天（独立）** | |
| 同 key 写 | 1 次/秒 | |
| 一致性 | **最终一致** | 强一致需求用 DO |

### 6. D1 / 7. R2 / 8. 选型矩阵
（与之前一致，无实测变化）

---

## 四、其他相关功能

### Rate Limiting binding（✅ 实测验证）
- **免费可用**，无额外费用
- **✅ 实测**：limit=5 → 实际放行 6（N+1 边界，`currentCount <= limit` 语义，从 0 计数）
- **✅ 实测**：CPU 开销极低（4.4s wall time 仅 5ms CPU）——binding 是非阻塞异步多路复用
- **✅ 实测**：per-location 生效（同一 isolate 内串行调 binding 确认有效）
- **陷阱**：不要用 self-fetch 测试（Ingress 404 + 未读 body 死锁）；直接调 binding

### 其他（Analytics Engine / Service Bindings / etc.）
（与之前一致，无实测变化）

---

## 五、本项目组件选型映射（v2.0 实测后）

| 架构角色 | 选用的组件 | 理由（实测依据）|
|---|---|---|
| 入站 HTTP/Email 接入 | **Workers（fetch/email handler）** | 唯一入口 |
| 入站洪泛防护 | **Rate Limiting binding** | ✅ 实测可用、CPU 极低、N+1 边界无影响 |
| 低优消息累积/批处理 | **Queues** | ✅ 实测 metrics() 可用 + batch JIT 性能优异 |
| 强一致协调（并发/去重/熔断）| **Durable Objects（SQLite，RPC 模式）** | ✅ 实测串行原子 + RPC 9ms + duration 极低（不需 WS Hibernation）|
| 冷路径归档 | **DO storage（权威）+ KV（查询缓存）** | DO 强一致 + 100k writes |
| 高优同步投递 | **Workers（请求内）+ DO 闸控** | 立即语义 |
| 邮件出站 | **Email Routing `send_email`** | 免费 |

---

## 六、额度"墙"优先级（实测后）

1. **Queues ops 10,000/天 ≈ 3,300 低优/天** ← 第一墙
2. **KV writes 1,000/天** ← 冷路径（采样限流后可控）
3. **Worker requests 100,000/天** ← 充裕
4. **DO duration 13,000 GB-s/天** ← ✅ 实测仅用 ~0.15%（RPC 模式，不需 Hibernation）
5. **DO requests 100,000/天** ← ✅ 实测 RPC 9ms，~50k 低优/天才触
6. **DO rows written 100,000/天** ← 去重标记

---

## 七、历史教训（实测验证 + 更新）

| 教训 | 来源 | 应对 | 实测验证 |
|---|---|---|---|
| `message.raw` 是 ReadableStream | v1.0 事实错误 | I/O Layer 物化 | — |
| ~~Queue consumer CPU 是 10ms~~ | 三轮审计误判 | ~~保守设计~~ | ❌ **Spike #7 纠正：stateless Worker（含 queue）确实应按 10ms 设计；burst ~2s 是一次性的，超了会被惩罚降到 50ms。之前 Spike #2 测到的 ~2000ms 实际是 HTTP fetch 的 burst 天花板（eventType=fetch），不是 queue consumer 的持续限额** |
| **V8 时钟冻结** | Spike #2 实测发现 | 不能用时间控制同步循环；用迭代次数 | ✅ 定论 |
| Worker 内存信号量跨 isolate 不共享 | v1.1 缺陷#1 | 用 DO 协调 | ✅ DO 串行确认 |
| 幂等不能只靠渲染层 | v1.1 缺陷#2 | DO storage 发送前原子去重 | ✅ DO 串行原子确认 |
| ~~DO 必须 Hibernation~~ | DO pricing 暗示 | ~~强制 WS Hibernation~~ | ❌ **实测 RPC 模式就够经济**（idle DO 天然不计 duration）|
| KV 最终一致不可靠计数 | KV 特性 | 强一致需求用 DO | — |
| **Self-Fetch 双重陷阱** | Spike #5 实测 | 不用 self-fetch；必读 body | ✅ 定论 |
| **Rate Limiting N+1 边界** | Spike #5 实测 | limit=N 实际放行 N+1；业务无影响 | ✅ 定论 |
